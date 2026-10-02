import { beforeAll, describe, expect, it } from "vitest";

import { addressesAdminHidden, stripAdminHidden } from "./admin-hidden.js";
import { buildFixtureConfig } from "../../test/fixtures/config.js";

import type { CollectionConfig, SanitizedConfig } from "payload";

const hidden = { hidden: true };

/** A related collection whose `secret` and `url` are hidden from the admin panel. */
const linked: CollectionConfig = {
	slug: "linked",
	fields: [
		{ name: "title", type: "text" },
		{ name: "secret", type: "text", admin: hidden },
		{ name: "url", type: "text", admin: hidden },
		{ name: "owner", type: "relationship", relationTo: "shapes" },
	],
};

const shapes: CollectionConfig = {
	slug: "shapes",
	fields: [
		{ name: "title", type: "text" },
		{ name: "secret", type: "text", admin: hidden },
		{
			name: "hiddenGroup",
			type: "group",
			admin: hidden,
			fields: [{ name: "inner", type: "text" }],
		},
		{ name: "localizedSecret", type: "text", localized: true, admin: hidden },
		{
			name: "group",
			type: "group",
			fields: [
				{ name: "label", type: "text" },
				{ name: "secret", type: "text", admin: hidden },
			],
		},
		{
			type: "tabs",
			tabs: [
				{
					label: "Plain",
					fields: [
						{ name: "plainLabel", type: "text" },
						{ name: "plainSecret", type: "text", admin: hidden },
					],
				},
				{
					name: "named",
					fields: [
						{ name: "label", type: "text" },
						{ name: "secret", type: "text", admin: hidden },
					],
				},
			],
		},
		{
			type: "row",
			fields: [
				{ name: "rowLabel", type: "text" },
				{ name: "rowSecret", type: "text", admin: hidden },
			],
		},
		{
			type: "collapsible",
			label: "More",
			fields: [{ name: "collapsedSecret", type: "text", admin: hidden }],
		},
		{
			name: "rows",
			type: "array",
			fields: [
				{ name: "label", type: "text" },
				{ name: "secret", type: "text", admin: hidden },
			],
		},
		{
			name: "chunks",
			type: "blocks",
			blocks: [
				{
					slug: "chunk",
					fields: [
						{ name: "label", type: "text" },
						{ name: "secret", type: "text", admin: hidden },
					],
				},
			],
		},
		{ name: "single", type: "relationship", relationTo: "linked" },
		{ name: "many", type: "relationship", relationTo: "linked", hasMany: true },
		{ name: "poly", type: "relationship", relationTo: ["linked", "shapes"] },
		{
			name: "polyMany",
			type: "relationship",
			relationTo: ["linked", "shapes"],
			hasMany: true,
		},
		{ name: "file", type: "upload", relationTo: "media" },
		{ name: "back", type: "join", collection: "linked", on: "owner" },
	],
};

let config: SanitizedConfig;

beforeAll(async () => {
	config = await buildFixtureConfig({ collections: [linked, shapes] });
});

const strip = (doc: Record<string, unknown>, slug = "shapes") =>
	stripAdminHidden(config, { kind: "collection", slug }, doc);

describe("stripAdminHidden", () => {
	it("removes a hidden field and keeps the others", () => {
		expect(
			strip({ id: 1, title: "Kept", secret: "gone", other: "unknown key" }),
		).toEqual({ id: 1, title: "Kept", other: "unknown key" });
	});

	it("removes a hidden group with everything in it", () => {
		expect(strip({ title: "Kept", hiddenGroup: { inner: "gone" } })).toEqual({
			title: "Kept",
		});
	});

	it("removes hidden fields in groups, named tabs, unnamed tabs, rows and collapsibles", () => {
		expect(
			strip({
				group: { label: "kept", secret: "gone" },
				named: { label: "kept", secret: "gone" },
				plainLabel: "kept",
				plainSecret: "gone",
				rowLabel: "kept",
				rowSecret: "gone",
				collapsedSecret: "gone",
			}),
		).toEqual({
			group: { label: "kept" },
			named: { label: "kept" },
			plainLabel: "kept",
			rowLabel: "kept",
		});
	});

	it("removes hidden fields in array rows and block rows", () => {
		expect(
			strip({
				rows: [{ id: "a", label: "kept", secret: "gone" }],
				chunks: [
					{ id: "b", blockType: "chunk", label: "kept", secret: "gone" },
					{ id: "c", blockType: "unknown", secret: "left alone" },
				],
			}),
		).toEqual({
			rows: [{ id: "a", label: "kept" }],
			chunks: [
				{ id: "b", blockType: "chunk", label: "kept" },
				{ id: "c", blockType: "unknown", secret: "left alone" },
			],
		});
	});

	it("reads a populated relation against its own collection and leaves ids alone", () => {
		expect(
			strip({
				single: { id: 1, title: "kept", secret: "gone", url: "gone" },
				many: [{ id: 2, secret: "gone" }, 3],
			}),
		).toEqual({ single: { id: 1, title: "kept" }, many: [{ id: 2 }, 3] });
	});

	it("reads a populated relation nested inside another populated document", () => {
		expect(
			strip({
				single: { id: 1, owner: { id: 9, secret: "gone", title: "kept" } },
			}),
		).toEqual({ single: { id: 1, owner: { id: 9, title: "kept" } } });
	});

	it("reads polymorphic relations by their relationTo", () => {
		expect(
			strip({
				poly: { relationTo: "linked", value: { id: 1, secret: "gone" } },
				polyMany: [
					{ relationTo: "shapes", value: { id: 2, secret: "gone" } },
					{ relationTo: "linked", value: 3 },
				],
			}),
		).toEqual({
			poly: { relationTo: "linked", value: { id: 1 } },
			polyMany: [
				{ relationTo: "shapes", value: { id: 2 } },
				{ relationTo: "linked", value: 3 },
			],
		});
	});

	it("reads the documents of a join", () => {
		expect(
			strip({
				back: { docs: [{ id: 1, secret: "gone", title: "kept" }, 2] },
			}),
		).toEqual({ back: { docs: [{ id: 1, title: "kept" }, 2] } });
	});

	it("keeps the fields Payload adds to an upload collection", () => {
		const file = {
			id: 1,
			alt: "kept",
			url: "/api/media/file/a.png",
			thumbnailURL: null,
			filename: "a.png",
			mimeType: "image/png",
			filesize: 10,
			width: 1,
			height: 1,
			focalX: 50,
			focalY: 50,
			sizes: { thumbnail: { url: "/api/media/file/a-1.png" } },
		};

		expect(strip(file, "media")).toEqual(file);
		expect(strip({ file })).toEqual({ file });
	});

	it("strips a field named like an upload field on a collection that is not one", () => {
		expect(strip({ url: "gone", title: "kept" }, "linked")).toEqual({
			title: "kept",
		});
	});

	it("does not change the document it is given", () => {
		const doc = { secret: "stays", group: { secret: "stays" } };

		strip(doc);

		expect(doc).toEqual({ secret: "stays", group: { secret: "stays" } });
	});

	it("throws for a collection the config does not have", () => {
		expect(() => strip({}, "unknown")).toThrow('Unknown collection "unknown"');
	});
});

describe("addressesAdminHidden", () => {
	const addresses = (path: string, slug = "shapes") =>
		addressesAdminHidden(config, slug, path);

	it("names a hidden field, also inside a group, a tab, an array and a block", () => {
		expect(addresses("secret")).toBe(true);
		expect(addresses("group.secret")).toBe(true);
		expect(addresses("named.secret")).toBe(true);
		expect(addresses("plainSecret")).toBe(true);
		expect(addresses("rows.secret")).toBe(true);
		expect(addresses("chunks.secret")).toBe(true);
	});

	it("names a visible field below a hidden group", () => {
		expect(addresses("hiddenGroup.inner")).toBe(true);
	});

	it("reads a locale segment after a localized field", () => {
		expect(addresses("localizedSecret.en")).toBe(true);
	});

	it("does not name a visible field or an unknown path", () => {
		expect(addresses("title")).toBe(false);
		expect(addresses("group.label")).toBe(false);
		expect(addresses("rows.label")).toBe(false);
		expect(addresses("rows.id")).toBe(false);
		expect(addresses("nothing.here")).toBe(false);
		expect(addresses("single")).toBe(false);
		expect(addresses("unknown.secret", "unknown")).toBe(false);
	});

	it("does not name the fields Payload adds to an upload collection", () => {
		expect(addresses("filename", "media")).toBe(false);
		expect(addresses("url", "media")).toBe(false);
		expect(addresses("sizes.thumbnail.url", "media")).toBe(false);
		expect(addresses("url", "linked")).toBe(true);
	});
});
