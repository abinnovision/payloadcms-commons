import { isPlainObject } from "../guards.js";
import {
	blockForRow,
	classifyKey,
	descriptorsUnder,
	findFieldAt,
	ROW_KEYS,
	splitPath,
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
		at: { fields: FlattenedField[]; prefix: readonly string[]; isRow: boolean },
	): unknown => (isPlainObject(row) ? pickDescribed(config, row, at) : row);

	for (const [key, entry] of Object.entries(value)) {
		const found = classifyKey(relative, prefix, key);

		if (found.kind === "none") {
			continue;
		}

		if (found.kind === "leaf") {
			const field =
				found.descriptor.type === "blocks"
					? findFieldAt(fields, splitPath(found.descriptor.path), "blocks")
					: undefined;

			result[key] =
				field && Array.isArray(entry)
					? entry.map((row: unknown) => {
							const block = blockForRow(config, field, row);

							return block
								? pick(row, {
										fields: block.flattenedFields,
										prefix: [],
										isRow: true,
									})
								: row;
						})
					: entry;
		} else if (found.kind === "rows") {
			result[key] = Array.isArray(entry)
				? entry.map((row) =>
						pick(row, { fields, prefix: found.prefix, isRow: true }),
					)
				: entry;
		} else {
			result[key] = pick(entry, { fields, prefix: found.prefix, isRow: false });
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
