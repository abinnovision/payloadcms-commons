import { payloadMajor } from "@internal/test-utils/payload-major";
import { getEnabledNodes } from "@payloadcms/richtext-lexical";
import { getRegisteredNode } from "@payloadcms/richtext-lexical/lexical";
import { createHeadlessEditor } from "@payloadcms/richtext-lexical/lexical/headless";
import { beforeAll, describe, expect, it } from "vitest";

import {
	allowedNodeTypes,
	constrainsFields,
	nodeProblems,
	nodePropertiesFor,
	propertyProblem,
	REQUIRED_NODE_PROPERTIES,
	ROOT_PROPERTIES,
} from "./lexical.js";
import { blockOf, findFieldAt } from "./walk.js";
import { node, state, text } from "../../test/builders/lexical.js";
import { buildFixtureConfig, fieldOf } from "../../test/fixtures/config.js";

import type { LexicalEditor } from "@payloadcms/richtext-lexical/lexical";
import type {
	FlattenedBlocksField,
	RichTextField,
	SanitizedConfig,
} from "payload";

/**
 * Holds {@link REQUIRED_NODE_PROPERTIES} to the rule it states, against the
 * node classes `@payloadcms/richtext-lexical` ships: every listed
 * property must matter when omitted, and every property that matters must be
 * listed. It fails when a Lexical or Payload upgrade moves either boundary,
 * which is the only way to know the table is still true.
 */

let config: SanitizedConfig;
let field: RichTextField;
/**
 * Simple editor: its blocks are not self-referential, so it can be described.
 */
let describable: RichTextField;

beforeAll(async () => {
	config = await buildFixtureConfig();
	field = fieldOf(config, "posts", "content") as RichTextField;
	describable = fieldOf(config, "posts", "summary") as RichTextField;
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
		children: { items: { $ref?: string; required?: string[] } };
	} & Record<string, unknown>;
	required: string[];
}

interface Declared {
	definitions: Map<string, { oneOf: { required: string[] }[] }>;
	schema: { properties: { root: DeclaredRoot } };
}

const declaredSchema = (): Declared => {
	const editor = describable.editor as unknown as {
		jsonSchema?: (args: unknown) => never;
		outputSchema?: (args: unknown) => never;
	};
	const generate = (editor.jsonSchema ?? editor.outputSchema) as (
		args: unknown,
	) => never;
	const definitions = new Map();

	const schema = generate.call(editor, {
		collectionIDFieldTypes: {},
		config,
		field: describable,
		interfaceNameDefinitions: definitions,
		isRequired: false,
		typeStringDefinitions: new Set(),
	});

	return { definitions, schema };
};

/**
 * What Payload requires of each node type it declares. Payload 3 states one
 * shape for every node; Payload 4 types each node by its own schema.
 */
const declaredNodeRequirements = (): string[][] => {
	const { definitions, schema } = declaredSchema();
	const items = schema.properties.root.properties.children.items;

	if (items.$ref === undefined) {
		return [items.required ?? []];
	}

	const union = definitions.get(items.$ref.split("/").pop() ?? "");

	return (union?.oneOf ?? []).map((member) => member.required);
};

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
const editorFor = (
	target: RichTextField,
	onError: (error: unknown) => void = () => undefined,
): LexicalEditor =>
	createHeadlessEditor({
		nodes: getEnabledNodes({
			editorConfig: (target as unknown as LexicalEditorField).editor
				.editorConfig,
		}),
		onError,
	});

const hydrate = (state: unknown): { error?: string; exported?: unknown } => {
	let failure: unknown;

	const editor = editorFor(field, (error) => {
		failure ??= error;
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

/**
 * Ids the node classes generate would differ on every hydration.
 */
const stable = (value: unknown): string =>
	JSON.stringify(value, (key, entry: unknown) =>
		key === "id" && typeof entry === "string" ? "<id>" : entry,
	);

/**
 * One fully serialized node per table entry, as the editor would export it,
 * and the state it has to sit in to be legal.
 */
const SAMPLES: Record<
	string,
	{ node: Record<string, unknown>; wrap?: (node: unknown) => unknown }
> = {
	autolink: {
		node: node(
			"autolink",
			{ fields: { linkType: "custom", url: "https://example.dev" } },
			[text()],
		),
		wrap: (sample) => node("paragraph", {}, [sample]),
	},
	block: {
		node: {
			fields: { blockType: "callout", tone: "info" },
			format: "",
			type: "block",
			version: 2,
		},
	},
	heading: { node: node("heading", { tag: "h2" }, [text()]) },
	inlineBlock: {
		node: {
			fields: { blockType: "badge", label: "new" },
			type: "inlineBlock",
			version: 1,
		},
		wrap: (sample) => node("paragraph", {}, [sample]),
	},
	link: {
		node: node(
			"link",
			{ fields: { linkType: "custom", newTab: false, url: "/x" } },
			[text()],
		),
		wrap: (sample) => node("paragraph", {}, [sample]),
	},
	list: {
		node: node("list", { listType: "bullet", start: 1, tag: "ul" }, [
			node("listitem", { value: 1 }, [text()]),
		]),
	},
	listitem: {
		node: node("listitem", { value: 1 }, [text()]),
		wrap: (sample) =>
			node("list", { listType: "bullet", start: 1, tag: "ul" }, [sample]),
	},
	paragraph: {
		node: node("paragraph", { textFormat: 0, textStyle: "" }, [text()]),
	},
	quote: { node: node("quote", {}, [text()]) },
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
		wrap: (sample) => node("paragraph", {}, [sample]),
	},
	text: { node: text(), wrap: (sample) => node("paragraph", {}, [sample]) },
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

const stateOf = (type: string, sample: unknown) =>
	state([SAMPLES[type]?.wrap?.(sample) ?? sample]);

/*
 * Required for the older Lexical in the supported Payload range: Lexical 0.50
 * renumbers list items and forces a tab's text, while 0.41 reads both back.
 */
const KEPT_FOR_OLDER_LEXICAL: Readonly<Record<string, readonly string[]>> = {
	listitem: ["value"],
	tab: ["text"],
};

/**
 * Lexical 0.53, which Payload 4 ships, fills these on import and ignores what
 * the state carries for them. The table keeps them so a patch is checked as
 * strictly on both majors.
 */
const FILLED_BY_LEXICAL_053_WITHOUT: Readonly<
	Record<string, readonly string[]>
> = {
	autolink: ["indent"],
	heading: ["indent"],
	link: ["indent"],
	list: ["indent", "start"],
	listitem: ["indent"],
	paragraph: ["indent"],
	quote: ["indent"],
	tab: ["detail", "format", "mode", "style"],
	text: ["detail", "format", "mode", "style"],
};

const FILLED_BY_LEXICAL_053_WRONG: Readonly<Record<string, readonly string[]>> =
	{
		...FILLED_BY_LEXICAL_053_WITHOUT,
		list: ["indent"],
	};

/**
 * Decorator nodes export `format` as the state wrote it on Payload 4, and
 * always as an empty string on Payload 3.
 */
const FORMAT_AS_WRITTEN_ON_4: readonly string[] = [
	"block",
	"relationship",
	"upload",
];

const isFilled = (
	filled: Readonly<Record<string, readonly string[]>>,
	type: string,
	property: string,
): boolean =>
	payloadMajor() === 4 && (filled[type]?.includes(property) ?? false);

const withoutFormat = (exported: string): string => {
	const parsed = JSON.parse(exported) as {
		root: { children: Record<string, unknown>[] };
	};

	delete parsed.root.children[0]?.["format"];

	return JSON.stringify(parsed);
};

describe("the required node properties table", () => {
	it("covers every node type it claims with a sample", () => {
		expect(Object.keys(SAMPLES).sort()).toEqual(
			Object.keys(REQUIRED_NODE_PROPERTIES).sort(),
		);
	});

	describe.each(Object.entries(SAMPLES))(
		"a %s node",
		(type, { node: sample }) => {
			const baseline = () => {
				const result = hydrate(stateOf(type, sample));

				expect(result.error).toBeUndefined();

				return stable(result.exported);
			};

			const without = (property: string) => {
				const stripped = Object.fromEntries(
					Object.entries(sample).filter(([key]) => key !== property),
				);

				return hydrate(stateOf(type, stripped));
			};

			it("hydrates as written", () => {
				expect(baseline()).toBeTypeOf("string");
			});

			const required = REQUIRED_NODE_PROPERTIES[type] ?? {};
			const measured = Object.keys(required).filter(
				(property) => !KEPT_FOR_OLDER_LEXICAL[type]?.includes(property),
			);

			it.each(measured)('is not the same node without "%s"', (property) => {
				const complete = baseline();
				const result = without(property);
				const same =
					result.error === undefined && stable(result.exported) === complete;

				expect(required).toHaveProperty([property]);
				expect(same).toBe(
					isFilled(FILLED_BY_LEXICAL_053_WITHOUT, type, property),
				);
			});

			it.each(measured)(
				'is not the same node with the wrong "%s"',
				(property) => {
					const complete = baseline();
					const result = hydrate(
						stateOf(type, {
							...sample,
							[property]: rejected(required[property]),
						}),
					);
					const same =
						result.error === undefined && stable(result.exported) === complete;

					expect(same).toBe(
						isFilled(FILLED_BY_LEXICAL_053_WRONG, type, property),
					);
				},
			);

			/*
			 * "version" lands here on purpose. The plugin requires it because
			 * Payload declares it, not because Lexical reacts to it, and this is
			 * where that distinction is visible.
			 */
			const optional = Object.keys(sample).filter(
				(property) => property !== "type" && !(property in required),
			);

			it.each(optional)('reads back unchanged without "%s"', (property) => {
				const complete = baseline();
				const result = without(property);
				const asWritten =
					payloadMajor() === 4 &&
					property === "format" &&
					FORMAT_AS_WRITTEN_ON_4.includes(type);

				expect(result.error).toBeUndefined();
				expect(stable(result.exported)).toBe(
					asWritten ? withoutFormat(complete) : complete,
				);
			});
		},
	);
});

/**
 * The root, and the two properties every node carries, are the only shape
 * Payload states itself. These hold the plugin to that statement, so an upgrade
 * that widens or narrows it fails here rather than passing silently.
 */
describe("what Payload declares", () => {
	it("agrees with ROOT_PROPERTIES, down to refusing an unknown one", () => {
		const root = declaredSchema().schema.properties.root;

		/* Payload 4 declares "version" as deprecated, so it is no longer required. */
		expect(
			Object.keys(ROOT_PROPERTIES)
				.filter((key) => payloadMajor() === 3 || key !== "version")
				.sort(),
		).toEqual([...root.required].sort());
		expect(Object.keys(ROOT_PROPERTIES).sort()).toEqual(
			Object.keys(root.properties).sort(),
		);
		expect(root).toMatchObject({ additionalProperties: false });
	});

	it("requires of every node what the plugin requires of every node", () => {
		const required = declaredNodeRequirements();

		expect(required.length).toBeGreaterThan(0);
		expect(required.every((keys) => keys.includes("type"))).toBe(true);
		/* Payload 4 declares "version" as deprecated and leaves it out. */
		expect(required.every((keys) => keys.includes("version"))).toBe(
			payloadMajor() === 3,
		);

		/*
		 * "type" is refused earlier, by the node type check, so only "version"
		 * reaches the property check, for a node the measured table covers and
		 * for one it does not.
		 */
		expect(nodeProblems({ type: "horizontalrule" }).missing).toEqual([
			"version",
		]);
		expect(nodeProblems({ type: "quote" }).missing).toContain("version");
	});
});

/**
 * The published listing exists so a node can be built without a write being
 * refused first, which is only worth anything if it says exactly what the
 * refusal would have said. These hold it to the same tables the checks read,
 * so a listing that drifts from the enforcement fails here.
 */
describe("nodePropertiesFor", () => {
	it("covers every node type a field allows", () => {
		const types = allowedNodeTypes(field);

		expect(Object.keys(nodePropertiesFor(types)).sort()).toEqual(
			[...types].sort(),
		);
	});

	it("states the measured table, plus what every node carries", () => {
		const listed = nodePropertiesFor(["list", "text"]);

		expect(Object.keys(listed["list"] ?? {})).toEqual([
			...Object.keys(REQUIRED_NODE_PROPERTIES["list"] ?? {}).sort(),
			"type",
			"version",
		]);
		expect(listed["text"]).toEqual({
			detail: "a number",
			format: "a number",
			mode: "a string",
			style: "a string",
			text: "a string",
			type: "a string",
			version: "a number",
		});
	});

	it("gives the root what Payload declares, not the universal set", () => {
		expect(Object.keys(nodePropertiesFor(["root"])["root"] ?? {})).toEqual(
			Object.keys(ROOT_PROPERTIES).sort(),
		);
	});

	/* The same tolerance the checks show: guessing would reject working content. */
	it("claims nothing of a node type the table does not cover", () => {
		expect(nodePropertiesFor(["horizontalrule"])["horizontalrule"]).toEqual({
			type: "a string",
			version: "a number",
		});
	});

	it("words a requirement the way a refused write words it", () => {
		const listed = nodePropertiesFor(["heading", "listitem"]);

		expect(propertyProblem("heading", "tag", 3)?.needs).toBe(
			listed["heading"]?.["tag"],
		);
		expect(propertyProblem("listitem", "direction", "sideways")?.needs).toBe(
			listed["listitem"]?.["direction"],
		);
		expect(
			nodeProblems({ type: "listitem", version: "1" }).rejected,
		).toContainEqual({
			needs: listed["listitem"]?.["version"],
			property: "version",
		});
	});
});

/**
 * Lexical registers the core nodes whatever the features do, so
 * `allowedNodeTypes` states them itself. That is a hardcoded list about someone
 * else's library, and the first case checks it against the real registry.
 */
describe("allowedNodeTypes", () => {
	/* Resolved in the test body: the fields do not exist until `beforeAll`. */
	const CASES: [string, () => RichTextField][] = [
		["an editor with every feature", () => field],
		["an editor with two", () => describable],
	];

	it.each(CASES)("allows nothing %s cannot hydrate", (_label, target) => {
		const editor = editorFor(target());

		expect(
			allowedNodeTypes(target()).filter(
				(type) => getRegisteredNode(editor, type) === undefined,
			),
		).toEqual([]);
	});

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

	it("reports the nodes a field's editor enables", () => {
		const sections = findFieldAt(
			config.collections.find((collection) => collection.slug === "pages")!
				.flattenedFields,
			["layout", "sections"],
			"blocks",
		)!;
		const wrapper = blockOf(config, sections, "sectionWrapper")!;
		const modules = wrapper.flattenedFields.find(
			(candidate) => candidate.type === "blocks",
		) as FlattenedBlocksField;
		const hero = blockOf(config, modules, "hero")!;
		const heroField = (name: string) =>
			hero.flattenedFields.find(
				(candidate) => "name" in candidate && candidate.name === name,
			) as RichTextField;

		expect(allowedNodeTypes(heroField("title"))).not.toContain("heading");
		expect(allowedNodeTypes(heroField("title"))).toContain("paragraph");
		expect(allowedNodeTypes(heroField("body"))).toContain("heading");
		expect(allowedNodeTypes(heroField("body"))).toContain("link");
	});

	it("falls back to the core nodes for unknown editors", () => {
		expect(allowedNodeTypes({ name: "x", type: "richText" })).toEqual([
			"root",
			"paragraph",
			"text",
			"linebreak",
			"tab",
		]);
	});
});

describe("propertyProblem", () => {
	it("holds one property to what the node walk holds it to", () => {
		expect(propertyProblem("listitem", "indent", "0")).toEqual({
			needs: "a number",
		});
		expect(propertyProblem("listitem", "indent", 0)).toBeUndefined();
		expect(propertyProblem("heading", "version", "1")).toEqual({
			needs: "a number",
		});
	});

	it("reads the root from Payload's own declaration", () => {
		expect(propertyProblem("root", "direction", "sideways")).toEqual({
			needs: '"ltr", "rtl" or null',
		});
		expect(propertyProblem("root", "direction", null)).toBeUndefined();
	});

	it("says nothing about a property no table constrains", () => {
		expect(propertyProblem("paragraph", "textFormat", "x")).toBeUndefined();
		expect(propertyProblem("artificial", "whatever", 1)).toBeUndefined();
	});
});

describe("a node type named like an Object.prototype member", () => {
	it("is treated as an unknown type", () => {
		for (const type of ["constructor", "toString", "hasOwnProperty"]) {
			expect(nodeProblems({ type, version: 1 })).toEqual({
				missing: [],
				rejected: [],
			});
			expect(propertyProblem(type, "fields", 1)).toBeUndefined();
			expect(constrainsFields(type)).toBe(false);
			expect(nodePropertiesFor([type])[type]).toEqual({
				type: "a string",
				version: "a number",
			});
		}
	});
});
