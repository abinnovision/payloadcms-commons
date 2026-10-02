/** The JSON a tool result carries as its first text content. */
export const parseResult = (result: {
	content: { type: string; text?: string }[];
}): Record<string, unknown> =>
	JSON.parse(result.content[0]?.text ?? "null") as Record<string, unknown>;
