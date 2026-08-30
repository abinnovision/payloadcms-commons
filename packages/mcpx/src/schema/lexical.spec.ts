import { getEnabledNodes } from "@payloadcms/richtext-lexical";
import { createHeadlessEditor } from "@payloadcms/richtext-lexical/lexical/headless";
import { beforeAll, describe, expect, it } from "vitest";

import {
	allowedNodeTypes,
	nodeProblems,
	REQUIRED_NODE_PROPERTIES,
	ROOT_PROPERTIES,
} from "./lexical.js";
import { buildFixtureConfig } from "../../test/fixtures/config.js";

import type { LexicalEditor } from "@payloadcms/richtext-lexical/lexical";
import type { RichTextField, SanitizedConfig } from "payload";

/**
 * Holds {@link REQUIRED_NODE_PROPERTIES} to the rule it states, against the
 * node classes `@payloadcms/richtext-lexical` actually ships: every listed
 * property must matter when omitted, and every property that matters must be
 * listed. It fails when a Lexical or Payload upgrade moves either boundary,
 * which is the only way to know the table is still true.
 */

let config: SanitizedConfig;
let field: RichTextField;
/** Simple editor: its blocks are not self-referential, so it can be described. */
let describable: RichTextField;

beforeAll(async () => {
	config = await buildFixtureConfig();

	const posts = config.collections.find(({ slug }) => slug === "posts");
	const named = (name: string) =>
		posts?.flattenedFields.find(
			(candidate) => "name" in candidate && candidate.name === name,
		) as RichTextField;

	field = named("content");
	describable = named("summary");
});

/**
 * The JSON Schema Payload generates for a rich text value, which is what types
 * the field in `payload-types.ts`. Asking a field whose blocks reference
 * themselves recurses until the stack gives out, which is why it is read from a
 * simple editor and why nothing calls it at runtime.
 */
interface DeclaredRoot {
	additionalProperties: boolean;
	properties: {
		children: { items: { required: string[] } };
	} & Record<string, unknown>;
	required: string[];
}

const declaredSchema = (): { properties: { root: DeclaredRoot } } =>
	(
		describable.editor as unknown as {
			outputSchema: (args: unknown) => never;
		}
	).outputSchema({
		collectionIDFieldTypes: {},
		config,
		field: describable,
		interfaceNameDefinitions: new Map(),
		isRequired: false,
	});

interface LexicalEditorField {
	editor: {
		editorConfig: Parameters<typeof getEnabledNodes>[0]["editorConfig"];
	};
}

/**
 * The hydration the admin editor performs, as a value: the exported state, or
 * the error Lexical reported. Lexical routes a failed update to `onError`
 * rather than rethrowing, so the handler is where a throw shows up.
 */
const hydrate = (state: unknown): { error?: string; exported?: unknown } => {
	let failure: unknown;

	const editor: LexicalEditor = createHeadlessEditor({
		nodes: getEnabledNodes({
			editorConfig: (field as unknown as LexicalEditorField).editor
				.editorConfig,
		}),
		onError: (error: unknown) => {
			failure ??= error;
		},
	});

	try {
		editor.update(
			() => {
				editor.setEditorState(editor.parseEditorState(state as never));
			},
			{ discrete: true },
		);
	} catch (error) {
		failure ??= error;
	}

	return failure
		? { error: (failure as Error).message }
		: { exported: editor.getEditorState().toJSON() };
};

/** Ids the node classes generate would differ on every hydration. */
const stable = (value: unknown): string =>
	JSON.stringify(value, (key, entry: unknown) =>
		key === "id" && typeof entry === "string" ? "<id>" : entry,
	);

const text = (value = "hi") => ({
	detail: 0,
	format: 0,
	mode: "normal",
	style: "",
	text: value,
	type: "text",
	version: 1,
});

const element = (
	type: string,
	extra: Record<string, unknown> = {},
	children: unknown[] = [text()],
) => ({
	children,
	direction: "ltr",
	format: "",
	indent: 0,
	type,
	version: 1,
	...extra,
});

/**
 * One fully serialized node per table entry, as the editor would export it,
 * and the state it has to sit in to be legal.
 */
const SAMPLES: Record<
	string,
	{ node: Record<string, unknown>; wrap?: (node: unknown) => unknown }
> = {
	autolink: {
		node: element("autolink", {
			fields: { linkType: "custom", url: "https://example.dev" },
		}),
		wrap: (node) => element("paragraph", {}, [node]),
	},
	block: {
		node: {
			fields: { blockType: "callout", tone: "info" },
			format: "",
			type: "block",
			version: 2,
		},
	},
	heading: { node: element("heading", { tag: "h2" }) },
	inlineBlock: {
		node: {
			fields: { blockType: "badge", label: "new" },
			type: "inlineBlock",
			version: 1,
		},
		wrap: (node) => element("paragraph", {}, [node]),
	},
	link: {
		node: element("link", {
			fields: { linkType: "custom", newTab: false, url: "/x" },
		}),
		wrap: (node) => element("paragraph", {}, [node]),
	},
	list: {
		node: element("list", { listType: "bullet", start: 1, tag: "ul" }, [
			element("listitem", { value: 1 }),
		]),
	},
	listitem: {
		node: element("listitem", { value: 1 }),
		wrap: (node) =>
			element("list", { listType: "bullet", start: 1, tag: "ul" }, [node]),
	},
	paragraph: {
		node: element("paragraph", { textFormat: 0, textStyle: "" }),
	},
	quote: { node: element("quote") },
	relationship: {
		node: {
			format: "",
			relationTo: "tags",
			type: "relationship",
			value: 1,
			version: 2,
		},
	},
	tab: {
		node: {
			detail: 2,
			format: 0,
			mode: "normal",
			style: "",
			text: "\t",
			type: "tab",
			version: 1,
		},
		wrap: (node) => element("paragraph", {}, [node]),
	},
	text: { node: text(), wrap: (node) => element("paragraph", {}, [node]) },
	upload: {
		node: {
			fields: null,
			format: "",
			relationTo: "media",
			type: "upload",
			value: 1,
			version: 3,
		},
	},
};

/**
 * A value the constraint cannot accept, so that breaking one property is a
 * question the node class answers rather than one the test assumes.
 */
const rejected = (constraint: unknown): unknown => {
	if (typeof constraint === "object" && constraint !== null) {
		return "not-the-pinned-value";
	}

	return constraint === "number" ? "0" : constraint === "direction" ? 0 : 0;
};

const stateOf = (type: string, node: unknown) => ({
	root: {
		children: [SAMPLES[type]?.wrap?.(node) ?? node],
		direction: "ltr",
		format: "",
		indent: 0,
		type: "root",
		version: 1,
	},
});

describe("rEQUIRED_NODE_PROPERTIES", () => {
	it("covers every node type it claims with a sample", () => {
		expect(Object.keys(SAMPLES).sort()).toEqual(
			Object.keys(REQUIRED_NODE_PROPERTIES).sort(),
		);
	});

	describe.each(Object.entries(SAMPLES))("a %s node", (type, { node }) => {
		const baseline = () => {
			const result = hydrate(stateOf(type, node));

			expect(result.error).toBeUndefined();

			return stable(result.exported);
		};

		const without = (property: string) => {
			const stripped = Object.fromEntries(
				Object.entries(node).filter(([key]) => key !== property),
			);

			return hydrate(stateOf(type, stripped));
		};

		it("hydrates as written", () => {
			expect(baseline()).toBeTypeOf("string");
		});

		const required = REQUIRED_NODE_PROPERTIES[type] ?? {};

		it.each(Object.keys(required))(
			'is not the same node without "%s"',
			(property) => {
				const complete = baseline();
				const result = without(property);

				expect(
					result.error === undefined && stable(result.exported) === complete,
				).toBe(false);
			},
		);

		it.each(Object.keys(required))(
			'is not the same node with the wrong "%s"',
			(property) => {
				const complete = baseline();
				const result = hydrate(
					stateOf(type, { ...node, [property]: rejected(required[property]) }),
				);

				expect(
					result.error === undefined && stable(result.exported) === complete,
				).toBe(false);
			},
		);

		/*
		 * "version" lands here on purpose. The plugin requires it because
		 * Payload declares it, not because Lexical reacts to it, and this is
		 * where that distinction is visible.
		 */
		const optional = Object.keys(node).filter(
			(property) => property !== "type" && !(property in required),
		);

		it.each(optional)('reads back unchanged without "%s"', (property) => {
			const complete = baseline();
			const result = without(property);

			expect(result.error).toBeUndefined();
			expect(stable(result.exported)).toBe(complete);
		});
	});
});

/**
 * The root, and the two properties every node carries, are the only shape
 * Payload states itself. These hold the plugin to that statement, so an upgrade
 * that widens or narrows it fails here rather than passing silently.
 */
describe("what Payload declares", () => {
	it("agrees with ROOT_PROPERTIES, down to refusing an unknown one", () => {
		const root = declaredSchema().properties.root;

		expect(Object.keys(ROOT_PROPERTIES).sort()).toEqual(
			[...root.required].sort(),
		);
		expect(Object.keys(ROOT_PROPERTIES).sort()).toEqual(
			Object.keys(root.properties).sort(),
		);
		expect(root).toMatchObject({ additionalProperties: false });
	});

	it("requires of every node what the plugin requires of every node", () => {
		const children =
			declaredSchema().properties.root.properties.children.items.required;

		expect([...children].sort()).toEqual(["type", "version"]);

		/*
		 * "type" is refused earlier, by the node type check, so only "version"
		 * reaches the property check - for a node the measured table covers and
		 * one it does not.
		 */
		expect(nodeProblems({ type: "horizontalrule" }).missing).toEqual([
			"version",
		]);
		expect(nodeProblems({ type: "quote" }).missing).toContain("version");
	});
});

/**
 * Lexical registers the core nodes whatever the features do, so
 * `allowedNodeTypes` states them itself. That is a hardcoded list about someone
 * else's library, and this is what keeps it honest.
 */
describe("allowedNodeTypes", () => {
	/** The node types an editor built from this field can actually hydrate. */
	const registeredFor = (target: RichTextField): string[] => {
		const editor = createHeadlessEditor({
			nodes: getEnabledNodes({
				editorConfig: (target as unknown as LexicalEditorField).editor
					.editorConfig,
			}),
			onError: () => undefined,
		});

		return [
			...(editor as unknown as { _nodes: Map<string, unknown> })._nodes.keys(),
		].sort();
	};

	/* Resolved in the test body: the fields do not exist until `beforeAll`. */
	const CASES: [string, () => RichTextField][] = [
		["an editor with every feature", () => field],
		["an editor with two", () => describable],
	];

	it.each(CASES)("allows nothing %s cannot hydrate", (_label, target) => {
		const registered = registeredFor(target());

		expect(
			allowedNodeTypes(target()).filter((type) => !registered.includes(type)),
		).toEqual([]);
	});

	/*
	 * The gap in the other direction is deliberate but has to stay this small:
	 * "artificial" is Lexical's own internal node, never content. A new name
	 * here is a decision to make, not a result to accept.
	 */
	it.each(CASES)(
		"rejects only Lexical's internal node of %s",
		(_label, target) => {
			const allowed = allowedNodeTypes(target());

			expect(
				registeredFor(target()).filter((type) => !allowed.includes(type)),
			).toEqual(["artificial"]);
		},
	);

	it("states the core nodes no feature contributes", () => {
		/* The two-feature editor's features register only "heading". */
		expect(allowedNodeTypes(describable).sort()).toEqual([
			"heading",
			"linebreak",
			"paragraph",
			"root",
			"tab",
			"text",
		]);
	});
});
