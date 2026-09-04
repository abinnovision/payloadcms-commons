"use client";

import { useAllFormFields } from "@payloadcms/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { adminMessage, isPreviewMessage } from "../protocol.js";
import { resolveAddressForPath, resolveAddressPath } from "../resolve-path.js";
import { revealPath } from "./reveal.js";
import { RowButton } from "./row-button.js";
import { blockPaths, findRowHeaders, sameHeaders } from "./row-headers.js";

import type { AdminMessage } from "../protocol.js";
import type { FormStateLike } from "../resolve-path.js";
import type { ReactNode } from "react";

/** Payload renders exactly one live-preview iframe, with this id. */
const PREVIEW_IFRAME_ID = "live-preview-iframe";

/** Long enough to coalesce a burst of admin re-renders, short enough to feel instant. */
const RESCAN_MS = 50;

const previewIframe = (): HTMLIFrameElement | null =>
	document.getElementById(PREVIEW_IFRAME_ID) as HTMLIFrameElement | null;

/**
 * Posts into the preview frame, addressed to the origin that frame is
 * actually on. Resolves the iframe per call rather than holding a reference:
 * the admin mounts and unmounts it as the editor toggles live preview.
 */
const post = (message: AdminMessage): void => {
	const iframe = previewIframe();
	const target = iframe?.contentWindow;
	if (!iframe || !target) {
		return;
	}

	target.postMessage(message, new URL(iframe.src, location.href).origin);
};

/**
 * Connects the admin form to the page it is previewing. Mounted inside the
 * document form by `viewfinderPlugin`, and inert until a framed page
 * announces itself.
 *
 * Both directions are explicit. A `select` from the preview reveals the
 * matching form row; a locate button in each row header sends the preview to
 * that block. Nothing is driven by incidental clicks or focus changes, which
 * is what kept the preview scrolling while an editor was only placing a caret.
 */
export const ViewfinderFormBridge = (): ReactNode => {
	const [fields] = useAllFormFields();
	const [headers, setHeaders] = useState<ReadonlyMap<string, HTMLElement>>(
		new Map(),
	);

	/*
	 * Form state changes on every keystroke. Held in a ref so the listeners
	 * below are attached once and still read current state, rather than being
	 * torn down and re-attached as the editor types.
	 */
	const formState = useRef<FormStateLike>(fields);
	formState.current = fields;

	/* Rescanning on every keystroke is wasted work; only the set of blocks matters. */
	const pathsKey = useMemo(() => blockPaths(fields).join("|"), [fields]);

	useEffect(() => {
		const onMessage = (event: MessageEvent): void => {
			/*
			 * Trust is established by window identity rather than an origin
			 * allowlist: the only window this bridge answers is the one Payload
			 * itself put in the preview frame.
			 */
			if (event.source !== previewIframe()?.contentWindow) {
				return;
			}

			if (!isPreviewMessage(event.data) || event.data.type !== "select") {
				return;
			}

			const path = resolveAddressPath(formState.current, event.data.address);
			if (path !== undefined) {
				void revealPath(document, path);
			}
		};

		window.addEventListener("message", onMessage);

		return () => {
			window.removeEventListener("message", onMessage);
		};
	}, []);

	useEffect(() => {
		let timer = 0;

		const rescan = (): void => {
			const next = previewIframe()
				? findRowHeaders(document, formState.current)
				: new Map<string, HTMLElement>();

			setHeaders((previous) => (sameHeaders(previous, next) ? previous : next));
		};

		rescan();

		/*
		 * Rows mount and unmount as the editor expands, collapses, adds and
		 * reorders blocks, and expanding a row changes no form state at all, so
		 * a render-driven rescan would miss it.
		 */
		const observer = new MutationObserver(() => {
			window.clearTimeout(timer);
			timer = window.setTimeout(rescan, RESCAN_MS);
		});
		observer.observe(document.body, { childList: true, subtree: true });

		return () => {
			observer.disconnect();
			window.clearTimeout(timer);
		};
	}, [pathsKey]);

	return (
		<>
			{[...headers].map(([path, header]) =>
				createPortal(
					<RowButton
						label="Show this block in the preview"
						onSelect={() => {
							const address = resolveAddressForPath(formState.current, path);
							if (address) {
								post(adminMessage.scrollTo(address));
							}
						}}
					/>,
					header,
					path,
				),
			)}
		</>
	);
};
