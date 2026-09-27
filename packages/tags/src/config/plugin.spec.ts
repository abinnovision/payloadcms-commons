import { describe, expect, it } from "vitest";

import { tagsPlugin } from "./plugin.js";
import { TAGS_CELL_COMPONENT, TAGS_FIELD_COMPONENT } from "../index.js";

import type { TagsPluginArgs } from "./plugin.js";
import type { CollectionConfig, Config } from "payload";

const posts: CollectionConfig = {
	slug: "posts",
	fields: [{ name: "title", type: "text" }],
};

/** The plugin reads only `collections`, so `db` and `secret` are left out. */
const run = (
	args: TagsPluginArgs,
	collections: CollectionConfig[] = [posts],
): Config => {
	const config: Partial<Config> = { collections };

	return tagsPlugin(args)(config as Config) as Config;
};

const collection = (config: Config, slug: string): CollectionConfig => {
	const found = config.collections?.find((c) => c.slug === slug);
	if (!found) {
		throw new Error(`No collection "${slug}".`);
	}

	return found;
};

const findField = (target: CollectionConfig, name: string) =>
	target.fields.find((field) => "name" in field && field.name === name);

describe("tagsPlugin", () => {
	it("generates the tags collection", () => {
		const config = run({ collections: ["posts"] });

		expect(collection(config, "tags").admin?.useAsTitle).toBe("name");
	});

	it("appends a sidebar hasMany relationship with both components", () => {
		const config = run({ collections: ["posts"] });

		expect(findField(collection(config, "posts"), "tags")).toEqual({
			name: "tags",
			type: "relationship",
			relationTo: "tags",
			hasMany: true,
			admin: {
				position: "sidebar",
				components: {
					Field: {
						path: TAGS_FIELD_COMPONENT,
						clientProps: { tagsSlug: "tags" },
					},
					Cell: {
						path: TAGS_CELL_COMPONENT,
						clientProps: { tagsSlug: "tags" },
					},
				},
			},
		});
	});

	it("sets only the Cell when allowInlineCreate is false", () => {
		const config = run({ collections: ["posts"], allowInlineCreate: false });

		expect(findField(collection(config, "posts"), "tags")).toMatchObject({
			admin: {
				components: {
					Cell: {
						path: TAGS_CELL_COMPONENT,
						clientProps: { tagsSlug: "tags" },
					},
				},
			},
		});
		expect(findField(collection(config, "posts"), "tags")).not.toHaveProperty(
			"admin.components.Field",
		);
	});

	it("respects a custom fieldName and tagsSlug", () => {
		const config = run({
			collections: ["posts"],
			fieldName: "labels",
			tagsSlug: "labels",
		});

		expect(collection(config, "labels").slug).toBe("labels");
		expect(findField(collection(config, "posts"), "labels")).toMatchObject({
			relationTo: "labels",
			admin: { components: { Cell: { clientProps: { tagsSlug: "labels" } } } },
		});
	});

	it("applies overrides to the generated collection", () => {
		const config = run({
			collections: ["posts"],
			overrides: (generated) => ({
				...generated,
				admin: { ...generated.admin, group: "Content" },
			}),
		});

		expect(collection(config, "tags").admin?.group).toBe("Content");
	});

	it("throws for an unknown collection", () => {
		expect(() => run({ collections: ["missing"] })).toThrow(
			/\[payloadcms-tags\] Unknown collection "missing"/,
		);
	});

	it("throws when collections includes the tags slug itself", () => {
		expect(() => run({ collections: ["posts", "tags"] })).toThrow(
			/\[payloadcms-tags\] Cannot tag the tags collection itself/,
		);
	});

	it("throws when the tags slug already exists", () => {
		const tags: CollectionConfig = { slug: "tags", fields: [] };

		expect(() => run({ collections: ["posts"] }, [posts, tags])).toThrow(
			/\[payloadcms-tags\] A collection with the slug "tags" already exists/,
		);
	});

	it("throws when a tagged collection already has the field", () => {
		const withTags: CollectionConfig = {
			slug: "posts",
			fields: [{ name: "tags", type: "text" }],
		};

		expect(() => run({ collections: ["posts"] }, [withTags])).toThrow(
			/\[payloadcms-tags\] Collection "posts" already has a field named "tags"/,
		);
	});

	it("identifies itself to Payload", () => {
		expect(tagsPlugin({ collections: [] }).slug).toBe("tags");
	});
});
