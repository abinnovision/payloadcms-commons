/**
 * Stands in for the key in the snippets whenever the real one is unavailable,
 * so the instructions still render and say what is missing.
 */
export const KEY_PLACEHOLDER = "<your-key>";

/** What the guide needs to know about one key to write its snippets. */
export interface SetupGuideInput {
	/** Absolute MCP endpoint URL. */
	endpointUrl: string;
	/** Plaintext key, absent on an unsaved document or a failed decrypt. */
	apiKey?: null | string | undefined;
	/** Client name suggestion, taken from the key label. */
	label?: null | string | undefined;
}

/** One instruction block, rendered behind its own copy button. */
export interface SetupGuideSection {
	/** Stable key for rendering and for tests. */
	id: string;
	title: string;
	description?: string;
	/** The block to copy verbatim. */
	snippet: string;
}

/**
 * Server name for the client config. MCP clients key their config by this, so
 * it has to survive labels with spaces or punctuation.
 */
export const toServerName = (label?: null | string): string => {
	const slug = (label ?? "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");

	return slug === "" ? "payload" : slug;
};

/**
 * A pure builder, so the admin component holds only rendering and the snippets
 * stay unit-testable.
 */
export const buildSetupGuide = (
	input: SetupGuideInput,
): SetupGuideSection[] => {
	const key = typeof input.apiKey === "string" ? input.apiKey : KEY_PLACEHOLDER;
	const name = toServerName(input.label);
	const url = input.endpointUrl;

	return [
		{
			id: "endpoint",
			title: "Endpoint",
			description: "Streamable HTTP. Point any MCP client at this URL.",
			snippet: url,
		},
		{
			id: "header",
			title: "Authorization header",
			description:
				"The only accepted credential; cookies and JWTs are ignored.",
			snippet: `Authorization: Bearer ${key}`,
		},
		{
			id: "claude-code",
			title: "Claude Code",
			snippet: [
				`claude mcp add --transport http ${name} ${url} \\`,
				`  --header "Authorization: Bearer ${key}"`,
			].join("\n"),
		},
		{
			id: "claude-desktop",
			title: "Claude Desktop",
			description:
				"Has no direct header support, so it goes through mcp-remote.",
			snippet: JSON.stringify(
				{
					mcpServers: {
						[name]: {
							command: "npx",
							args: [
								"-y",
								"mcp-remote",
								url,
								"--header",
								`Authorization: Bearer ${key}`,
							],
						},
					},
				},
				null,
				2,
			),
		},
	];
};
