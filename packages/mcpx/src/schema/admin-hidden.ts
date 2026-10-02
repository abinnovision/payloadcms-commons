import {
	blockOf,
	blockSlugsOf,
	isAdminHidden,
	RESERVED_FIELD_NAMES,
	ROW_KEYS,
	schemaOf,
} from "./walk.js";
import { isPlainObject } from "../guards.js";

import type { EntityRef } from "../entity.js";
import type {
	FlattenedField,
	SanitizedCollectionConfig,
	SanitizedConfig,
} from "payload";

type Doc = Record<string, unknown>;

/*
 * Payload marks the fields it adds to an upload collection `admin.hidden` and
 * nothing on the sanitized config tells them from a declared field, so they
 * are listed by name. `sizes` stands for its image size groups too. Clients
 * need these to use a file.
 */
const UPLOAD_BASE_FIELDS: ReadonlySet<string> = new Set([
	"filename",
	"filesize",
	"focalX",
	"focalY",
	"height",
	"mimeType",
	"sizes",
	"thumbnailURL",
	"url",
	"width",
]);

const NONE: ReadonlySet<string> = new Set();

// Payload hides the `id` of every array and block row, and these are not the user's fields.
const isPayloadKey = (name: string): boolean =>
	RESERVED_FIELD_NAMES.has(name) || ROW_KEYS.has(name);

const collectionOf = (
	config: SanitizedConfig,
	slug: string,
): SanitizedCollectionConfig | undefined =>
	config.collections.find((collection) => collection.slug === slug);

// The names at the top of a collection that stay visible whatever `admin.hidden` says.
const exemptOf = (
	collection: SanitizedCollectionConfig | undefined,
): ReadonlySet<string> => (collection?.upload ? UPLOAD_BASE_FIELDS : NONE);

const mapEach = (value: unknown, one: (item: unknown) => unknown): unknown =>
	Array.isArray(value) ? value.map(one) : one(value);

const stripFields = (
	config: SanitizedConfig,
	fields: FlattenedField[],
	doc: Doc,
	exempt: ReadonlySet<string> = NONE,
): Doc => {
	const result = { ...doc };

	for (const field of fields) {
		if (
			!("name" in field) ||
			exempt.has(field.name) ||
			isPayloadKey(field.name) ||
			!Object.hasOwn(result, field.name)
		) {
			continue;
		}

		if (isAdminHidden(field)) {
			Reflect.deleteProperty(result, field.name);
		} else {
			result[field.name] = stripValue(config, field, result[field.name]);
		}
	}

	return result;
};

// A related document is an object once populated and an id otherwise.
const stripRelated = (
	config: SanitizedConfig,
	relationTo: string | string[],
	value: unknown,
): unknown => {
	if (!isPlainObject(value)) {
		return value;
	}

	if (Array.isArray(relationTo)) {
		const slug = value["relationTo"];

		return typeof slug === "string" && isPlainObject(value["value"])
			? { ...value, value: stripRelated(config, slug, value["value"]) }
			: value;
	}

	const collection = collectionOf(config, relationTo);

	return collection
		? stripFields(
				config,
				collection.flattenedFields,
				value,
				exemptOf(collection),
			)
		: value;
};

const stripValue = (
	config: SanitizedConfig,
	field: FlattenedField,
	value: unknown,
): unknown => {
	switch (field.type) {
		case "group":
		case "tab":
			return isPlainObject(value)
				? stripFields(config, field.flattenedFields, value)
				: value;
		case "array":
			return mapEach(value, (row) =>
				isPlainObject(row)
					? stripFields(config, field.flattenedFields, row)
					: row,
			);
		case "blocks":
			return mapEach(value, (row) => {
				const block =
					isPlainObject(row) && typeof row["blockType"] === "string"
						? blockOf(config, field, row["blockType"])
						: undefined;

				return block && isPlainObject(row)
					? stripFields(config, block.flattenedFields, row)
					: row;
			});
		case "relationship":
		case "upload":
			return mapEach(value, (item) =>
				stripRelated(config, field.relationTo, item),
			);
		case "join":
			return isPlainObject(value) && Array.isArray(value["docs"])
				? {
						...value,
						docs: value["docs"].map((item) =>
							stripRelated(config, field.collection, item),
						),
					}
				: value;
		default:
			return value;
	}
};

/**
 * The document without its `admin.hidden` fields, at every depth, including
 * populated documents, which are read against their own collection. Payload's
 * upload fields stay. Rich text is not walked.
 */
export const stripAdminHidden = (
	config: SanitizedConfig,
	ref: EntityRef,
	doc: Doc,
): Doc =>
	stripFields(
		config,
		schemaOf(config, ref).flattenedFields,
		doc,
		ref.kind === "collection" ? exemptOf(collectionOf(config, ref.slug)) : NONE,
	);

/**
 * Whether a query path inside one collection names an `admin.hidden` field or
 * a field under one. The path is dotted, with a locale segment allowed after a
 * localized field. Hops into other collections are the caller's to follow.
 */
export const addressesAdminHidden = (
	config: SanitizedConfig,
	collectionSlug: string,
	path: string,
): boolean => {
	const collection = collectionOf(config, collectionSlug);

	if (!collection) {
		return false;
	}

	const locales: readonly string[] = config.localization
		? config.localization.localeCodes
		: [];

	const walk = (fields: FlattenedField[], segments: string[]): boolean => {
		const [segment, ...rest] = segments;

		if (segment === undefined || isPayloadKey(segment)) {
			return false;
		}

		const matches = fields.filter(
			(field) => "name" in field && field.name === segment,
		);

		if (matches.length === 0) {
			return locales.includes(segment) ? walk(fields, rest) : false;
		}

		return matches.some((field) => {
			if (isAdminHidden(field)) {
				return true;
			}

			if (
				field.type === "group" ||
				field.type === "tab" ||
				field.type === "array"
			) {
				return walk(field.flattenedFields, rest);
			}

			return (
				field.type === "blocks" &&
				blockSlugsOf(field).some((slug) => {
					const block = blockOf(config, field, slug);

					return block !== undefined && walk(block.flattenedFields, rest);
				})
			);
		});
	};

	const segments = path.split(".");

	return (
		!exemptOf(collection).has(segments[0] ?? "") &&
		walk(collection.flattenedFields, segments)
	);
};
