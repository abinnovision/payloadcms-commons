export const isPlainObject = (
	value: unknown,
): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * An own property only, so a client-chosen key never reads the prototype.
 */
export const ownValue = <T>(
	record: Readonly<Record<string, T>> | undefined,
	key: string,
): T | undefined =>
	record !== undefined && Object.hasOwn(record, key) ? record[key] : undefined;
