import { resolversFor } from "../pattern/resolver.js";

import type { PayloadCollectionMappingResolved } from "../pattern/types.js";
import type { Payload, SanitizedCollectionConfig } from "payload";

export interface ResolveRelationshipSlugArgs {
	payload: Payload;
	/** The collection the pattern parameter belongs to. */
	config: SanitizedCollectionConfig;
	/** The pattern parameter naming the relationship. */
	param: string;
	/** The raw value held by the document being edited. */
	value: unknown;
	mappings?: PayloadCollectionMappingResolved[];
	locale?: string;
	identifierField?: string;
}

const identifierFor = (
	target: string,
	args: ResolveRelationshipSlugArgs,
): string => {
	const fallback = args.identifierField ?? "slug";

	if (!args.mappings || args.locale === undefined) {
		return fallback;
	}

	const mapping = args.mappings.find((it) => it.collection === target);
	const resolvers = mapping ? resolversFor(mapping, args.locale) : undefined;

	if (!resolvers || resolvers.specificity.hasWildcard) {
		return fallback;
	}

	return resolvers.paramNames.at(-1) ?? fallback;
};

/**
 * Reads the identifier value behind a relationship parameter.
 *
 * The inverse of `resolveParamQueryPath`: that turns a parameter into the
 * field a path lookup queries, this turns the same parameter into the value
 * that field holds. The admin panel is where the two have to meet — a preview
 * URL is built from form state, where a relationship is still a bare id and
 * there is no populated document to read a slug off, so a URL built without
 * this would never match back.
 *
 * Returns null when the value names nothing resolvable, which callers should
 * treat as "no preview URL" rather than guessing.
 *
 * @param args The Payload instance, the parameter and its raw value.
 */
export const resolveRelationshipSlug = async (
	args: ResolveRelationshipSlugArgs,
): Promise<string | null> => {
	const field = args.config.flattenedFields.find(
		(it) => it.name === args.param,
	);

	if (field?.type !== "relationship") {
		return typeof args.value === "string" ? args.value : null;
	}

	const targets = Array.isArray(field.relationTo)
		? field.relationTo
		: [field.relationTo];

	// Already populated: read the identifier straight off the document.
	if (args.value && typeof args.value === "object") {
		const identifier = identifierFor(targets[0]!, args);
		const held = (args.value as Record<string, unknown>)[identifier];

		return typeof held === "string" ? held : null;
	}

	if (typeof args.value !== "string") {
		return null;
	}

	for (const target of targets) {
		const identifier = identifierFor(target, args);

		try {
			const related = await args.payload.findByID({
				collection: target,
				id: args.value,
				depth: 0,
				select: { [identifier]: true },
				overrideAccess: true,
			});

			const held = (related as Record<string, unknown>)[identifier];

			if (typeof held === "string") {
				return held;
			}
		} catch {
			// Not a document of this collection; try the next target.
		}
	}

	return null;
};
