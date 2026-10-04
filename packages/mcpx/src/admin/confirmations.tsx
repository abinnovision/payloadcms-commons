"use client";

import { toast, useConfig, useDocumentInfo } from "@payloadcms/ui";
import React, { useCallback, useEffect, useState } from "react";

import {
	ConfirmationsPanel,
	confirmationRowId,
} from "./confirmations-panel.js";
import { CONFIRMATIONS_PATH } from "../api-keys/confirmation-view.js";

import type {
	ConfirmationDecision,
	ConfirmationView,
} from "../api-keys/confirmation-view.js";

interface McpxConfirmationsProps {
	/**
	 * Endpoint path below the API route, from the plugin options.
	 */
	endpointPath: string;
}

/**
 * The calls waiting for approval on the API key edit view. Reads and decides
 * through the plugin's endpoints, never through the key's form, so a decision
 * does not mark the key modified. Renders nothing while none is waiting.
 */
export const McpxConfirmations: React.FC<McpxConfirmationsProps> = ({
	endpointPath,
}) => {
	const { id } = useDocumentInfo();
	const { config } = useConfig();
	const [confirmations, setConfirmations] = useState<ConfirmationView[]>([]);
	const [busy, setBusy] = useState(false);
	// Bumped after a decision, which lists the calls again.
	const [version, setVersion] = useState(0);
	const url = `${config.serverURL}${config.routes.api}${endpointPath}${CONFIRMATIONS_PATH}`;

	useEffect(() => {
		if (id === undefined) {
			return undefined;
		}

		let active = true;
		const params = new URLSearchParams({ key: String(id) });
		const highlight = new URLSearchParams(window.location.search).get(
			"confirmation",
		);

		if (highlight !== null) {
			params.set("confirmation", highlight);
		}

		void fetch(`${url}?${params.toString()}`, { credentials: "include" })
			.then(async (response) =>
				response.ok
					? ((await response.json()) as { confirmations: ConfirmationView[] })
					: { confirmations: [] },
			)
			.then((body) => {
				if (active) {
					setConfirmations(body.confirmations);
				}
			})
			.catch(() => undefined);

		return () => {
			active = false;
		};
	}, [id, url, version]);

	const highlighted = confirmations.find((entry) => entry.highlighted)?.handle;

	useEffect(() => {
		if (highlighted !== undefined) {
			document
				.getElementById(confirmationRowId(highlighted))
				?.scrollIntoView({ block: "center" });
		}
	}, [highlighted]);

	const decide = useCallback(
		(handles: string[], decision: ConfirmationDecision) => {
			setBusy(true);

			void fetch(url, {
				method: "POST",
				credentials: "include",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ key: id, handles, decision }),
			})
				.then(async (response) => {
					if (!response.ok) {
						const body = (await response.json().catch(() => ({}))) as {
							error?: string;
						};

						toast.error(body.error ?? "The decision could not be saved.");
					}
				})
				.catch(() => {
					toast.error("The decision could not be saved.");
				})
				.finally(() => {
					setBusy(false);
					setVersion((current) => current + 1);
				});
		},
		[id, url],
	);

	return (
		<ConfirmationsPanel
			busy={busy}
			confirmations={confirmations}
			onDecide={decide}
		/>
	);
};
