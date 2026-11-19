import { useResponseFinish, useResponseStart, useTool } from "@flue/runtime";
import Papa from "papaparse";
import readXlsxFile from "read-excel-file/universal";
import * as v from "valibot";

import {
	described,
	envelope,
	fileInput,
	find,
	NOTICE,
	spend,
	useResponseBudget,
	withBudget,
} from "../agent/file-tools.js";
import { FlueFileError } from "../agent/files.js";
import { bytesToText } from "../protocol/attachments.js";
import { FILE_BUDGETS, FILE_LIMITS } from "../protocol/files.js";

import type { FileBudget } from "../agent/file-tools.js";
import type { PayloadFiles } from "../agent/files.js";
import type { PayloadRun } from "../agent/use-payload.js";

const XLSX =
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const MIB = 1024 * 1024;

/** The limits of `read_sheet`. Fixed, not configurable. */
export const SHEET_BUDGETS = {
	/** Per call. */
	rows: { default: 200, max: 1_000 },
	/** Per call. */
	cells: 20_000,
	/** Per call, of the rows as JSON lines. */
	chars: FILE_BUDGETS.readChars.max,
	/** The XML an xlsx workbook unpacks to; larger ones are refused. */
	xmlBytes: 64 * MIB,
	/** The cells of a workbook's sheets, gaps included; larger ones are refused. */
	workbookCells: 4_000_000,
} as const;

/** A cell as `read_sheet` answers it; dates are ISO strings. */
export type SheetCell = boolean | number | string | null;

interface Sheet {
	name: string;
	rows: SheetCell[][];
}

interface Workbook {
	sheets: Sheet[];
	/** The delimiter papaparse detected, for CSV. */
	delimiter?: string;
}

export interface ReadSheetOptions {
	/** A sheet's name or its 1-based position. Defaults to the first sheet. */
	sheet?: number | string | undefined;
	/** The first row, 0-based. */
	offset?: number | undefined;
	/** In rows, capped by `SHEET_BUDGETS.rows.max`. */
	limit?: number | undefined;
}

export interface SheetPage {
	/** The names of the workbook's sheets; one unnamed sheet for CSV. */
	sheets: string[];
	sheet: string;
	/** The sheet's row count. */
	rowCount: number;
	offset: number;
	rows: SheetCell[][];
	/** The delimiter detected in a CSV file. */
	delimiter?: string;
	/** Where the next page starts, while rows follow. */
	nextOffset?: number;
	/** Set when the page's first row was cut to the cell or character cap. */
	truncated?: true;
}

const cellOf = (value: unknown): SheetCell => {
	if (value instanceof Date) {
		return value.toISOString();
	}

	return typeof value === "string" ||
		typeof value === "number" ||
		typeof value === "boolean"
		? value
		: null;
};

interface ZipEntry {
	method: number;
	data: Uint8Array;
	/** What the entry unpacks to, as fflate's unzip in read-excel-file bounds it. */
	size: number;
}

/*
 * The XML entries of a zip archive, read from its central directory as fflate
 * reads it for read-excel-file. Throws a RangeError on a malformed archive.
 */
const xmlEntries = (bytes: Uint8Array): ZipEntry[] => {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let end = bytes.length - 22;

	// The end record sits within the last 65,557 bytes, behind at most a comment.
	while (view.getUint32(end, true) !== 0x06054b50) {
		end -= 1;

		if (bytes.length - end > 65_557) {
			throw new RangeError("No end of central directory.");
		}
	}

	if (end >= 20 && view.getUint32(end - 20, true) === 0x07064b50) {
		throw new RangeError("zip64 archives are not read.");
	}

	const entries: ZipEntry[] = [];
	let at = view.getUint32(end + 16, true);

	for (let i = view.getUint16(end + 8, true); i > 0; i -= 1) {
		if (view.getUint32(at, true) !== 0x02014b50) {
			throw new RangeError("Malformed central directory.");
		}

		const method = view.getUint16(at + 10, true);
		const compressed = view.getUint32(at + 20, true);
		const nameLength = view.getUint16(at + 28, true);
		const name = new TextDecoder().decode(
			bytes.subarray(at + 46, at + 46 + nameLength),
		);
		const local = view.getUint32(at + 42, true);
		const start =
			local +
			30 +
			view.getUint16(local + 26, true) +
			view.getUint16(local + 28, true);

		if (name.endsWith(".xml") || name.endsWith(".xml.rels")) {
			entries.push({
				method,
				data: bytes.subarray(start, start + compressed),
				size: method === 0 ? compressed : view.getUint32(at + 24, true),
			});
		}

		at +=
			46 +
			nameLength +
			view.getUint16(at + 30, true) +
			view.getUint16(at + 32, true);
	}

	return entries;
};

// A deflated entry, refused past the size its header declares.
const inflated = async (
	data: Uint8Array,
	size: number,
): Promise<Uint8Array> => {
	const out = new Uint8Array(size);
	const reader = new Blob([data.slice()])
		.stream()
		.pipeThrough(new DecompressionStream("deflate-raw"))
		.getReader();
	let length = 0;

	for (;;) {
		// eslint-disable-next-line no-await-in-loop
		const { done, value } = await reader.read();

		if (done) {
			return out.subarray(0, length);
		}

		if (length + value.byteLength > size) {
			// eslint-disable-next-line no-await-in-loop
			await reader.cancel();
			throw new RangeError("An entry unpacks past its declared size.");
		}

		out.set(value, length);
		length += value.byteLength;
	}
};

const REF = /<(?:\w+:)?(?:c|row)\b[^>]*?\sr=["']([A-Za-z]*)(\d+)["']/g;

// The cells read-excel-file fills for one XML entry: its last row by its last column.
const extentOf = (xml: string): number => {
	let rows = 0;
	let columns = 0;

	for (const [, letters = "", digits = ""] of xml.matchAll(REF)) {
		let column = 0;

		for (const letter of letters.toUpperCase()) {
			column = column * 26 + letter.charCodeAt(0) - 64;
		}

		rows = Math.max(rows, Number(digits));
		columns = Math.max(columns, column);
	}

	return rows * Math.max(columns, 1);
};

/*
 * read-excel-file unpacks every XML entry and fills each sheet up to its last
 * cell reference, without a cap of its own. The unpacked size and the filled
 * cells are checked first, so a zip bomb or a far cell is refused.
 */
const checkWorkbook = async (bytes: Uint8Array): Promise<void> => {
	const entries = xmlEntries(bytes);
	const unpacked = entries.reduce((sum, entry) => sum + entry.size, 0);

	if (unpacked > SHEET_BUDGETS.xmlBytes) {
		throw new FlueFileError(
			"too_large",
			`The workbook unpacks to more than ${String(SHEET_BUDGETS.xmlBytes)} bytes.`,
		);
	}

	let cells = 0;

	// One entry at a time, so at most one is unpacked.
	for (const entry of entries) {
		const xml =
			entry.method === 8
				? // eslint-disable-next-line no-await-in-loop
					await inflated(entry.data, entry.size)
				: entry.data;

		cells += extentOf(new TextDecoder().decode(xml));

		if (cells > SHEET_BUDGETS.workbookCells) {
			throw new FlueFileError(
				"too_large",
				`The workbook's sheets span more than ${String(SHEET_BUDGETS.workbookCells)} cells.`,
			);
		}
	}
};

const parseWorkbook = async (
	bytes: Uint8Array,
	mimeType: string,
): Promise<Workbook> => {
	if (mimeType === "text/csv") {
		const text = bytesToText(bytes);

		if (text === undefined) {
			throw new FlueFileError("refused", "The CSV file is not UTF-8 text.");
		}

		// An empty delimiter lets papaparse detect it.
		const parsed = Papa.parse<string[]>(text, {
			delimiter: "",
			skipEmptyLines: true,
		});

		return {
			sheets: [{ name: "", rows: parsed.data }],
			delimiter: parsed.meta.delimiter,
		};
	}

	if (mimeType !== XLSX) {
		throw new FlueFileError(
			"refused",
			`A ${mimeType} file is not a spreadsheet; read_sheet takes xlsx and CSV.`,
		);
	}

	let sheets;

	try {
		await checkWorkbook(bytes);
		sheets = await readXlsxFile(bytes.slice().buffer);
	} catch (error) {
		if (error instanceof FlueFileError) {
			throw error;
		}

		throw new FlueFileError(
			"refused",
			"The file is not a readable xlsx workbook.",
			undefined,
			{ cause: error },
		);
	}

	return {
		sheets: sheets.map((sheet) => ({
			name: sheet.sheet,
			rows: sheet.data.map((row) => row.map(cellOf)),
		})),
	};
};

// A first row past a cap, cut to the cells and characters that fit.
const cut = (row: SheetCell[]): SheetCell[] => {
	const kept: SheetCell[] = [];
	let chars = 2;

	for (const cell of row.slice(0, SHEET_BUDGETS.cells)) {
		const size = JSON.stringify(cell).length + 1;

		if (chars + size > SHEET_BUDGETS.chars) {
			if (kept.length === 0 && typeof cell === "string") {
				kept.push(cell.slice(0, SHEET_BUDGETS.chars - chars - 2));
			}

			break;
		}

		kept.push(cell);
		chars += size;
	}

	return kept;
};

const pageOf = (workbook: Workbook, options: ReadSheetOptions): SheetPage => {
	const names = workbook.sheets.map((sheet) => sheet.name);
	const wanted = options.sheet ?? 1;
	const sheet =
		typeof wanted === "number"
			? workbook.sheets[wanted - 1]
			: workbook.sheets.find((candidate) => candidate.name === wanted);

	if (!sheet) {
		throw new FlueFileError(
			"not_found",
			`The file has no sheet ${JSON.stringify(wanted)}. Read it without a sheet for the names of its sheets.`,
		);
	}

	const offset = Math.max(options.offset ?? 0, 0);
	const limit = Math.min(
		Math.max(options.limit ?? SHEET_BUDGETS.rows.default, 1),
		SHEET_BUDGETS.rows.max,
	);
	const rows: SheetCell[][] = [];
	let cells = 0;
	let chars = 0;
	let truncated = false;

	for (const row of sheet.rows.slice(offset, offset + limit)) {
		const size = JSON.stringify(row).length + 1;

		if (
			cells + row.length > SHEET_BUDGETS.cells ||
			chars + size > SHEET_BUDGETS.chars
		) {
			// A first row past a cap is cut, so every page holds a row.
			if (rows.length === 0) {
				rows.push(cut(row));
				truncated = true;
			}

			break;
		}

		rows.push(row);
		cells += row.length;
		chars += size;
	}

	const end = offset + rows.length;

	return {
		sheets: names,
		sheet: sheet.name,
		rowCount: sheet.rows.length,
		offset,
		rows,
		...(workbook.delimiter === undefined
			? {}
			: { delimiter: workbook.delimiter }),
		...(end < sheet.rows.length ? { nextOffset: end } : {}),
		...(truncated ? { truncated } : {}),
	};
};

/**
 * A page of rows of an xlsx or CSV file, at most `SHEET_BUDGETS.cells`
 * cells and `SHEET_BUDGETS.chars` characters. A CSV file's delimiter is detected.
 */
export const readSheet = async (
	bytes: Uint8Array,
	mimeType: string,
	options: ReadSheetOptions = {},
): Promise<SheetPage> => pageOf(await parseWorkbook(bytes, mimeType), options);

export interface ReadSheetArgs extends ReadSheetOptions {
	file: number | string;
}

/**
 * A page of a spreadsheet file's rows, enveloped as untrusted, one JSON array
 * per line. `workbooks` keeps the parsed workbooks of the response by file id.
 */
export const readSheetFile = async (
	files: Pick<PayloadFiles, "list" | "read">,
	budget: FileBudget,
	workbooks: Map<string, Workbook>,
	args: ReadSheetArgs,
	signal?: AbortSignal,
) => {
	spend(budget, "reads");

	const file = await find(files, args.file);
	const id = String(file.id);
	const workbook =
		workbooks.get(id) ??
		(await parseWorkbook(
			await files.read(file, {
				maxBytes: FILE_LIMITS.readBytes,
				...(signal ? { signal } : {}),
			}),
			file.mimeType,
		));

	workbooks.set(id, workbook);

	const { rows, ...page } = pageOf(workbook, args);

	return {
		file: described(file),
		...page,
		sheets: envelope(JSON.stringify(page.sheets)),
		sheet: envelope(page.sheet),
		content: envelope(rows.map((row) => JSON.stringify(row)).join("\n")),
		untrusted: true,
		notice: NOTICE,
	};
};

// The workbooks parsed in each conversation's live response, by handle.
const parsed = new Map<string, Map<string, Workbook>>();

/**
 * Mounts `read_sheet`, which reads the rows of an xlsx or CSV file the user
 * attached to the thread.
 */
export const useSheetTools = (payload: Pick<PayloadRun, "files">): void => {
	const handle = useResponseBudget();

	useResponseStart(() => {
		parsed.set(handle, new Map());
	});
	useResponseFinish(() => {
		parsed.delete(handle);
	});

	useTool({
		name: "read_sheet",
		description:
			"Reads rows of an xlsx or CSV file the user attached, one JSON array per row. Answers the sheet names and nextOffset while more rows follow.",
		input: v.object({
			file: fileInput,
			sheet: v.optional(
				v.pipe(
					v.union([v.string(), v.pipe(v.number(), v.integer(), v.minValue(1))]),
					v.description("A sheet's name or 1-based position."),
				),
			),
			offset: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0))),
			limit: v.optional(
				v.pipe(
					v.number(),
					v.integer(),
					v.minValue(1),
					v.maxValue(SHEET_BUDGETS.rows.max),
				),
			),
		}),
		run: async ({ data, signal }) =>
			await withBudget(
				handle,
				async (budget) =>
					await readSheetFile(
						payload.files,
						budget,
						parsed.get(handle) ?? new Map<string, Workbook>(),
						data,
						signal,
					),
			),
	});
};
