import { describe, expect, expectTypeOf, it } from "vitest";

import { defineLinks, variantsOf } from "./define-links.js";
import { resolveLink } from "../runtime/resolve-link.js";

import type {
	LinkContextOf,
	LinkDataOf,
	ResolvedLinkOf,
} from "./define-links.js";

interface AppContext {
	filesBase: string;
}

/*
 * The declaration under test. Its whole point is what the compiler can say
 * about it, so most of what follows are type assertions rather than value
 * assertions: `expectTypeOf` fails the build, not the run.
 */
const links = defineLinks<AppContext>()((variant) => ({
	variants: {
		action: variant({
			label: "Action",
			fields: [{ name: "action", type: "select", options: ["renew", "open"] }],
		}).resolve(({ link }) => ({ href: "", performed: link.action })),
		download: variant({
			label: "Download",
			fields: [
				{ name: "fileName", type: "text" },
				{ name: "inline", type: "checkbox" },
			],
		}).resolve(({ link, context }) => ({
			href: `${context.filesBase}/${link.fileName ?? ""}`,
			download: link.inline !== true,
		})),
	},
}));

describe("defineLinks", () => {
	it("types a variant's own fields inside its own resolver", () => {
		/*
		 * The inward direction, and the reason the builder takes two calls: a
		 * resolver cannot be contextually typed from a sibling property of the
		 * same object literal, so the fields go through `variant(...)` first.
		 */
		expectTypeOf(links.variants.action.resolve)
			.parameter(0)
			.toHaveProperty("link")
			.toHaveProperty("action")
			.toEqualTypeOf<"renew" | "open" | null | undefined>();
	});

	it("derives a select's values from its own options", () => {
		expectTypeOf<LinkDataOf<typeof links>>()
			.toHaveProperty("action")
			.toEqualTypeOf<"renew" | "open" | null | undefined>();
	});

	it("derives an array for a multi-value select", () => {
		/*
		 * `hasMany` changes the stored value to an array. Checked before the
		 * scalar case, because typing it as a scalar would be wrong rather
		 * than merely vague, and a wrong type gets believed.
		 */
		const multi = defineLinks()((variant) => ({
			variants: {
				tagged: variant({
					label: "Tagged",
					fields: [
						{
							name: "tags",
							type: "select",
							hasMany: true,
							options: ["a", "b"],
						},
					],
				}),
			},
		}));

		expectTypeOf<LinkDataOf<typeof multi>>()
			.toHaveProperty("tags")
			.toEqualTypeOf<("a" | "b")[] | null | undefined>();
	});

	it("derives the field types it models", () => {
		const modelled = defineLinks()((variant) => ({
			variants: {
				mixed: variant({
					label: "Mixed",
					fields: [
						{ name: "when", type: "date" },
						{ name: "size", type: "radio", options: ["s", "m"] },
						{ name: "target", type: "relationship", relationTo: "pages" },
					],
				}),
			},
		}));

		expectTypeOf<LinkDataOf<typeof modelled>>()
			.toHaveProperty("when")
			.toEqualTypeOf<string | null | undefined>();
		expectTypeOf<LinkDataOf<typeof modelled>>()
			.toHaveProperty("size")
			.toEqualTypeOf<"s" | "m" | null | undefined>();
		expectTypeOf<LinkDataOf<typeof modelled>>()
			.toHaveProperty("target")
			.toEqualTypeOf<
				string | number | { id: string | number } | null | undefined
			>();
	});

	it("lets a variant name what cannot be derived", () => {
		/*
		 * A `group` resolves to `unknown`, because guessing at its shape would
		 * produce something wrong rather than something vague. Naming it keeps
		 * the rest of the declaration derived.
		 */
		interface ScheduleData {
			window?: { from: string } | null;
		}

		const scheduled = defineLinks()((variant) => ({
			variants: {
				scheduled: variant({
					label: "Scheduled",
					fields: [{ name: "window", type: "group", fields: [] }],
				})
					.data<ScheduleData>()
					.resolve(({ link }) => ({ href: link.window?.from ?? "/" })),
			},
		}));

		expectTypeOf<LinkDataOf<typeof scheduled>>()
			.toHaveProperty("window")
			.toEqualTypeOf<{ from: string } | null | undefined>();
	});

	it("derives scalar field types", () => {
		expectTypeOf<LinkDataOf<typeof links>>()
			.toHaveProperty("fileName")
			.toEqualTypeOf<string | null | undefined>();
		expectTypeOf<LinkDataOf<typeof links>>()
			.toHaveProperty("inline")
			.toEqualTypeOf<boolean | null | undefined>();
	});

	it("unions the declared keys with the built-in types", () => {
		expectTypeOf<LinkDataOf<typeof links>>()
			.toHaveProperty("type")
			.toEqualTypeOf<
				| "none"
				| "reference"
				| "custom"
				| "same-page"
				| "action"
				| "download"
				| null
				| undefined
			>();
	});

	it("collects what every resolver contributes", () => {
		/*
		 * Optional, because each variant returns only its own: requiring the
		 * whole union would mean every variant had to return the others'.
		 */
		expectTypeOf<ResolvedLinkOf<typeof links>>()
			.toHaveProperty("download")
			.toEqualTypeOf<boolean | undefined>();
		expectTypeOf<ResolvedLinkOf<typeof links>>()
			.toHaveProperty("performed")
			.toEqualTypeOf<"renew" | "open" | null | undefined>();
	});

	it("puts each variant's key back as its value", () => {
		expect(variantsOf({ links }).map((it) => it.value)).toEqual([
			"action",
			"download",
		]);
	});

	it("returns nothing when no declaration is given", () => {
		expect(variantsOf({})).toEqual([]);
	});
});

describe("inference at the call site", () => {
	/*
	 * The declaration has to carry its resolvers' return type through to
	 * whoever resolves a link, or the caller has to annotate the result and the
	 * derived typing stops paying for itself.
	 */
	it("infers what a resolver contributes without an annotation", () => {
		const resolved = resolveLink({
			link: { type: "download", fileName: "report.pdf" },
			mappings: [],
			locale: "en",
			links,
			context: { filesBase: "/files" },
		});

		expectTypeOf(resolved).toExtend<
			{ download?: boolean | undefined } | null | { href: string }
		>();
		expect(resolved).toEqual({ href: "/files/report.pdf", download: true });
	});

	it("recovers the context a declaration's resolvers expect", () => {
		expectTypeOf<LinkContextOf<typeof links>>().toEqualTypeOf<AppContext>();
	});

	it("rejects a context the declaration does not expect", () => {
		/*
		 * Without the declaration deciding this, `context` falls back to the
		 * array form's own parameter and any shape at all satisfies it — the
		 * argument would be carried all the way to a resolver that cannot use
		 * it.
		 */
		resolveLink({
			link: { type: "download" },
			mappings: [],
			locale: "en",
			links,
			// @ts-expect-error the declaration's resolvers expect AppContext
			context: { totallyWrong: 123 },
		});

		expect(true).toBe(true);
	});
});
