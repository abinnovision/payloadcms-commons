import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CapabilityMatrix } from "../api-keys/capability-matrix.js";

type Fields = Record<string, { value: unknown } | undefined>;

const state: { fields: Fields } = { fields: {} };

/*
 * The real module pulls in the whole admin bundle, including SCSS. Only what
 * the component touches matters here, and the checkbox stands in for Payload's
 * so the assertions read this component's own state rather than Payload's
 * markup.
 */
vi.mock("@payloadcms/ui", () => ({
	CheckboxInput: ({
		checked,
		name,
		partialChecked,
		readOnly,
	}: {
		checked?: boolean;
		name?: string;
		partialChecked?: boolean;
		readOnly?: boolean;
	}) => (
		<input
			aria-label={name}
			data-state={partialChecked ? "mixed" : checked ? "on" : "off"}
			defaultChecked={checked}
			disabled={readOnly}
			type="checkbox"
		/>
	),
	FieldDescription: ({ description }: { description: string }) => (
		<div className="field-description">{description}</div>
	),
	FieldLabel: ({ label }: { label: string }) => (
		<span className="field-label">{label}</span>
	),
	useForm: () => ({ dispatchFields: vi.fn(), setModified: vi.fn() }),
	useFormFields: (selector: (args: [Fields]) => unknown) =>
		selector([state.fields]),
}));

const { McpxCapabilityMatrix } = await import("./capability-matrix.js");

const matrix: CapabilityMatrix = {
	collections: [
		{
			fieldName: "pages",
			label: "pages",
			read: true,
			write: true,
			publish: true,
		},
		{
			fieldName: "tags",
			label: "tags",
			read: true,
			write: false,
			publish: false,
		},
		{
			fieldName: "media",
			label: "media",
			read: true,
			write: true,
			publish: false,
			hint: "Files are uploaded in the admin panel.",
		},
	],
	globals: [
		{
			fieldName: "siteSettings",
			label: "site-settings",
			read: true,
			write: false,
			publish: false,
		},
	],
	tools: [{ name: "echo", description: "Echoes the input back." }],
};

const grant = (...paths: string[]): void => {
	state.fields = Object.fromEntries(
		paths.map((path) => [path, { value: true }]),
	);
};

/** The rendered input carrying a given label, so assertions ignore attribute order. */
const box = (html: string, label: string): string =>
	html.match(new RegExp(`<input aria-label="${label}"[^>]*>`))?.[0] ?? "";

const render = (
	props: Partial<{
		field: { admin?: { description?: unknown } };
		readOnly: boolean;
		withinTab: boolean;
	}> = {},
): string =>
	renderToStaticMarkup(<McpxCapabilityMatrix matrix={matrix} {...props} />);

describe("mcpxCapabilityMatrix", () => {
	beforeEach(() => {
		state.fields = {};
	});

	/*
	 * The custom Field replaces the group's rendering, so the chrome that
	 * divides a group from the fields above it has to be drawn here.
	 */
	it("wears Payload's group chrome", () => {
		const html = render();

		expect(html).toContain("group-field group-field--top-level");
		expect(html).toContain('<div class="group-field__wrap">');
		expect(html).toContain(
			'<h3 class="group-field__title"><span class="field-label">Capabilities</span></h3>',
		);
	});

	/*
	 * Payload's own description slot, and the only place the table's two
	 * markings are spelled out.
	 */
	it("carries the field's description under the heading", () => {
		expect(
			render({ field: { admin: { description: "What this key may do." } } }),
		).toContain('<div class="field-description">What this key may do.</div>');
	});

	it("renders no description when the field has none", () => {
		expect(render()).not.toContain("field-description");
	});

	/* Only a group at a tab's edge drops its outer border. */
	it("marks itself as within a tab only when the form has tabs", () => {
		expect(render({ withinTab: true })).toContain("group-field--within-tab");
		expect(render()).not.toContain("group-field--within-tab");
	});

	it("draws a row per entity and per tool", () => {
		const html = render();

		for (const label of ["pages", "tags", "media", "site-settings", "echo"]) {
			expect(html).toContain(`>${label}<`);
		}
	});

	/*
	 * A missing checkbox used to read as a gap. A dash says the config withheld
	 * the operation, which is a different thing from a capability left off.
	 */
	it("renders a dash where the config exposes nothing", () => {
		const html = render();

		expect(html.match(/—/g)).toHaveLength(3);
		expect(html).toContain("The plugin config does not expose this.");
	});

	/* Globals expose read only here, so a whole column of dashes never appears. */
	it("drops a column no row exposes", () => {
		const html = render();

		expect(html).toContain("Read every globals entry");
		expect(html).not.toContain("Write every globals entry");
		expect(html).not.toContain("Publish every globals entry");
	});

	/* The one place an operation is explained, so it must be on the header. */
	it("explains each operation on its column header", () => {
		expect(render()).toContain('title="Describe, find and read."');
	});

	it("reflects granted capabilities", () => {
		grant("capabilities.collections.pages.read");

		expect(box(render(), "Read pages")).toContain('data-state="on"');
		expect(box(render(), "Read tags")).toContain('data-state="off"');
	});

	it("marks a partly granted column indeterminate", () => {
		grant("capabilities.collections.pages.read");

		expect(render()).toContain('data-state="mixed"');
	});

	it("marks a fully granted column on, ignoring dashes", () => {
		grant(
			"capabilities.collections.pages.write",
			"capabilities.collections.media.write",
		);

		expect(render()).toContain('data-state="on"');
	});

	it("disables every input when the field is read-only", () => {
		const html = render({ readOnly: true });
		const inputs = html.match(/<input[^>]*>/g) ?? [];

		expect(inputs.length).toBeGreaterThan(0);
		expect(inputs.every((input) => input.includes('disabled=""'))).toBe(true);
	});
});
