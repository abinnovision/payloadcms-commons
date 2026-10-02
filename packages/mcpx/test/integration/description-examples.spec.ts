import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createMcpClient } from "./helpers/mcp.js";
import { bootPayload, seedKeys } from "./helpers/payload.js";

import type { McpClient } from "./helpers/mcp.js";
import type { Booted } from "./helpers/payload.js";

/*
 * A pointer into a document carries a 0-based index or "-" where a schema path
 * carries a slug or "*", so a quoted path with such a segment is not a schema
 * path.
 */
const isDocumentPointer = (path: string): boolean =>
	path.split("/").some((segment) => segment === "-" || /^\d+$/.test(segment));

interface Node {
	error?: string;
	fields?: { path: string }[];
}

/** Collections the examples are written against, in the order they are tried. */
const EXAMPLE_COLLECTIONS = ["pages", "posts"];

/**
 * Quoted examples that do not resolve on the fixture, so the spec stays green
 * only for these. They illustrate path syntax with names the fixture does not
 * carry.
 */
const UNRESOLVED = ["/items/*/title", "/layout/sections/hero"];

describe("schema paths quoted in tool descriptions", () => {
	let booted: Booted;
	let mcp: McpClient;
	let examples: string[];

	beforeAll(async () => {
		booted = await bootPayload();
		mcp = createMcpClient(booted, (await seedKeys(booted.payload)).keys.full);

		const descriptions = (await mcp.list()).map((tool) => tool.description);
		const quoted = descriptions.flatMap((description) =>
			[...(description ?? "").matchAll(/"(\/[^"\s]*)"/g)].map(
				(match) => match[1] as string,
			),
		);

		examples = [...new Set(quoted)].filter((path) => !isDocumentPointer(path));
	});

	afterAll(async () => {
		await booted.payload.destroy();
	});

	const describeAt = async (
		collection: string,
		path: string,
	): Promise<Node | undefined> => {
		const result = await mcp.call("describeSchema", {
			collection,
			paths: [path],
		});
		const [node] = result.data as unknown as Node[];

		return result.isError || node?.error !== undefined ? undefined : node;
	};

	/*
	 * A node path resolves when described. A quoted field path resolves when the
	 * node it sits in lists it, relative to that node.
	 */
	const resolves = async (path: string): Promise<boolean> => {
		const parent = path.slice(0, path.lastIndexOf("/"));

		for (const collection of EXAMPLE_COLLECTIONS) {
			if (await describeAt(collection, path)) {
				return true;
			}

			const node = await describeAt(collection, parent);

			if (
				node?.fields?.some((field) => field.path === path.slice(parent.length))
			) {
				return true;
			}
		}

		return false;
	};

	it("finds the examples the descriptions quote", () => {
		expect(examples.length).toBeGreaterThan(0);
	});

	it("resolves every quoted schema path", async () => {
		const unresolved: string[] = [];

		for (const path of examples) {
			if (!(await resolves(path))) {
				unresolved.push(path);
			}
		}

		expect(unresolved).toEqual(UNRESOLVED);
	});
});
