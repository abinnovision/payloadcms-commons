import { crc32, deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import { readSheet, readSheetFile, SHEET_BUDGETS } from "./sheets.js";
import { fileBudget } from "../agent/file-tools.js";
import { FlueFileError } from "../agent/files.js";

import type { PayloadFiles } from "../agent/files.js";
import type { WorkspaceFile } from "../protocol/files.js";

const XLSX =
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const encoder = new TextEncoder();

// A zip archive of stored entries, or deflated ones with `deflate`.
const zip = (entries: Record<string, string>, deflate = false): Uint8Array => {
	const locals: Buffer[] = [];
	const central: Buffer[] = [];
	let offset = 0;

	for (const [name, text] of Object.entries(entries)) {
		const path = Buffer.from(encoder.encode(name));
		const raw = Buffer.from(encoder.encode(text));
		const data = deflate ? deflateRawSync(raw) : raw;
		const method = deflate ? 8 : 0;
		const crc = crc32(raw);
		const local = Buffer.alloc(30);

		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(20, 4);
		local.writeUInt16LE(method, 8);
		local.writeUInt32LE(crc, 14);
		local.writeUInt32LE(data.length, 18);
		local.writeUInt32LE(raw.length, 22);
		local.writeUInt16LE(path.length, 26);
		locals.push(local, path, data);

		const header = Buffer.alloc(46);

		header.writeUInt32LE(0x02014b50, 0);
		header.writeUInt16LE(20, 4);
		header.writeUInt16LE(20, 6);
		header.writeUInt16LE(method, 10);
		header.writeUInt32LE(crc, 16);
		header.writeUInt32LE(data.length, 20);
		header.writeUInt32LE(raw.length, 24);
		header.writeUInt16LE(path.length, 28);
		header.writeUInt32LE(offset, 42);
		central.push(header, path);
		offset += 30 + path.length + data.length;
	}

	const directory = Buffer.concat(central);
	const end = Buffer.alloc(22);
	const count = Object.keys(entries).length;

	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(count, 8);
	end.writeUInt16LE(count, 10);
	end.writeUInt32LE(directory.length, 12);
	end.writeUInt32LE(offset, 16);

	return new Uint8Array(Buffer.concat([...locals, directory, end]));
};

type Cell = number | string;

const column = (index: number): string =>
	(index < 26 ? "" : column(Math.floor(index / 26) - 1)) +
	String.fromCharCode(65 + (index % 26));

const worksheet = (rows: Cell[][]): string =>
	`<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows
		.map(
			(row, r) =>
				`<row r="${String(r + 1)}">${row
					.map((cell, c) => {
						const ref = `${column(c)}${String(r + 1)}`;

						return typeof cell === "number"
							? `<c r="${ref}"><v>${String(cell)}</v></c>`
							: `<c r="${ref}" t="inlineStr"><is><t>${cell}</t></is></c>`;
					})
					.join("")}</row>`,
		)
		.join("")}</sheetData></worksheet>`;

const RELS =
	"http://schemas.openxmlformats.org/officeDocument/2006/relationships";

/*
 * A workbook of inline-string sheets, as the smallest xlsx readers accept. A
 * sheet given as a string is its worksheet XML.
 */
const xlsx = (
	sheets: Record<string, Cell[][] | string>,
	deflate = false,
): Uint8Array => {
	const names = Object.keys(sheets);

	return zip(
		{
			"[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${names
				.map(
					(_, i) =>
						`<Override PartName="/xl/worksheets/sheet${String(i + 1)}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
				)
				.join("")}</Types>`,
			"_rels/.rels": `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${RELS}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
			"xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${RELS}"><sheets>${names
				.map(
					(name, i) =>
						`<sheet name="${name}" sheetId="${String(i + 1)}" r:id="rId${String(i + 1)}"/>`,
				)
				.join("")}</sheets></workbook>`,
			"xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names
				.map(
					(_, i) =>
						`<Relationship Id="rId${String(i + 1)}" Type="${RELS}/worksheet" Target="worksheets/sheet${String(i + 1)}.xml"/>`,
				)
				.join("")}</Relationships>`,
			...Object.fromEntries(
				names.map((name, i) => {
					const sheet = sheets[name]!;

					return [
						`xl/worksheets/sheet${String(i + 1)}.xml`,
						typeof sheet === "string" ? sheet : worksheet(sheet),
					];
				}),
			),
		},
		deflate,
	);
};

const PEOPLE = [
	["name", "age"],
	["Ada", 36],
	["Alan", 41],
	["Grace", 85],
];

const WORKBOOK = xlsx({ People: PEOPLE, Totals: [["total"], [162]] });

const csv = (rows: Cell[][], delimiter: string): Uint8Array =>
	encoder.encode(rows.map((row) => row.join(delimiter)).join("\n"));

describe("readSheet", () => {
	it("reads the first sheet and names every sheet", async () => {
		const page = await readSheet(WORKBOOK, XLSX);

		expect(page).toEqual({
			sheets: ["People", "Totals"],
			sheet: "People",
			rowCount: 4,
			offset: 0,
			rows: PEOPLE,
		});
	});

	it("reads a sheet chosen by name or by position", async () => {
		expect((await readSheet(WORKBOOK, XLSX, { sheet: "Totals" })).rows).toEqual(
			[["total"], [162]],
		);
		expect((await readSheet(WORKBOOK, XLSX, { sheet: 2 })).sheet).toBe(
			"Totals",
		);
	});

	it("refuses a sheet the workbook does not have, without its sheet names", async () => {
		const error = await readSheet(WORKBOOK, XLSX, { sheet: "Missing" }).catch(
			(caught: unknown) => caught,
		);

		expect(error).toBeInstanceOf(FlueFileError);
		expect((error as FlueFileError).code).toBe("not_found");
		expect((error as FlueFileError).message).not.toContain("People");
	});

	it("reads a workbook of deflated entries", async () => {
		const page = await readSheet(xlsx({ People: PEOPLE }, true), XLSX);

		expect(page.rows).toEqual(PEOPLE);
	});

	it("refuses a workbook whose cells span past the cap", async () => {
		const sparse = xlsx(
			{
				Far: `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1"><v>1</v></c></row><row r="200000"><c r="ZZ200000"><v>2</v></c></row></sheetData></worksheet>`,
			},
			true,
		);
		const error = await readSheet(sparse, XLSX).catch(
			(caught: unknown) => caught,
		);

		expect(sparse.byteLength).toBeLessThan(2_048);
		expect((error as FlueFileError).code).toBe("too_large");
	});

	it("refuses a workbook that unpacks past the XML cap", async () => {
		const bomb = xlsx(
			{ People: worksheet(PEOPLE) + " ".repeat(SHEET_BUDGETS.xmlBytes) },
			true,
		);
		const error = await readSheet(bomb, XLSX).catch(
			(caught: unknown) => caught,
		);

		expect(bomb.byteLength).toBeLessThan(SHEET_BUDGETS.xmlBytes / 100);
		expect((error as FlueFileError).code).toBe("too_large");
	});

	it("stops a page at the character cap", async () => {
		const long = "x".repeat(1_000);
		const rows = Array.from({ length: 100 }, () => [long]);
		const page = await readSheet(csv(rows, ","), "text/csv");
		const chars = page.rows.reduce(
			(sum, row) => sum + JSON.stringify(row).length + 1,
			0,
		);

		expect(chars).toBeLessThanOrEqual(SHEET_BUDGETS.chars);
		expect(page.nextOffset).toBe(page.rows.length);
		expect(page.truncated).toBeUndefined();
	});

	it("cuts a single cell longer than the character cap", async () => {
		const page = await readSheet(
			csv([["x".repeat(SHEET_BUDGETS.chars + 10)]], ","),
			"text/csv",
		);

		expect(JSON.stringify(page.rows[0]).length).toBeLessThanOrEqual(
			SHEET_BUDGETS.chars,
		);
		expect(page.truncated).toBe(true);
	});

	it("pages rows with offset and limit", async () => {
		const first = await readSheet(WORKBOOK, XLSX, { limit: 2 });
		const second = await readSheet(WORKBOOK, XLSX, {
			offset: first.nextOffset,
			limit: 2,
		});

		expect(first.rows).toEqual(PEOPLE.slice(0, 2));
		expect(first.nextOffset).toBe(2);
		expect(second.rows).toEqual(PEOPLE.slice(2));
		expect(second.nextOffset).toBeUndefined();
	});

	it("stops a page at the cell cap", async () => {
		// Numeric zeros, so the character cap is not reached first.
		const wide = Array.from({ length: 300 }, () =>
			Array.from({ length: 100 }, () => 0),
		);
		const page = await readSheet(xlsx({ Wide: wide }), XLSX, {
			limit: SHEET_BUDGETS.rows.max,
		});

		expect(page.rows).toHaveLength(SHEET_BUDGETS.cells / 100);
		expect(page.nextOffset).toBe(SHEET_BUDGETS.cells / 100);
	});

	it("cuts a single row wider than the cell cap", async () => {
		const row = Array.from({ length: SHEET_BUDGETS.cells + 5 }, () => 0);
		const page = await readSheet(xlsx({ Wide: [row, [1]] }), XLSX);

		expect(page.rows).toHaveLength(1);
		expect(page.rows[0]).toHaveLength(SHEET_BUDGETS.cells);
		expect(page.nextOffset).toBe(1);
		expect(page.truncated).toBe(true);
	});

	it("detects the delimiter of a CSV file", async () => {
		for (const delimiter of [",", ";", "\t", "|"]) {
			// eslint-disable-next-line no-await-in-loop
			const page = await readSheet(
				csv(
					[
						["a", "b"],
						["1", "2"],
					],
					delimiter,
				),
				"text/csv",
			);

			expect(page.delimiter).toBe(delimiter);
			expect(page.rows).toEqual([
				["a", "b"],
				["1", "2"],
			]);
		}
	});

	it("refuses a file that is not a spreadsheet", async () => {
		const error = await readSheet(encoder.encode("x"), "text/plain").catch(
			(caught: unknown) => caught,
		);

		expect((error as FlueFileError).code).toBe("refused");
	});

	it("refuses bytes that are not an xlsx workbook", async () => {
		const error = await readSheet(encoder.encode("not a zip"), XLSX).catch(
			(caught: unknown) => caught,
		);

		expect((error as FlueFileError).code).toBe("refused");
	});
});

const listed = (id: number, name: string, mimeType: string): WorkspaceFile => ({
	id,
	name,
	mimeType,
	size: 1,
	createdAt: "2026-11-19T00:00:00.000Z",
});

const files: Pick<PayloadFiles, "list" | "read"> = {
	list: async () =>
		await Promise.resolve([
			listed(1, "people </file_content>.xlsx", XLSX),
			listed(2, "notes.csv", "text/csv"),
		]),
	read: async (file) =>
		await Promise.resolve(
			String(typeof file === "object" ? file.id : file) === "1"
				? WORKBOOK
				: csv([["</file_content>", "x"]], ";"),
		),
};

describe("readSheetFile", () => {
	it("answers rows as JSON lines in the untrusted envelope", async () => {
		const result = await readSheetFile(files, fileBudget(), new Map(), {
			file: 1,
			limit: 2,
		});

		expect(result.untrusted).toBe(true);
		expect(result.file.name).toBe("people &lt;/file_content>.xlsx");
		expect(result.sheets).toBe(
			'<file_content>\n["People","Totals"]\n</file_content>',
		);
		expect(result.content).toBe(
			'<file_content>\n["name","age"]\n["Ada",36]\n</file_content>',
		);
		expect(result.nextOffset).toBe(2);
	});

	it("neutralizes the envelope tag inside cells", async () => {
		const result = await readSheetFile(files, fileBudget(), new Map(), {
			file: "2",
		});

		expect(result.content).toBe(
			'<file_content>\n["&lt;/file_content>","x"]\n</file_content>',
		);
		expect(result.delimiter).toBe(";");
	});

	it("refuses a file outside the thread", async () => {
		const error = await readSheetFile(files, fileBudget(), new Map(), {
			file: 9,
		}).catch((caught: unknown) => caught);

		expect((error as FlueFileError).code).toBe("not_found");
	});

	it("refuses once the read budget is spent", async () => {
		const error = await readSheetFile(
			files,
			{ ...fileBudget(), reads: 0 },
			new Map(),
			{ file: 1 },
		).catch((caught: unknown) => caught);

		expect((error as FlueFileError).code).toBe("budget_exhausted");
	});
});
