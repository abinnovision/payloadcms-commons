export const isPlainObject = (
	value: unknown,
): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * A property of a plain object, `undefined` for any other value.
 */
export const propOf = (value: unknown, key: string): unknown =>
	isPlainObject(value) ? value[key] : undefined;

/**
 * An own property only, so a client-chosen key never reads the prototype.
 */
export const ownValue = <T>(
	record: Readonly<Record<string, T>> | undefined,
	key: string,
): T | undefined =>
	record !== undefined && Object.hasOwn(record, key) ? record[key] : undefined;

/**
 * The entries whose value is not `undefined`, for spreading optional arguments
 * into a call.
 */
export const definedProps = <T extends object>(
	props: T,
): { [K in keyof T]?: Exclude<T[K], undefined> } =>
	Object.fromEntries(
		Object.entries(props).filter(([, value]) => value !== undefined),
	) as { [K in keyof T]?: Exclude<T[K], undefined> };
