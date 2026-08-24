/**
 * A send that Lettermint refused, or that never reached it. Carries the parsed
 * response so callers can branch on the status or the per-field errors instead
 * of matching on the message.
 */
class LettermintEmailError extends Error {
	public override readonly name = "LettermintEmailError";
	/** HTTP status, absent when the request never produced a response. */
	public readonly statusCode: number | undefined;
	/** Parsed response body, or the raw text when it was not JSON. */
	public readonly body: unknown;
	/** Per-field messages from a 422, keyed by the field Lettermint rejected. */
	public readonly errors: Record<string, string[]> | undefined;

	public constructor(
		message: string,
		options: {
			statusCode?: number;
			body?: unknown;
			errors?: Record<string, string[]>;
			cause?: unknown;
		} = {},
	) {
		super(message, { cause: options.cause });
		this.statusCode = options.statusCode;
		this.body = options.body;
		this.errors = options.errors;
	}
}

export { LettermintEmailError };
