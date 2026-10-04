import { beforeAll, describe, expect, it } from "vitest";

import { documentLinks } from "./links.js";
import { buildFixtureConfig } from "../../test/fixtures/config.js";

import type { ResolvedEntity } from "../entity.js";
import type {
	PayloadRequest,
	SanitizedCollectionConfig,
	SanitizedConfig,
	SanitizedGlobalConfig,
} from "payload";

let config: SanitizedConfig;
let pages: SanitizedCollectionConfig;
let notes: SanitizedCollectionConfig;
let siteSettings: SanitizedGlobalConfig;

// Only the config and the request URL are read.
const reqFor = (overrides: Partial<SanitizedConfig> = {}) =>
	({
		url: "https://cms.example.com/api/mcp",
		payload: { config: { ...config, ...overrides } },
	}) as unknown as PayloadRequest;

const collection = (
	base: SanitizedCollectionConfig,
	admin: Record<string, unknown> = {},
): ResolvedEntity => ({
	kind: "collection",
	slug: base.slug,
	config: { ...base, admin: { ...base.admin, ...admin } },
});

beforeAll(async () => {
	config = await buildFixtureConfig();
	pages = config.collections.find((entry) => entry.slug === "pages")!;
	notes = config.collections.find((entry) => entry.slug === "notes")!;
	siteSettings = config.globals.find(
		(entry) => entry.slug === "site-settings",
	)!;
});

describe("documentLinks", () => {
	it("links a collection document at the request origin", async () => {
		expect(
			await documentLinks(reqFor(), {
				target: collection(pages),
				doc: { id: 7 },
				locale: undefined,
			}),
		).toEqual({
			adminUrl: "https://cms.example.com/admin/collections/pages/7",
		});
	});

	it("links a global by slug and opens the written locale", async () => {
		expect(
			await documentLinks(reqFor(), {
				target: { kind: "global", slug: "site-settings", config: siteSettings },
				doc: {},
				locale: "de",
			}),
		).toEqual({
			adminUrl: "https://cms.example.com/admin/globals/site-settings?locale=de",
		});
	});

	it("prefers serverURL over the request origin", async () => {
		const links = await documentLinks(
			reqFor({ serverURL: "https://public.example.com" }),
			{ target: collection(notes), doc: { id: 1 }, locale: undefined },
		);

		expect(links).toEqual({
			adminUrl: "https://public.example.com/admin/collections/notes/1",
			previewUrl: "https://public.example.com/preview/notes/1",
		});
	});

	it("resolves a relative preview and keeps an absolute one", async () => {
		const links = (preview: string) =>
			documentLinks(reqFor(), {
				target: collection(pages, { preview: () => preview }),
				doc: { id: 1 },
				locale: undefined,
			});

		expect((await links("/p/1")).previewUrl).toBe(
			"https://cms.example.com/p/1",
		);
		expect((await links("https://site.test/p/1")).previewUrl).toBe(
			"https://site.test/p/1",
		);
	});

	it("omits the preview when it throws or returns null", async () => {
		for (const preview of [
			() => {
				throw new Error("boom");
			},
			() => null,
		]) {
			expect(
				await documentLinks(reqFor(), {
					target: collection(pages, { preview }),
					doc: { id: 1 },
					locale: undefined,
				}),
			).toEqual({
				adminUrl: "https://cms.example.com/admin/collections/pages/1",
			});
		}
	});

	it("falls back to the entity livePreview, then the root one", async () => {
		const own = collection(pages, { livePreview: { url: "/own" } });
		const plain = collection(pages);
		const root = reqFor({
			admin: {
				...config.admin,
				livePreview: {
					url: ({ data }: { data: Record<string, unknown> }) =>
						`/root/${String(data["id"])}`,
					collections: ["pages"],
				} as unknown as SanitizedConfig["admin"]["livePreview"],
			},
		});
		const args = { doc: { id: 3 }, locale: undefined };

		expect(
			(await documentLinks(root, { ...args, target: own })).previewUrl,
		).toBe("https://cms.example.com/own");
		expect(
			(await documentLinks(root, { ...args, target: plain })).previewUrl,
		).toBe("https://cms.example.com/root/3");
		expect(
			(await documentLinks(root, { ...args, target: collection(notes) }))
				.previewUrl,
		).toBe("https://cms.example.com/preview/notes/3");
		expect(
			(
				await documentLinks(reqFor(), {
					...args,
					target: plain,
				})
			).previewUrl,
		).toBeUndefined();
	});

	it("prefers admin.preview over livePreview", async () => {
		const links = await documentLinks(reqFor(), {
			target: collection(notes, { livePreview: { url: "/live" } }),
			doc: { id: 2 },
			locale: undefined,
		});

		expect(links.previewUrl).toBe("https://cms.example.com/preview/notes/2");
	});
});
