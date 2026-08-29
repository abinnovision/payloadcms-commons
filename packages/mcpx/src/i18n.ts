import type { PayloadRequest } from "payload";

/**
 * Payload has already folded `config.i18n.fallbackLanguage` into the request,
 * so no config lookup is needed.
 */
export type RequestLanguage = Pick<
	PayloadRequest["i18n"],
	"fallbackLanguage" | "language"
>;

export type Translate = (value: unknown) => string | undefined;

const stringRecord = (value: unknown): Record<string, string> | undefined =>
	typeof value === "object" &&
	value !== null &&
	!Array.isArray(value) &&
	Object.values(value).every((entry) => typeof entry === "string")
		? (value as Record<string, string>)
		: undefined;

/** Treats an empty value as absent, so the fallback chain continues. */
const pick = (
	record: Record<string, string>,
	language: string | string[],
): string | undefined => {
	for (const code of Array.isArray(language) ? language : [language]) {
		const entry = record[code];

		if (entry !== undefined && entry.trim() !== "") {
			return entry;
		}
	}

	return undefined;
};

/**
 * Resolves a static label or `admin.description` to the one string a client
 * can use: the request's language, then the fallback language configured for
 * the deployment, then whichever entry the record declares first.
 *
 * Anything that is not a string or a string-valued record is dropped. A
 * description written as a function or a React component is an admin-UI
 * construct that may reach client-only i18n, so it is never invoked here.
 */
export const translateStatic = (
	value: unknown,
	language: RequestLanguage,
): string | undefined => {
	if (typeof value === "string") {
		return value.trim() === "" ? undefined : value;
	}

	const record = stringRecord(value);

	if (!record) {
		return undefined;
	}

	return (
		pick(record, language.language) ??
		pick(record, language.fallbackLanguage) ??
		Object.values(record).find((entry) => entry.trim() !== "")
	);
};

/** Bound to one request's language, so a walk carries no request of its own. */
export const translatorFor =
	(i18n: RequestLanguage): Translate =>
	(value) =>
		translateStatic(value, i18n);

/** For callers with no request: both keys miss, so the first entry wins. */
export const translateAny: Translate = translatorFor({
	fallbackLanguage: "",
	language: "",
});
