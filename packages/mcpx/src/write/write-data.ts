import {
	ARRAY_MARKER,
	blockOf,
	describeAddressableFields,
	findBlocksField,
	isPlainObject,
	splitPath,
} from "../schema/index.js";

import type { FlattenedField, JsonObject, SanitizedConfig } from "payload";

const ROW_KEYS = new Set(["blockName", "blockType", "id"]);

/**
 * Everything Payload maintains or derives (`_status`, timestamps, join and
 * virtual fields, upload base fields) is left out, so the write-back carries
 * only what a client could have set.
 */
const pickDescribed = (
	config: SanitizedConfig,
	value: Record<string, unknown>,
	at: { fields: FlattenedField[]; prefix: readonly string[]; isRow: boolean },
): Record<string, unknown> => {
	const { fields, prefix, isRow } = at;
	const relative = describeAddressableFields(fields).flatMap((descriptor) => {
		const parts = splitPath(descriptor.path);

		return prefix.every((part, offset) => part === parts[offset])
			? [{ descriptor, parts: parts.slice(prefix.length) }]
			: [];
	});

	const result: Record<string, unknown> = {};

	if (isRow) {
		for (const key of ROW_KEYS) {
			if (key in value) {
				result[key] = value[key];
			}
		}
	}

	for (const [key, entry] of Object.entries(value)) {
		const candidates = relative.filter(({ parts }) => parts[0] === key);

		if (candidates.length === 0) {
			continue;
		}

		const exact = candidates.find(({ parts }) => parts.length === 1);

		if (exact?.descriptor.type === "blocks" && Array.isArray(entry)) {
			const field = findBlocksField(fields, splitPath(exact.descriptor.path));

			result[key] = (entry as unknown[]).map((row) => {
				const block =
					field && isPlainObject(row) && typeof row["blockType"] === "string"
						? blockOf(config, field, row["blockType"])
						: undefined;

				return block && isPlainObject(row)
					? pickDescribed(config, row, {
							fields: block.flattenedFields,
							prefix: [],
							isRow: true,
						})
					: row;
			});

			continue;
		}

		if (exact) {
			result[key] = entry;

			continue;
		}

		if (candidates.some(({ parts }) => parts[1] === ARRAY_MARKER)) {
			result[key] = Array.isArray(entry)
				? (entry as unknown[]).map((row) =>
						isPlainObject(row)
							? pickDescribed(config, row, {
									fields,
									prefix: [...prefix, key, ARRAY_MARKER],
									isRow: true,
								})
							: row,
					)
				: entry;

			continue;
		}

		result[key] = isPlainObject(entry)
			? pickDescribed(config, entry, {
					fields,
					prefix: [...prefix, key],
					isRow: false,
				})
			: entry;
	}

	return result;
};

/** The patched document reduced to writable fields, plus row identity keys. */
export const buildWriteData = (
	config: SanitizedConfig,
	/*
	 * Widened to the structural minimum this reads, so a sanitized collection
	 * and a sanitized global both satisfy it without a union.
	 */
	target: { flattenedFields: FlattenedField[] },
	doc: JsonObject,
): JsonObject => {
	return pickDescribed(config, doc, {
		fields: target.flattenedFields,
		prefix: [],
		isRow: false,
	});
};
