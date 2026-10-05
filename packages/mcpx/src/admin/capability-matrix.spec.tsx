import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CapabilityMatrix } from "../api-keys/capability-matrix.js";

type Fields = Record<string, { value: unknown } | undefined>;

const state: { fields: Fields; language: string } = {
	fields: {},
	language: "en",
};

/*
 * The real module pulls in the whole admin bundle, including SCSS. Only what
 * the component touches matters here, and the stand-ins keep the props the
 * assertions read: the button style and its radio attributes.
 */
vi.mock("@payloadcms/ui", () => ({
	Button: ({
		buttonStyle,
		children,
		className,
		disabled,
		extraButtonProps,
	}: {
		buttonStyle?: string;
		children?: React.ReactNode;
		className?: string;
		disabled?: boolean;
		extraButtonProps?: Record<string, unknown>;
	}) => (
		<button
			className={[`btn--style-${buttonStyle ?? ""}`, className]
				.filter(Boolean)
				.join(" ")}
			disabled={disabled}
			type="button"
			{...extraButtonProps}
		>
			{children}
		</button>
	),
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
		<div>{description}</div>
	),
	FieldLabel: ({ label }: { label: string }) => <span>{label}</span>,
	Pill: ({ children }: { children?: React.ReactNode }) => (
		<div className="pill">{children}</div>
	),
	useConfig: () => ({
		getEntityConfig: ({
			collectionSlug,
			globalSlug,
		}: {
			collectionSlug?: string;
			globalSlug?: string;
		}) => ({
			label: globalSlug,
			labels: {
				plural:
					collectionSlug === "bins"
						? { en: "Bins", de: "Behälter" }
						: collectionSlug,
			},
		}),
	}),
	useForm: () => ({ dispatchFields: vi.fn(), setModified: vi.fn() }),
	useTranslation: () => ({
		i18n: { fallbackLanguage: "en", language: state.language },
	}),
	useFormFields: (selector: (args: [Fields]) => unknown) =>
		selector([state.fields]),
}));

const { McpxCapabilityMatrix } = await import("./capability-matrix.js");

const matrix: CapabilityMatrix = {
	collections: [
		{
			fieldName: "pages",
			slug: "pages",
			read: true,
			write: true,
			publish: true,
			delete: false,
			deleteUnattended: false,
		},
		{
			fieldName: "tags",
			slug: "tags",
			read: true,
			write: false,
			publish: false,
			delete: false,
			deleteUnattended: false,
		},
		{
			fieldName: "bins",
			slug: "bins",
			read: true,
			write: false,
			publish: false,
			delete: true,
			deleteUnattended: true,
		},
		{
			fieldName: "crates",
			slug: "crates",
			read: true,
			write: false,
			publish: false,
			delete: true,
			deleteUnattended: false,
		},
		{
			fieldName: "media",
			slug: "media",
			read: true,
			write: true,
			publish: false,
			delete: false,
			deleteUnattended: false,
			live: true,
		},
	],
	globals: [
		{
			fieldName: "siteSettings",
			slug: "site-settings",
			read: true,
			write: false,
			publish: false,
			delete: false,
			deleteUnattended: false,
		},
	],
	tools: [{ name: "echo", description: "Echoes the input back." }],
};

const grant = (...paths: string[]): void => {
	state.fields = Object.fromEntries(
		paths.map((path) => [path, { value: true }]),
	);
};

/**
 * The radio group carrying a given label, so assertions read one control.
 */
const group = (html: string, label: string): string =>
	html.match(
		new RegExp(`<div aria-label="${label}"[^>]*role="radiogroup">.*?</div>`),
	)?.[0] ?? "";

// The segment labels of a control, in order.
const segments = (html: string): string[] =>
	[...html.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map(
		(match) => match[1]!,
	);

// The label of the checked segment, if any.
const checked = (html: string): string | undefined =>
	html.match(/<button[^>]*aria-checked="true"[^>]*>([^<]*)</)?.[1];

// The labels of segments styled as included in the selection.
const included = (html: string): string[] =>
	[...html.matchAll(/<button class="btn--style-pill"[^>]*>([^<]*)</g)].map(
		(match) => match[1]!,
	);

// The checkbox of a control, by its accessible name.
const checkbox = (html: string, name: string): string =>
	html.match(new RegExp(`<input[^>]*aria-label="${name}"[^>]*>`))?.[0] ?? "";

// The approval shield of a delete control, by its accessible label.
const shield = (html: string, name: string): string =>
	html.match(
		new RegExp(
			`<button[^>]*class="[^"]*__shield[^"]*"[^>]*>(?:(?!</button>).)*${name}`,
		),
	)?.[0] ?? "";

const render = (
	props: Partial<{
		field: { admin?: { description?: unknown } };
		readOnly: boolean;
	}> = {},
): string =>
	renderToStaticMarkup(<McpxCapabilityMatrix matrix={matrix} {...props} />);

describe("the McpxCapabilityMatrix component", () => {
	beforeEach(() => {
		state.fields = {};
		state.language = "en";
	});

	/* The custom Field replaces the group's rendering, title included. */
	it("titles the group", () => {
		expect(render()).toContain(">Capabilities<");
	});

	it("leaves the title to the tab when it sits in one", () => {
		const html = renderToStaticMarkup(
			<McpxCapabilityMatrix matrix={matrix} withinTab />,
		);

		expect(html).not.toContain(">Capabilities<");
	});

	/*
	 * Payload's own description slot, and the only place the table's two
	 * markings are spelled out.
	 */
	it("carries the field's description under the heading", () => {
		expect(
			render({ field: { admin: { description: "What this key may do." } } }),
		).toContain("What this key may do.");
	});

	it("draws a row per entity and per tool", () => {
		const html = render();

		for (const label of [
			"pages",
			"tags",
			"Bins",
			"media",
			"site-settings",
			"echo",
		]) {
			expect(html).toContain(`>${label}<`);
		}
	});

	it("shows the label in the admin language with the slug beneath", () => {
		const html = render();

		expect(html).toContain(">Bins<");
		expect(html).toMatch(/<span[^>]*>bins<\/span>/);
		expect(html).toContain("Access for Bins");

		state.language = "de";
		expect(render()).toContain(">Behälter<");
	});

	it("shows the slug alone where the label matches it", () => {
		expect(render()).not.toMatch(/<span[^>]*>pages<\/span>/);
	});

	it("draws no dashes", () => {
		expect(render()).not.toMatch(/—|&mdash;/);
	});

	/* A missing segment says the config withheld the operation. */
	it("offers only the levels the config exposes", () => {
		const html = render();

		expect(segments(group(html, "Access for pages"))).toEqual([
			"None",
			"Read",
			"Write",
			"Publish",
		]);
		expect(segments(group(html, "Access for tags"))).toEqual(["None", "Read"]);
		expect(segments(group(html, "Access for media"))).toEqual([
			"None",
			"Read",
			"Write",
		]);
	});

	it("draws a Delete checkbox only for collections that expose delete", () => {
		const html = render();

		expect(checkbox(html, "Delete Bins")).not.toBe("");
		expect(checkbox(html, "Delete pages")).toBe("");
		expect(html).not.toContain("Delete site-settings");
		expect(html).not.toContain("Delete for every globals entry");
	});

	it("checks Delete for approval and shows the shield pressed", () => {
		grant(
			"capabilities.collections.bins.read",
			"capabilities.collections.bins.delete",
		);
		const html = render();

		expect(checkbox(html, "Delete Bins")).toContain('data-state="on"');
		expect(shield(html, "Approval for deleting Bins")).toContain(
			'aria-pressed="true"',
		);
		expect(shield(html, "Approval for deleting Bins")).not.toContain(
			"mcpx-capabilities__danger",
		);
	});

	it("shows the shield unpressed and dangerous for a direct trash", () => {
		grant(
			"capabilities.collections.bins.read",
			"capabilities.collections.bins.delete",
			"capabilities.collections.bins.deleteUnattended",
		);
		const bins = shield(render(), "Approval for deleting Bins");

		expect(bins).toContain('aria-pressed="false"');
		expect(bins).toContain("mcpx-capabilities__danger");
	});

	it("draws no shield while Delete is off", () => {
		const html = render();

		expect(checkbox(html, "Delete Bins")).toContain('data-state="off"');
		expect(html).not.toContain("Approval for deleting");
	});

	it("pins the shield pressed where the config disallows unattended deletes", () => {
		grant(
			"capabilities.collections.crates.read",
			"capabilities.collections.crates.delete",
		);
		const crates = shield(render(), "Approval for deleting crates");

		expect(crates).toContain('aria-pressed="true"');
		expect(crates).toContain('disabled=""');
		expect(crates).toContain("does not allow unattended deletes");
	});

	it("marks the All delete checkbox mixed while rows differ", () => {
		grant(
			"capabilities.collections.bins.read",
			"capabilities.collections.bins.delete",
		);
		const html = render();

		expect(checkbox(html, "Delete for every collections entry")).toContain(
			'data-state="mixed"',
		);
		expect(html).not.toContain("Approval for deleting every");
	});

	it("selects the granted level and marks the ones it includes", () => {
		grant(
			"capabilities.collections.pages.read",
			"capabilities.collections.pages.write",
		);
		const pages = group(render(), "Access for pages");

		expect(checked(pages)).toBe("Write");
		expect(included(pages)).toEqual(["Read"]);
		expect(pages.match(/role="radio"/g)).toHaveLength(4);
	});

	it("selects nothing in the All control while rows differ", () => {
		grant("capabilities.collections.pages.read");
		const all = group(render(), "Access for every collections entry");

		expect(checked(all)).toBeUndefined();
		expect(included(all)).toEqual([]);
		// With nothing checked, the first segment keeps the group reachable.
		expect(all.match(/tabindex="0"/g)).toHaveLength(1);
	});

	it("selects the All level when every row sits at it", () => {
		expect(checked(group(render(), "Access for every collections entry"))).toBe(
			"None",
		);
	});

	it("explains each level on its segment", () => {
		expect(render()).toContain('title="Describe, find and read."');
	});

	it("badges a row whose writes go live, readable by screen readers", () => {
		const html = render();

		expect(html).toContain('title="Writes go live immediately."');
		expect(html).toMatch(/<span aria-hidden="true">Live<\/span>/);
		expect(html.match(/>Writes go live immediately\.</g)).toHaveLength(1);
	});

	it("disables every control when the field is read-only", () => {
		const html = render({ readOnly: true });
		const controls = html.match(/<(?:input|button)[^>]*>/g) ?? [];

		expect(controls.length).toBeGreaterThan(0);
		expect(controls.every((control) => control.includes('disabled=""'))).toBe(
			true,
		);
	});
});
