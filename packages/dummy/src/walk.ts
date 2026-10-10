/** Whether a value is a plain object, as opposed to a class instance or array. */
export const isPlainObject = (
	value: unknown,
): value is Record<string, unknown> => {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return false;
	}

	const proto: unknown = Object.getPrototypeOf(value);

	return proto === Object.prototype || proto === null;
};

/*
 * A rich text state's nodes manage their own ids and the whole value is
 * per-locale, so it is never descended into. Recognised the same way
 * payloadcms-mcpx recognises one, by a `root` whose `children` is an array.
 */
export const isRichTextState = (value: Record<string, unknown>): boolean => {
	const root = value["root"];

	return isPlainObject(root) && Array.isArray(root["children"]);
};

/** Thrown when a locale override's arrays do not line up with the default's. */
export class DummyRowMismatchError extends Error {
	public constructor(
		public readonly path: string,
		public readonly incoming: number,
		public readonly stored: number,
	) {
		super(
			`has ${String(incoming)} rows at "${path}" where the default locale ` +
				`has ${String(stored)}`,
		);
		this.name = "DummyRowMismatchError";
	}
}

/**
 * Copies stored row ids onto a locale override, by position.
 *
 * An array whose rows carry a localized field shares one row set across
 * locales. Without the ids Payload treats the next write as a new set of rows
 * and drops the other locales' values with them. The author supplies no ids, so
 * position is the only correspondence available, which makes equal length a
 * requirement rather than a best effort.
 *
 * `stored` must be read at the locale about to be written, not at the default
 * one. An array that is itself localized has a separate row set per locale with
 * its own ids, and grafting another locale's ids onto it would collide on the
 * primary key.
 *
 * Mutates `incoming` and answers it.
 *
 * @param incoming The locale override about to be written.
 * @param stored The document as read back at the locale being written.
 * @param path The field path reached so far, for the mismatch error.
 */
export const graftRowIds = <T>(incoming: T, stored: unknown, path = ""): T => {
	if (Array.isArray(incoming)) {
		if (!Array.isArray(stored)) {
			return incoming;
		}

		/*
		 * A hasMany relationship is an array of ids, not of rows. It carries no
		 * id to graft and its length is the caller's business, so it is left as
		 * written.
		 */
		if (!incoming.every((row) => isPlainObject(row))) {
			return incoming;
		}

		if (incoming.length !== stored.length) {
			throw new DummyRowMismatchError(path, incoming.length, stored.length);
		}

		incoming.forEach((row, index) => {
			graftRowIds(row, stored[index], `${path}.${String(index)}`);
		});

		return incoming;
	}

	if (!isPlainObject(incoming) || !isPlainObject(stored)) {
		return incoming;
	}

	if (isRichTextState(incoming) || isRichTextState(stored)) {
		return incoming;
	}

	/* Narrowed from a generic, so the compiler treats the index as read-only. */
	const row = incoming as Record<string, unknown>;

	/*
	 * A row id is a string on every adapter: Payload gives array and block rows
	 * their own text id rather than the numeric primary key a document gets.
	 */
	if (row["id"] === undefined && typeof stored["id"] === "string") {
		row["id"] = stored["id"];
	}

	for (const [key, value] of Object.entries(row)) {
		if (key === "id") {
			continue;
		}

		graftRowIds(value, stored[key], path === "" ? key : `${path}.${key}`);
	}

	return incoming;
};
