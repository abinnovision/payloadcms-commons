import { describe, expect, it } from "vitest";

import { linkField } from "./link-field.js";
import { defineLinks } from "../pattern/define-links.js";

/**
 * The slice of a field this module produces. Payload's own `Field` union is
 * discriminated on `type`, which makes reading a sub-field by name in a test
 * a chain of narrowings that says nothing about the behaviour under test.
 */
interface FieldLike {
	name?: string;
	type: string;
	required?: boolean;
	hidden?: boolean;
	localized?: boolean;
	interfaceName?: string;
	defaultValue?: unknown;
	options?: { label: unknown; value: string }[];
	fields?: FieldLike[];
	admin?: {
		condition?: (
			data: unknown,
			siblingData: { type?: string | null },
		) => boolean;
	};
}

const build = (args: Parameters<typeof linkField>[0]): FieldLike =>
	linkField(args) as unknown as FieldLike;

/** Sub-fields, with the presentation-only `row` flattened away. */
const subFields = (group: FieldLike): FieldLike[] =>
	(group.fields ?? []).flatMap((it) =>
		it.type === "row" ? (it.fields ?? []) : [it],
	);

const sub = (group: FieldLike, name: string): FieldLike | undefined =>
	subFields(group).find((it) => it.name === name);

const optionValues = (group: FieldLike): string[] =>
	(sub(group, "type")?.options ?? []).map((it) => it.value);

describe("linkField", () => {
	it("emits a `link` group", () => {
		const field = build({ relationTo: ["articles"] });

		expect(field.name).toBe("link");
		expect(field.type).toBe("group");
	});

	it("emits the expected sub-fields", () => {
		const field = build({ relationTo: ["articles"] });

		expect(subFields(field).map((it) => it.name)).toEqual([
			"label",
			"type",
			"newTab",
			"reference",
			"url",
			"samePageIdentifier",
		]);
	});

	it("gives each sub-field its expected type", () => {
		const field = build({ relationTo: ["articles"] });

		expect(sub(field, "type")?.type).toBe("radio");
		expect(sub(field, "newTab")?.type).toBe("checkbox");
		expect(sub(field, "reference")?.type).toBe("relationship");
		expect(sub(field, "url")?.type).toBe("text");
		expect(sub(field, "samePageIdentifier")?.type).toBe("text");
	});

	/*
	 * A package cannot claim a global generated-type name, and two calls with
	 * different targets would collide on it.
	 */
	it("declares no interface name by default", () => {
		expect(build({ relationTo: ["articles"] }).interfaceName).toBeUndefined();
	});

	it("declares the interface name it is given", () => {
		expect(
			build({ relationTo: ["articles"], interfaceName: "NavigationLink" })
				.interfaceName,
		).toBe("NavigationLink");
	});

	it("hides the label field unless labels are asked for", () => {
		expect(build({ relationTo: ["articles"] }).fields?.[0]?.hidden).toBe(true);
		expect(
			build({ relationTo: ["articles"], withLabel: true }).fields?.[0]?.hidden,
		).toBe(false);
	});
});

describe("linkField type options", () => {
	it("omits `none` while the link is required", () => {
		const field = build({ relationTo: ["articles"] });

		expect(optionValues(field)).toEqual(["reference", "custom", "same-page"]);
		expect(sub(field, "type")?.defaultValue).toBe("reference");
	});

	it("offers `none` when the link is optional", () => {
		const field = build({ relationTo: ["articles"], required: false });

		expect(optionValues(field)).toEqual([
			"none",
			"reference",
			"custom",
			"same-page",
		]);
		expect(sub(field, "type")?.defaultValue).toBe("none");
	});

	it("appends app-declared variants after the built-ins", () => {
		const links = defineLinks()(() => ({
			variants: {
				download: { label: "Download" },
				dialog: { label: "Dialog" },
			},
		}));

		expect(optionValues(build({ relationTo: ["articles"], links }))).toEqual([
			"reference",
			"custom",
			"same-page",
			"download",
			"dialog",
		]);
	});
});

describe("linkField conditional sub-fields", () => {
	const field = build({ relationTo: ["articles"] });
	const cases: [string, string][] = [
		["reference", "reference"],
		["url", "custom"],
		["samePageIdentifier", "same-page"],
	];

	/*
	 * Payload validates hidden fields too, so a plain `required: true` behind a
	 * condition would block saving whenever a different link type is selected.
	 * Required-ness is re-implemented inside `validate` instead.
	 */
	it.each(cases)("declares `%s` as not required", (name) => {
		expect(sub(field, name)?.required).toBe(false);
	});

	it.each(cases)("shows `%s` only for the `%s` type", (name, type) => {
		const condition = sub(field, name)?.admin?.condition;

		const shown = ["none", "reference", "custom", "same-page"].filter((it) =>
			condition?.(undefined, { type: it }),
		);

		expect(shown).toEqual([type]);
	});
});

describe("linkField variant fields", () => {
	const links = defineLinks()((variant) => ({
		variants: {
			download: variant({
				label: "Download",
				fields: [{ name: "fileName", type: "text" }],
			}),
		},
	}));
	const field = build({ relationTo: ["articles"], links });

	it("appends a variant's own fields to the group", () => {
		expect(subFields(field).map((it) => it.name)).toContain("fileName");
	});

	it("shows a variant's field only for that variant's value", () => {
		const condition = sub(field, "fileName")?.admin?.condition;

		expect(condition?.(undefined, { type: "download" })).toBe(true);
		expect(condition?.(undefined, { type: "custom" })).toBe(false);
	});
});

describe("linkField with a variant claiming a built-in value", () => {
	/*
	 * A variant may replace how a built-in resolves rather than adding a new
	 * link type, so the option has to appear once, with the variant's label,
	 * and in the built-in's original position: editors read this list by shape.
	 */
	const links = defineLinks()(() => ({
		variants: { "same-page": { label: "Jump to section" } },
	}));
	const field = build({ relationTo: ["pages"], links });

	it("offers the value once, with the variant's own label", () => {
		const options = sub(field, "type")?.options ?? [];
		const samePage = options.filter((it) => it.value === "same-page");

		expect(samePage).toHaveLength(1);
		expect(samePage[0]?.label).toBe("Jump to section");
	});

	it("keeps the built-in's position in the list", () => {
		expect(optionValues(field)).toEqual(["reference", "custom", "same-page"]);
	});
});
