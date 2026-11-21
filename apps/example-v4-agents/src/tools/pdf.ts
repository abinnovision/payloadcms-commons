import { FlueFileError, untrusted } from "@abinnovision/payloadcms-flue/agent";
import { useTool } from "@flue/runtime";
import { getDocumentProxy } from "unpdf";
import * as v from "valibot";

import { findFile, refusalAsOutput } from "./files.js";

import type { PayloadRun } from "@abinnovision/payloadcms-flue/agent";

const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_PAGE_CHARS = 8_000;

/** Mounts `read_pdf_page`, the text of one page of a PDF the user attached. */
export const usePdfTool = (
	payload: Pick<PayloadRun, "files">,
	spend: () => void,
): void => {
	useTool({
		name: "read_pdf_page",
		description:
			"Reads the text of one page of a PDF the user attached, counting pages from 1. Scanned pages hold no text.",
		input: v.object({
			file: v.union([v.string(), v.number()]),
			page: v.pipe(v.number(), v.integer(), v.minValue(1)),
		}),
		run: async ({ data, signal }) =>
			await refusalAsOutput(async () => {
				spend();

				const file = await findFile(payload.files, data.file);

				if (file.mimeType !== "application/pdf") {
					throw new FlueFileError(
						"refused",
						`File ${String(file.id)} is ${file.mimeType}, not a PDF.`,
					);
				}

				const bytes = await payload.files.read(file, {
					maxBytes: MAX_FILE_BYTES,
					...(signal ? { signal } : {}),
				});
				const pdf = await getDocumentProxy(bytes);

				try {
					if (data.page > pdf.numPages) {
						throw new FlueFileError(
							"refused",
							`The PDF has ${String(pdf.numPages)} pages.`,
						);
					}

					const content = await (await pdf.getPage(data.page)).getTextContent();
					const text = content.items
						.map((item) => ("str" in item ? item.str : ""))
						.join(" ");

					return {
						pages: pdf.numPages,
						text: untrusted(text.slice(0, MAX_PAGE_CHARS), {
							page: String(data.page),
						}),
					};
				} finally {
					await pdf.loadingTask.destroy();
				}
			}),
	});
};
