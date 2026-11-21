import { FlueFileError, untrusted } from "@abinnovision/payloadcms-flue/agent";
import { useTool } from "@flue/runtime";
import Papa from "papaparse";
import readXlsxFile from "read-excel-file/universal";
import * as v from "valibot";

import { findFile, refusalAsOutput } from "./files.js";

import type { FilesApi } from "./files.js";
import type { PayloadRun } from "@abinnovision/payloadcms-flue/agent";

const XLSX =
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const MAX_ROWS = 200;
const MAX_FILE_BYTES = 10 * 1024 * 1024;

type Row = (boolean | number | string | null)[];

const parse = async (
	files: FilesApi,
	id: number | string,
	signal: AbortSignal | undefined,
): Promise<Row[]> => {
	const file = await findFile(files, id);

	if (file.size > MAX_FILE_BYTES) {
		throw new FlueFileError("too_large", "The spreadsheet is too large.");
	}

	const bytes = await files.read(file, {
		maxBytes: MAX_FILE_BYTES,
		...(signal ? { signal } : {}),
	});

	if (file.mimeType === "text/csv") {
		return Papa.parse<string[]>(new TextDecoder().decode(bytes), {
			skipEmptyLines: true,
		}).data;
	}

	if (file.mimeType !== XLSX) {
		throw new FlueFileError(
			"refused",
			`File ${String(file.id)} is ${file.mimeType}, not a spreadsheet.`,
		);
	}

	/*
	 * An xlsx file is a zip archive and can unpack to far more than its size.
	 * Check the uncompressed size from the archive's directory before parsing
	 * when a deployment takes files from untrusted users.
	 */
	const [first] = await readXlsxFile(bytes.slice().buffer);

	return (first?.data ?? []).map((row) =>
		row.map((cell) =>
			cell instanceof Date ? cell.toISOString() : (cell ?? null),
		),
	) as Row[];
};

/** Mounts `read_sheet`, a page of rows of an xlsx or CSV file the user attached. */
export const useSheetTool = (
	payload: Pick<PayloadRun, "files">,
	spend: () => void,
): void => {
	useTool({
		name: "read_sheet",
		description:
			"Reads rows of the first sheet of an xlsx or CSV file the user attached. Answers nextOffset while more rows follow.",
		input: v.object({
			file: v.union([v.string(), v.number()]),
			offset: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0))),
		}),
		run: async ({ data, signal }) =>
			await refusalAsOutput(async () => {
				spend();

				const rows = await parse(payload.files, data.file, signal);
				const offset = data.offset ?? 0;
				const page = rows.slice(offset, offset + MAX_ROWS);
				const end = offset + page.length;

				return {
					rowCount: rows.length,
					rows: untrusted(page.map((row) => JSON.stringify(row)).join("\n")),
					...(end < rows.length ? { nextOffset: end } : {}),
				};
			}),
	});
};
