"use client";

import {
	Banner,
	Button,
	CopyToClipboard,
	Drawer,
	formatDrawerSlug,
	useConfig,
	useDocumentInfo,
	useEditDepth,
	useFormFields,
	useModal,
} from "@payloadcms/ui";
import React, { useEffect, useState } from "react";

import { endpointUrl } from "./endpoint-url.js";
import { buildSetupGuide } from "../api-keys/setup-guide.js";

interface McpxSetupGuideProps {
	/**
	 * Endpoint path below the API route, from the plugin options.
	 */
	endpointPath: string;
}

const asString = (value: unknown): string | undefined =>
	typeof value === "string" ? value : undefined;

/*
 * Uses `serverURL` when the config sets one, else the browser's origin. The
 * fallback waits for mount because the component renders on the server first,
 * where `window` does not exist.
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

/*
 * Payload's theme variables, so the panel follows the admin's light and dark
 * themes without a stylesheet that consumers would have to transpile.
 */
const styles = {
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

const SetupGuideContent: React.FC<McpxSetupGuideProps> = ({ endpointPath }) => {
	const { config } = useConfig();
	const apiKey = useFormFields(([fields]) => fields["apiKey"]?.value);
	const label = useFormFields(([fields]) => fields["label"]?.value);
	const origin = useOrigin(config.serverURL);

	const sections = buildSetupGuide({
		endpointUrl: endpointUrl(origin, config.routes.api, endpointPath),
		apiKey: asString(apiKey),
		label: asString(label),
	});

	return (
		<>
			<Banner type="warning">
				Every snippet below contains this key in full. Treat it like a password.
			</Banner>
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
		</>
	);
};

/**
 * Per-key connection instructions on the API key edit view, opened from a
 * button next to the document controls. Renders nothing until the document is
 * saved, because before that there is no key to hand to a client.
 */
export const McpxSetupGuide: React.FC<McpxSetupGuideProps> = ({
	endpointPath,
}) => {
	const { id } = useDocumentInfo();
	const { openModal } = useModal();
	const drawerSlug = formatDrawerSlug({
		slug: "mcpx-connect",
		depth: useEditDepth(),
	});

	if (id === undefined) {
		return null;
	}

	return (
		<>
			<Button
				buttonStyle="secondary"
				margin={false}
				onClick={() => {
					openModal(drawerSlug);
				}}
				size="medium"
				type="button"
			>
				Connect a client
			</Button>
			<Drawer slug={drawerSlug} title="Connect a client">
				<SetupGuideContent endpointPath={endpointPath} />
			</Drawer>
		</>
	);
};
