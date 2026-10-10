import { ValidationError } from "payload";

/** The prefix every message this package produces carries. */
const PREFIX = "[payloadcms-dummy]";

/** Throws a message the operator can act on, prefixed so its source is clear. */
export const fail = (message: string): never => {
	throw new Error(`${PREFIX} ${message}`);
};

/**
 * Turns a Payload error into something that names the offending fields.
 *
 * A bare `ValidationError` says a document is invalid but not which one, and a
 * seed writes dozens.
 *
 * @param error The thrown value.
 */
export const describeError = (error: unknown): string => {
	if (error instanceof ValidationError) {
		const fields = error.data.errors
			.map((it) => `${it.path}: ${it.message}`)
			.join("; ");

		return `validation failed, ${fields}`;
	}

	return error instanceof Error ? error.message : String(error);
};

/** The field paths a `ValidationError` complains about, for a better message. */
export const errorPaths = (error: unknown): readonly string[] =>
	error instanceof ValidationError
		? error.data.errors.map((it) => it.path)
		: [];

/**
 * An error that already names the document it belongs to.
 *
 * The writer wraps anything else, so this is how a message built further down
 * says it does not need wrapping again.
 */
export class DummyNamedError extends Error {
	public constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "DummyNamedError";
	}
}

/**
 * Re-throws naming the document that failed, keeping the original as `cause`.
 *
 * @param subject How the document reads in a message, such as `pages "/about"`.
 * @param error The thrown value.
 * @param hint Appended when the cause is worth explaining, such as a pruned ref.
 */
export const decorate = (
	subject: string,
	error: unknown,
	hint?: string,
): never => {
	const detail = hint ?? describeError(error);

	throw new DummyNamedError(`${subject}: ${detail}`, { cause: error });
};
