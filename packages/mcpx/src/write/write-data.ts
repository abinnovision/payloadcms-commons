import { isPlainObject } from "../guards.js";
import {
	blockRows,
	classifyKey,
	descriptorsUnder,
	ROW_KEYS,
} from "../schema/index.js";

import type { FlattenedField, JsonObject, SanitizedConfig } from "payload";

/*
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
	const relative = descriptorsUnder(fields, prefix);

	const result: Record<string, unknown> = {};

	if (isRow) {
		for (const key of ROW_KEYS) {
			if (Object.hasOwn(value, key)) {
				result[key] = value[key];
			}
		}
	}

	const pick = (
		row: unknown,
		next: { fields: FlattenedField[]; prefix: readonly string[] },
		isNextRow: boolean,
	): unknown =>
		isPlainObject(row)
			? pickDescribed(config, row, { ...next, isRow: isNextRow })
			: row;

	for (const [key, entry] of Object.entries(value)) {
		const found = classifyKey(relative, prefix, key);

		if (found.kind === "none") {
			continue;
		}

		if (found.kind === "leaf") {
			const blocks =
				found.descriptor.type === "blocks" && Array.isArray(entry)
					? blockRows(config, fields, found.descriptor, entry)
					: undefined;

			result[key] = blocks
				? blocks.entries.map(({ block, row }) =>
						block
							? pick(row, { fields: block.flattenedFields, prefix: [] }, true)
							: row,
					)
				: entry;
		} else if (found.kind === "rows") {
			result[key] = Array.isArray(entry)
				? entry.map((row) => pick(row, { fields, prefix: found.prefix }, true))
				: entry;
		} else {
			result[key] = pick(entry, { fields, prefix: found.prefix }, false);
		}
	}

	return result;
};

/**
 * The patched document reduced to writable fields, plus row identity keys.
 * `target` is a sanitized collection or global alike.
 */
export const buildWriteData = (
	config: SanitizedConfig,
	target: { flattenedFields: FlattenedField[] },
	doc: JsonObject,
): JsonObject => {
	return pickDescribed(config, doc, {
		fields: target.flattenedFields,
		prefix: [],
		isRow: false,
	});
};
