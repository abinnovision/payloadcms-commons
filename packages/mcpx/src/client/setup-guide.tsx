"use client";

import {
	CopyToClipboard,
	useConfig,
	useDocumentInfo,
	useFormFields,
} from "@payloadcms/ui";
import React, { useEffect, useState } from "react";

/*
 * Deep import on purpose: the `api-keys` barrel pulls server-only Payload
 * code into this client entry.
 */
import { buildSetupGuide } from "../api-keys/setup-guide.js";

interface McpxSetupGuideProps {
	/** Endpoint path below the API route, from the plugin options. */
	endpointPath: string;
}

const asString = (value: unknown): string | undefined =>
	typeof value === "string" ? value : undefined;

/**
 * Reads `serverURL` when the config sets one and falls back to the browser's
 * origin. The fallback has to wait for mount: this component is server-rendered
 * first, where `window` does not exist.
 */
const useOrigin = (serverUrl: string): string => {
	const [origin, setOrigin] = useState(serverUrl);

	useEffect(() => {
		if (serverUrl === "") {
			setOrigin(window.location.origin);
		}
	}, [serverUrl]);

	return origin;
};

/**
 * Payload's own theme variables, so the panel follows the admin's light and
 * dark themes without shipping a stylesheet consumers would have to transpile.
 */
const styles = {
	lead: { marginBottom: "calc(var(--base) * 0.75)" },
	section: { marginBottom: "calc(var(--base) * 0.75)" },
	sectionHeader: {
		display: "flex",
		alignItems: "center",
		gap: "calc(var(--base) * 0.25)",
	},
	description: {
		margin: "calc(var(--base) * 0.15) 0",
		color: "var(--theme-elevation-500)",
	},
	snippet: {
		margin: 0,
		padding: "calc(var(--base) * 0.4)",
		background: "var(--theme-elevation-50)",
		border: "1px solid var(--theme-elevation-150)",
		borderRadius: "3px",
		fontFamily: "var(--font-mono)",
		overflowX: "auto",
		whiteSpace: "pre-wrap",
		wordBreak: "break-all",
	},
} as const satisfies Record<string, React.CSSProperties>;

/**
 * Per-key connection instructions on the API key edit view. Renders nothing
 * until the document is saved, because before that there is no key to hand to
 * a client.
 */
export const McpxSetupGuide: React.FC<McpxSetupGuideProps> = ({
	endpointPath,
}) => {
	const { id } = useDocumentInfo();
	const { config } = useConfig();
	const apiKey = useFormFields(([fields]) => fields["apiKey"]?.value);
	const label = useFormFields(([fields]) => fields["label"]?.value);
	const origin = useOrigin(config.serverURL);

	if (id === undefined) {
		return null;
	}

	const sections = buildSetupGuide({
		endpointUrl: `${origin.replace(/\/+$/, "")}${config.routes.api}${endpointPath}`,
		apiKey: asString(apiKey),
		label: asString(label),
	});

	return (
		<div className="field-type">
			{/* No heading: the tab this renders in is already labelled. */}
			<p style={styles.lead}>
				Every snippet below contains this key in full. Treat it like a password.
			</p>
			{sections.map((section) => (
				<section key={section.id} style={styles.section}>
					<div style={styles.sectionHeader}>
						<strong>{section.title}</strong>
						<CopyToClipboard value={section.snippet} />
					</div>
					{section.description ? (
						<p style={styles.description}>{section.description}</p>
					) : null}
					<pre style={styles.snippet}>{section.snippet}</pre>
				</section>
			))}
		</div>
	);
};
