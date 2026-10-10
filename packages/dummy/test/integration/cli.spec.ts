import process from "node:process";
import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	it,
	vi,
} from "vitest";

import { bootPayload } from "./helpers/payload.js";
import { runDummyCli } from "../../src/cli/index.js";
import { defineDummySeed } from "../../src/define-seed.js";

import type { Payload } from "payload";

let payload: Payload;

beforeAll(async () => {
	({ payload } = await bootPayload({ key: "cli" }));
});

afterEach(() => {
	process.exitCode = undefined;
});

afterAll(async () => {
	await payload.destroy();
});

/*
 * The CLI destroys the instance it is given, which would end the shared one, so
 * it is handed a thunk whose destroy is a no-op. Everything else is real.
 */
const borrowed = (): Promise<Payload> =>
	Promise.resolve(
		new Proxy(payload, {
			get: (target, key) =>
				key === "destroy" ? () => Promise.resolve() : target[key as never],
		}),
	);

const run = async (
	argv: string[],
	seeds = [
		defineDummySeed({
			id: "pages",
			run: async (ctx) => {
				await ctx.doc("pages", { slug: "/cli", title: "CLI" });
			},
		}),
	],
): Promise<{ code: number; out: string }> => {
	const lines: string[] = [];
	const spy = vi
		.spyOn(console, "log")
		.mockImplementation((line: unknown) => lines.push(String(line)));

	try {
		const code = await runDummyCli({ payload: borrowed, seeds, argv });

		return { code, out: lines.join("\n") };
	} finally {
		spy.mockRestore();
	}
};

describe("runDummyCli", () => {
	it("answers 0 and seeds on a clean run", async () => {
		const { code, out } = await run([]);

		expect(code).toBe(0);
		expect(out).toMatch(/done in/);
	});

	it("prints the tally", async () => {
		const { out } = await run([]);

		expect(out).toMatch(/pages\s+\d+ created|pages\s+\d+ updated/);
	});

	it("drops the per-seed lines when quiet, keeping the tally", async () => {
		const { out } = await run(["--quiet"]);

		expect(out).not.toMatch(/mode: upsert/);
		expect(out).toMatch(/done in/);
	});

	it("reaches the reset path when fresh is passed", async () => {
		const seeds = [
			defineDummySeed({
				id: "tags",
				run: async (ctx) => {
					await ctx.doc("tags", { name: "Kept by the seed" });
				},
			}),
		];

		await run([], seeds);
		await payload.create({
			collection: "tags",
			data: { name: "Written by hand" },
			overrideAccess: true,
		});

		const { code } = await runDummyCli({
			payload: borrowed,
			seeds,
			argv: ["--fresh"],
			resetCollections: ["tags"],
			reporter: {},
		}).then((c) => ({ code: c }));
		const found = await payload.find({
			collection: "tags",
			limit: 0,
			pagination: false,
			overrideAccess: true,
		});

		expect(code).toBe(0);
		// The hand-written row is gone; only what the seed declares is left.
		expect(found.docs.map((doc) => doc["name"])).toEqual(["Kept by the seed"]);
	});

	it("runs only the named seed", async () => {
		const seeds = [
			defineDummySeed({
				id: "pages",
				run: async (ctx) => {
					await ctx.doc("pages", { slug: "/only-pages", title: "Pages" });
				},
			}),
			defineDummySeed({
				id: "tags",
				run: async (ctx) => {
					await ctx.doc("tags", { name: "Skipped" });
				},
			}),
		];

		await run(["--only", "pages"], seeds);

		const tags = await payload.find({
			collection: "tags",
			where: { name: { equals: "Skipped" } },
			overrideAccess: true,
		});

		expect(tags.docs).toHaveLength(0);
	});

	it("lists the seeds on --help, without touching the database", async () => {
		const { code, out } = await run(["--help"]);

		expect(code).toBe(0);
		expect(out).toMatch(/--fresh/);
		expect(out).toMatch(/Seeds: pages/);
	});

	it("answers 1 and sets the exit code when a seed fails", async () => {
		const { code, out } = await run(
			[],
			[
				defineDummySeed({
					id: "boom",
					run: () => Promise.reject(new Error("seed exploded")),
				}),
			],
		);

		expect(code).toBe(1);
		expect(process.exitCode).toBe(1);
		expect(out).toMatch(/failed: seed exploded/);
	});

	it("prints the cause chain, so a Payload error is visible", async () => {
		const { out } = await run(
			[],
			[
				defineDummySeed({
					id: "pages",
					run: async (ctx) => {
						await ctx.doc("pages", { slug: "/no-title" });
					},
				}),
			],
		);

		expect(out).toMatch(/caused by:/);
	});

	it("prefixes a failure once, not twice", async () => {
		const { out } = await run(["--only", "nope"]);

		expect(out).toContain('[payloadcms-dummy] failed: No seed named "nope"');
		expect(out).not.toContain("failed: [payloadcms-dummy]");
	});

	it("answers 1 on an unknown flag rather than throwing", async () => {
		const { code, out } = await run(["--nope"]);

		expect(code).toBe(1);
		expect(out).toMatch(/--fresh/);
	});
});
