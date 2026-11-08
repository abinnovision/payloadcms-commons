import { describe, expect, it } from "vitest";

import { contextFromPath } from "./route-context.js";

describe("contextFromPath", () => {
	it("gives the dashboard only its route", () => {
		expect(contextFromPath("/admin", "/admin")).toEqual({ route: "/admin" });
	});

	it("names the collection of a list and a create view", () => {
		expect(contextFromPath("/admin/collections/pages", "/admin")).toEqual({
			route: "/admin/collections/pages",
			collection: "pages",
		});
		expect(
			contextFromPath("/admin/collections/pages/create", "/admin"),
		).toEqual({
			route: "/admin/collections/pages/create",
			collection: "pages",
		});
	});

	it("names the document of an edit view and its sub-views", () => {
		expect(contextFromPath("/admin/collections/pages/12", "/admin")).toEqual({
			route: "/admin/collections/pages/12",
			collection: "pages",
			id: "12",
		});
		expect(
			contextFromPath("/admin/collections/pages/12/versions", "/admin"),
		).toEqual({
			route: "/admin/collections/pages/12/versions",
			collection: "pages",
			id: "12",
		});
	});

	it("names the document of a trashed document's view", () => {
		expect(
			contextFromPath("/admin/collections/posts/trash/5", "/admin"),
		).toEqual({
			route: "/admin/collections/posts/trash/5",
			collection: "posts",
			id: "5",
		});
		expect(contextFromPath("/admin/collections/posts/trash", "/admin")).toEqual(
			{ route: "/admin/collections/posts/trash", collection: "posts" },
		);
	});

	it("names the global of a global view", () => {
		expect(contextFromPath("/admin/globals/settings", "/admin")).toEqual({
			route: "/admin/globals/settings",
			global: "settings",
		});
	});

	it("follows a custom admin route", () => {
		expect(contextFromPath("/cms/collections/pages/12", "/cms/")).toEqual({
			route: "/cms/collections/pages/12",
			collection: "pages",
			id: "12",
		});
		expect(contextFromPath("/collections/pages/12", "/")).toEqual({
			route: "/collections/pages/12",
			collection: "pages",
			id: "12",
		});
	});

	it("gives a path outside the admin route only its route", () => {
		expect(
			contextFromPath("/administrator/collections/pages/12", "/admin"),
		).toEqual({ route: "/administrator/collections/pages/12" });
		expect(contextFromPath("/admin/account", "/admin")).toEqual({
			route: "/admin/account",
		});
	});
});
