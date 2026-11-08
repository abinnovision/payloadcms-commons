import type { ThreadId } from "./api.js";

/** A query of Payload's REST API, written as its `where` object. */
export interface Where {
	[field: string]: Where | Where[] | (number | string)[] | number | string;
}

/** Where a page of threads ends: its last row's message time and id. */
export interface Keyset {
	lastMessageAt: string;
	id: ThreadId;
}

/** Newest message first; the id orders rows with the same time. */
export const KEYSET_SORT = "-lastMessageAt,-id";

/** The opaque cursor assistant-ui hands back for the next page. */
export const encodeCursor = (keyset: Keyset): string =>
	JSON.stringify([keyset.lastMessageAt, keyset.id]);

/** The keyset of a cursor from {@link encodeCursor}, or undefined. */
export const decodeCursor = (cursor: string): Keyset | undefined => {
	try {
		const value: unknown = JSON.parse(cursor);

		if (
			Array.isArray(value) &&
			typeof value[0] === "string" &&
			(typeof value[1] === "string" || typeof value[1] === "number")
		) {
			return { lastMessageAt: value[0], id: value[1] };
		}
	} catch {
		// Not a cursor of this list.
	}

	return undefined;
};

/** The keyset of the row a page ends with, when it has a message time. */
export const keysetOf = (row: {
	id: ThreadId;
	lastMessageAt?: null | string;
}): Keyset | undefined =>
	typeof row.lastMessageAt === "string"
		? { lastMessageAt: row.lastMessageAt, id: row.id }
		: undefined;

/**
 * The conditions that page a list sorted by {@link KEYSET_SORT}: rows without
 * a message time are left out, and after a keyset only the rows that sort
 * below it remain. Archiving or adding rows never shifts a later page.
 */
export const keysetWhere = (after?: Keyset): Where[] => {
	const exists: Where = { lastMessageAt: { exists: "true" } };

	if (after === undefined) {
		return [exists];
	}

	return [
		exists,
		{
			or: [
				{ lastMessageAt: { less_than: after.lastMessageAt } },
				{
					and: [
						{ lastMessageAt: { equals: after.lastMessageAt } },
						{ id: { less_than: after.id } },
					],
				},
			],
		},
	];
};

/*
 * Writes `where` in the bracket notation Payload parses. A list of values
 * becomes one comma-separated value, as `in` takes it; a list of conditions
 * is indexed.
 */
const append = (params: URLSearchParams, key: string, value: unknown): void => {
	if (Array.isArray(value)) {
		if (value.every((entry) => typeof entry !== "object")) {
			params.append(key, value.join(","));

			return;
		}

		value.forEach((entry, index) => {
			append(params, `${key}[${String(index)}]`, entry);
		});

		return;
	}

	if (typeof value === "object" && value !== null) {
		for (const [name, entry] of Object.entries(value)) {
			append(params, `${key}[${name}]`, entry);
		}

		return;
	}

	params.append(key, String(value));
};

/** `where` as query parameters, next to `params`. */
export const whereParams = (
	where: Where,
	params: Record<string, string> = {},
): URLSearchParams => {
	const search = new URLSearchParams(params);

	append(search, "where", where);

	return search;
};
