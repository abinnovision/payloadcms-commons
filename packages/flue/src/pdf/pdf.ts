import { defineTool, useTool } from "@flue/runtime";
import { getDocumentProxy, getMeta, renderPageAsImage } from "unpdf";
import * as v from "valibot";

import { DocumentCache } from "./cache.js";
import {
	described,
	envelope,
	fileInput,
	find,
	neutralize,
	NOTICE,
	spend,
	useResponseBudget,
	VISION_RESULT,
	visionInstruction,
	withBudget,
} from "../agent/file-tools.js";
import { FlueFileError } from "../agent/files.js";
import { bytesToBase64 } from "../protocol/attachments.js";
import { FILE_BUDGETS } from "../protocol/files.js";

import type { FileBudget, VisionPrompt } from "../agent/file-tools.js";
import type { PayloadFiles } from "../agent/files.js";
import type { PayloadRun } from "../agent/use-payload.js";
import type { WorkspaceFile } from "../protocol/files.js";
import type { ToolDefinition } from "@flue/runtime";
import type * as Canvas from "@napi-rs/canvas";

const MIB = 1024 * 1024;

/** The limits of the PDF tools. Fixed, not configurable. */
export const PDF_BUDGETS = {
	/** PDFs with more pages are refused. */
	pages: 2_000,
	/** Each tool loads the whole file; larger files are refused. */
	loadBytes: 150 * MIB,
	/** The open PDFs of the process, by file size. */
	cacheBytes: 256 * MIB,
	/** Per page. */
	textChars: 8_000,
	/** The whole page a render draws, before the area is cut. */
	renderCanvasPixels: 12_000_000,
	/** The image the vision model sees. */
	renderOutputPixels: 4_194_304,
	/** The long edge of the rendered area, in pixels. */
	renderResolution: { default: 1_568, min: 256, max: 2_400 },
} as const;

/** `@napi-rs/canvas`, which renders pages. */
type CanvasModule = typeof Canvas;

/*
 * Whether `@napi-rs/canvas` resolves, checked without loading its binary, so
 * `usePdfTools` knows synchronously whether to mount `view_pdf_page`.
 */
const canvasResolves = (): boolean => {
	try {
		import.meta.resolve("@napi-rs/canvas");

		return true;
	} catch {
		return false;
	}
};

let canvasModule: Promise<CanvasModule> | undefined;

// Loaded on the first render; a missing binary refuses each render.
const loadCanvas = async (): Promise<CanvasModule> => {
	canvasModule ??= import("@napi-rs/canvas");

	try {
		return await canvasModule;
	} catch (error) {
		throw new FlueFileError(
			"unavailable",
			"Rendering PDF pages is not available in this sidecar.",
			undefined,
			{ cause: error },
		);
	}
};

type PdfDocument = Awaited<ReturnType<typeof getDocumentProxy>>;

/*
 * pdf.js without XFA and font loading, its decoded images bounded. unpdf's
 * pdf.js build has no eval path to turn off.
 */
const openPdf = async (bytes: Uint8Array): Promise<PdfDocument> => {
	let doc: PdfDocument;

	try {
		doc = await getDocumentProxy(bytes, {
			enableXfa: false,
			disableFontFace: true,
			maxImageSize: PDF_BUDGETS.renderCanvasPixels,
		});
	} catch (error) {
		throw new FlueFileError(
			"refused",
			"The file is not a readable PDF.",
			undefined,
			{ cause: error },
		);
	}

	if (doc.numPages > PDF_BUDGETS.pages) {
		const pages = doc.numPages;

		await doc.loadingTask.destroy();
		throw new FlueFileError(
			"too_large",
			`The PDF has ${String(pages)} pages, more than ${String(PDF_BUDGETS.pages)}.`,
		);
	}

	return doc;
};

/*
 * The open PDFs of the process, shared by every conversation. A document no
 * call uses drops the pages and decoded objects pdf.js keeps.
 */
const documents = new DocumentCache<PdfDocument>(
	PDF_BUDGETS.cacheBytes,
	async (doc) => {
		await doc.loadingTask.destroy();
	},
	async (doc) => {
		await doc.cleanup();
	},
);

// Renders run one at a time, so the process holds one page canvas at most.
let renderQueue: Promise<unknown> = Promise.resolve();

const queued = async <T>(
	task: () => Promise<T>,
	signal?: AbortSignal,
): Promise<T> => {
	const start = async (): Promise<T> => {
		signal?.throwIfAborted();

		return await task();
	};

	const run = renderQueue.then(start, start);

	renderQueue = run.catch(() => undefined);

	return await run;
};

/**
 * The files the PDF tools read, and the scope their open documents are
 * cached under, which keeps one conversation's documents from another's.
 */
export interface PdfSource {
	files: Pick<PayloadFiles, "list" | "read">;
	scope: string;
}

const withPdf = async <R>(
	source: PdfSource,
	file: WorkspaceFile,
	run: (doc: PdfDocument) => Promise<R>,
	signal?: AbortSignal,
): Promise<R> => {
	if (file.mimeType !== "application/pdf") {
		throw new FlueFileError(
			"refused",
			`File ${String(file.id)} is ${file.mimeType}, not a PDF.`,
		);
	}

	if (file.size > PDF_BUDGETS.loadBytes) {
		throw new FlueFileError(
			"too_large",
			`File ${String(file.id)} is larger than ${String(PDF_BUDGETS.loadBytes)} bytes.`,
		);
	}

	/*
	 * Loaded without the caller's signal: other calls may share the loading
	 * document, and one caller's abort must not fail theirs.
	 */
	return await documents.use(
		`${source.scope}\u0000${String(file.id)}`,
		file.size,
		async () =>
			await openPdf(
				await source.files.read(file, { maxBytes: PDF_BUDGETS.loadBytes }),
			),
		async (doc) => {
			signal?.throwIfAborted();

			return await run(doc);
		},
	);
};

const pageOf = async (doc: PdfDocument, page: number) => {
	if (page > doc.numPages) {
		throw new FlueFileError(
			"not_found",
			`The PDF has ${String(doc.numPages)} pages, no page ${String(page)}.`,
		);
	}

	return await doc.getPage(page);
};

const rounded = (value: number): number => Math.round(value * 10) / 10;

export interface PdfFileArgs {
	file: number | string;
}

/** A PDF's page count, first page size and metadata, enveloped as untrusted. */
export const pdfInfo = async (
	source: PdfSource,
	budget: FileBudget,
	args: PdfFileArgs,
	signal?: AbortSignal,
) => {
	spend(budget, "reads");

	const file = await find(source.files, args.file);

	return await withPdf(
		source,
		file,
		async (doc) => {
			const first = await doc.getPage(1);
			const viewport = first.getViewport({ scale: 1 });

			first.cleanup();

			const { info } = await getMeta(doc);
			const metadata = Object.fromEntries(
				(
					[
						"Title",
						"Author",
						"Subject",
						"Keywords",
						"Creator",
						"Producer",
						"CreationDate",
						"ModDate",
					] as const
				)
					.filter((key) => typeof info[key] === "string" && info[key] !== "")
					.map((key) => [key, envelope(String(info[key]))]),
			);

			return {
				file: described(file),
				pages: doc.numPages,
				pageSize: {
					width: rounded(viewport.width),
					height: rounded(viewport.height),
				},
				metadata,
				untrusted: true,
				notice: NOTICE,
			};
		},
		signal,
	);
};

export interface ReadPdfPageArgs extends PdfFileArgs {
	/** 1-based. */
	page: number;
}

/**
 * A page's text lines, each prefixed with the position of its top left in
 * points from the page's top left, at most `PDF_BUDGETS.textChars` characters.
 */
export const readPdfPage = async (
	source: PdfSource,
	budget: FileBudget,
	args: ReadPdfPageArgs,
	signal?: AbortSignal,
) => {
	spend(budget, "reads");

	const file = await find(source.files, args.file);

	return await withPdf(
		source,
		file,
		async (doc) => {
			const page = await pageOf(doc, args.page);
			const viewport = page.getViewport({ scale: 1 });
			const lines: {
				x: number;
				top: number;
				baseline: number;
				text: string;
			}[] = [];
			let open = false;
			let chars = 0;
			let truncated = false;

			try {
				for (const item of (await page.getTextContent()).items) {
					if (!("str" in item)) {
						continue;
					}

					const [x, baseline] = viewport.convertToViewportPoint(
						item.transform[4] as number,
						item.transform[5] as number,
					) as [number, number];
					const text = item.str.slice(0, PDF_BUDGETS.textChars - chars);
					const last = lines.at(-1);

					chars += text.length;
					truncated = text.length < item.str.length;

					// A line ends at an end-of-line mark or where the baseline moves.
					if (open && last && Math.abs(last.baseline - baseline) < 1) {
						last.text += text;
						last.top = Math.min(last.top, baseline - item.height);
					} else if (text !== "") {
						lines.push({ x, top: baseline - item.height, baseline, text });
					}

					if (truncated) {
						break;
					}

					open = !item.hasEOL;
				}
			} finally {
				page.cleanup();
			}

			return {
				file: described(file),
				page: args.page,
				pages: doc.numPages,
				pageSize: {
					width: rounded(viewport.width),
					height: rounded(viewport.height),
				},
				content: envelope(
					lines
						.map(
							(line) =>
								`[${String(rounded(line.x))}, ${String(rounded(line.top))}] ${line.text}`,
						)
						.join("\n"),
				),
				...(truncated ? { truncated } : {}),
				untrusted: true,
				notice: NOTICE,
			};
		},
		signal,
	);
};

/** A rectangle in points from the page's top left. */
interface PdfArea {
	x: number;
	y: number;
	width: number;
	height: number;
}

/** How a page is rendered: the page's scale and the area cut from it, in pixels. */
interface RenderPlan {
	scale: number;
	crop: PdfArea;
}

/**
 * The scale that brings the area's long edge to `resolution`, lowered until
 * the whole page fits `renderCanvasPixels` and the area `renderOutputPixels`.
 */
export const renderPlan = (
	page: { width: number; height: number },
	area: PdfArea | undefined,
	resolution: number,
): RenderPlan => {
	const x = Math.min(Math.max(area?.x ?? 0, 0), page.width);
	const y = Math.min(Math.max(area?.y ?? 0, 0), page.height);
	const width = Math.min(area?.width ?? page.width, page.width - x);
	const height = Math.min(area?.height ?? page.height, page.height - y);

	if (width <= 0 || height <= 0) {
		throw new FlueFileError("refused", "The area lies outside the page.");
	}

	const scale = Math.min(
		resolution / Math.max(width, height),
		Math.sqrt(PDF_BUDGETS.renderCanvasPixels / (page.width * page.height)),
		Math.sqrt(PDF_BUDGETS.renderOutputPixels / (width * height)),
	);

	return {
		scale,
		crop: {
			x: Math.floor(x * scale),
			y: Math.floor(y * scale),
			width: Math.max(Math.floor(width * scale), 1),
			height: Math.max(Math.floor(height * scale), 1),
		},
	};
};

export interface ViewPdfPageArgs extends ReadPdfPageArgs {
	question: string;
	area?: PdfArea | undefined;
	/** The long edge of the rendered area, in pixels. */
	resolution?: number | undefined;
}

/**
 * A vision model's answer about a rendered page or area, enveloped as
 * untrusted. Counts a vision call.
 */
export const viewPdfPage = async (
	source: PdfSource,
	budget: FileBudget,
	canvas: CanvasModule,
	prompt: VisionPrompt,
	args: ViewPdfPageArgs,
	signal?: AbortSignal,
) => {
	spend(budget, "vision");

	const file = await find(source.files, args.file);
	const resolution = Math.min(
		Math.max(
			args.resolution ?? PDF_BUDGETS.renderResolution.default,
			PDF_BUDGETS.renderResolution.min,
		),
		PDF_BUDGETS.renderResolution.max,
	);
	const image = await withPdf(
		source,
		file,
		async (doc) => {
			const page = await pageOf(doc, args.page);

			try {
				const plan = renderPlan(
					page.getViewport({ scale: 1 }),
					args.area,
					resolution,
				);

				return await queued(async () => {
					const rendered = await canvas.loadImage(
						await renderPageAsImage(doc, args.page, {
							canvasImport: async () => await Promise.resolve(canvas),
							scale: plan.scale,
						}),
					);
					const { crop } = plan;
					const target = canvas.createCanvas(crop.width, crop.height);

					target
						.getContext("2d")
						.drawImage(
							rendered,
							crop.x,
							crop.y,
							crop.width,
							crop.height,
							0,
							0,
							crop.width,
							crop.height,
						);

					return {
						bytes: new Uint8Array(await target.encode("jpeg", 85)),
						width: crop.width,
						height: crop.height,
					};
				}, signal);
			} finally {
				page.cleanup();
			}
		},
		signal,
	);

	if (image.bytes.byteLength > FILE_BUDGETS.visionImageBytes) {
		throw new FlueFileError(
			"too_large",
			"The rendered image is too large for the vision model. Ask for a smaller area or resolution.",
		);
	}

	const seen = await prompt(
		visionInstruction(
			args.question,
			"The attached image is a rendered page, or an area of one, of a PDF file a user uploaded.",
		),
		{ type: "image", data: bytesToBase64(image.bytes), mimeType: "image/jpeg" },
		signal,
	);

	return {
		file: described(file),
		page: args.page,
		size: { width: image.width, height: image.height },
		answer: envelope(seen.answer),
		doubts: seen.doubts.map(neutralize),
		untrusted: true,
		notice: NOTICE,
	};
};

const pageInput = v.pipe(
	v.number(),
	v.integer(),
	v.minValue(1),
	v.description("The 1-based page number."),
);

/**
 * The tools {@link usePdfTools} mounts for the conversation of `handle`;
 * `view_pdf_page` only with `canvas`, which loads the canvas module.
 */
export const pdfTools = (
	payload: Pick<PayloadRun, "files">,
	handle: string,
	canvas: (() => Promise<CanvasModule>) | undefined,
): ToolDefinition[] => {
	const source: PdfSource = { files: payload.files, scope: handle };
	const tools: ToolDefinition[] = [
		defineTool({
			name: "pdf_info",
			description:
				"Answers a PDF file's page count, first page size in points and metadata.",
			input: v.object({ file: fileInput }),
			run: async ({ data, signal }) =>
				await withBudget(
					handle,
					async (budget) => await pdfInfo(source, budget, data, signal),
				),
		}) as ToolDefinition,
		defineTool({
			name: "read_pdf_page",
			description:
				"Reads the text lines of one PDF page. Each line starts with the [x, y] position of its top left in points from the page's top left.",
			input: v.object({ file: fileInput, page: pageInput }),
			run: async ({ data, signal }) =>
				await withBudget(
					handle,
					async (budget) => await readPdfPage(source, budget, data, signal),
				),
		}) as ToolDefinition,
	];

	if (canvas === undefined) {
		return tools;
	}

	const point = v.pipe(v.number(), v.minValue(0));
	const extent = v.pipe(v.number(), v.minValue(1));

	tools.push(
		defineTool({
			name: "view_pdf_page",
			description:
				"Renders a PDF page, or an area of it in points from the top left, and asks a vision model a question about it.",
			input: v.object({
				file: fileInput,
				page: pageInput,
				question: v.string(),
				area: v.optional(
					v.object({ x: point, y: point, width: extent, height: extent }),
				),
				resolution: v.optional(
					v.pipe(
						v.number(),
						v.integer(),
						v.minValue(PDF_BUDGETS.renderResolution.min),
						v.maxValue(PDF_BUDGETS.renderResolution.max),
						v.description("The long edge of the rendered area, in pixels."),
					),
				),
			}),
			harness: true,
			run: async ({ data, signal, harness }) =>
				await withBudget(
					handle,
					async (budget) =>
						await viewPdfPage(
							source,
							budget,
							await canvas(),
							async (instruction, image, callSignal) =>
								(
									await harness.prompt(instruction, {
										images: [image],
										result: VISION_RESULT,
										...(callSignal ? { signal: callSignal } : {}),
									})
								).data,
							data,
							signal,
						),
				),
		}) as ToolDefinition,
	);

	return tools;
};

/**
 * Mounts `pdf_info` and `read_pdf_page` and, when `@napi-rs/canvas` resolves,
 * `view_pdf_page`, which renders a page and asks a child call of the harness.
 */
export const usePdfTools = (payload: Pick<PayloadRun, "files">): void => {
	const handle = useResponseBudget();

	for (const tool of pdfTools(
		payload,
		handle,
		canvasResolves() ? loadCanvas : undefined,
	)) {
		useTool(tool);
	}
};
