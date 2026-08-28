import type { Address } from "./nodemailer.js";

/**
 * Characters that force a display name to be quoted, per RFC 5322 §3.2.3.
 */
const SPECIALS = /[()<>[\]:;@\\,."]/;

/**
 * Renders a display name so it survives as one token, escaping the two
 * characters that stay special inside a quoted string.
 */
const quoteName = (name: string): string =>
	SPECIALS.test(name) ? `"${name.replace(/(["\\])/g, "\\$1")}"` : name;

/**
 * Splits a header value on the commas that separate addresses, ignoring the
 * ones inside a quoted display name or an angle-addr. Nodemailer accepts
 * `"Doe, John" <j@x.io>, a@y.io` as a single string, and Lettermint wants the
 * two addresses as separate array entries.
 */
export const splitAddressList = (value: string): string[] => {
	const parts: string[] = [];
	let current = "";
	let quoted = false;
	let escaped = false;
	let depth = 0;

	for (const char of value) {
		if (escaped) {
			current += char;
			escaped = false;
			continue;
		}

		if (char === "\\" && quoted) {
			current += char;
			escaped = true;
			continue;
		}

		if (char === '"') {
			quoted = !quoted;
		} else if (!quoted && char === "<") {
			depth += 1;
		} else if (!quoted && char === ">") {
			depth = Math.max(0, depth - 1);
		} else if (char === "," && !quoted && depth === 0) {
			parts.push(current);
			current = "";
			continue;
		}

		current += char;
	}

	parts.push(current);

	return parts.map((part) => part.trim()).filter((part) => part !== "");
};

/**
 * One address as RFC 5322 text. An object without a usable name degrades to the
 * bare address, which is what nodemailer does too.
 */
export const normalizeAddress = (value: Address | string): string => {
	if (typeof value === "string") {
		return value.trim();
	}

	const name = value.name?.trim();

	return name ? `${quoteName(name)} <${value.address}>` : value.address;
};

/**
 * Every address in a recipient field, flattened. Payload only ever passes a
 * single string, but `SendEmailOptions` is nodemailer's option bag, so any of
 * the four shapes can arrive from user code.
 */
export const normalizeAddressList = (
	value: Address | string | Array<Address | string> | undefined,
): string[] => {
	if (value === undefined) {
		return [];
	}

	const entries = Array.isArray(value) ? value : [value];

	return entries.flatMap((entry) =>
		typeof entry === "string"
			? splitAddressList(entry)
			: [normalizeAddress(entry)],
	);
};
