"use client";

import { useAllFormFields } from "@payloadcms/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { adminMessage, isPreviewMessage } from "../protocol.js";
import { resolveAddressForPath, resolveAddressPath } from "../resolve-path.js";
import { revealPath } from "./reveal.js";
import { RowButton } from "./row-button.js";
import {
	blockPaths,
	findRows,
	rowHeader,
	rowPathAt,
	sameRows,
} from "./rows.js";

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
 * A `select` from the preview reveals the matching form row. In the other
 * direction, hovering anywhere in a block row outlines that block in the
 * preview without moving it, and the locate button in the row's header
 * scrolls the preview to it.
 *
 * Only the button scrolls. Driving the scroll from focus or from an ordinary
 * click, as an earlier version did, moved the preview while an editor was
 * merely placing a caret.
 */
export const ViewfinderFormBridge = (): ReactNode => {
	const [fields] = useAllFormFields();
	const [rows, setRows] = useState<ReadonlyMap<string, HTMLElement>>(new Map());

	/*
	 * Form state changes on every keystroke. Held in a ref so the listeners
	 * below are attached once and still read current state, rather than being
	 * torn down and re-attached as the editor types.
	 */
	const formState = useRef<FormStateLike>(fields);
	formState.current = fields;

	/*
	 * The same rows indexed by element, which is the direction the hover
	 * listener needs: it starts from whatever the pointer landed on.
	 */
	const rowPaths = useRef<ReadonlyMap<HTMLElement, string>>(new Map());
	rowPaths.current = useMemo(
		() => new Map([...rows].map(([path, row]) => [row, path])),
		[rows],
	);

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
				? findRows(document, formState.current)
				: new Map<string, HTMLElement>();

			setRows((previous) => (sameRows(previous, next) ? previous : next));
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

	/*
	 * Hover is the cheap half of the lookup: it outlines the block in place,
	 * so an editor can sweep the form and see what each row is without
	 * anything moving under them.
	 *
	 * One listener on the document rather than one per row. Payload sets
	 * `pointer-events: none` across a row's header so its collapse toggle
	 * catches every click, which means listeners bound to the rows themselves
	 * fire unevenly depending on what the pointer happens to be over.
	 */
	useEffect(() => {
		let hovered: string | undefined;

		const highlight = (path: string | undefined): void => {
			if (path === hovered) {
				return;
			}

			hovered = path;
			const address =
				path === undefined
					? undefined
					: resolveAddressForPath(formState.current, path);

			post(address ? adminMessage.highlight(address) : adminMessage.clear());
		};

		const onPointerOver = (event: PointerEvent): void => {
			highlight(
				rowPathAt(rowPaths.current, event.target as HTMLElement | null),
			);
		};

		/* The pointer entering the preview frame is a leave as far as this document knows. */
		const onPointerLeave = (): void => {
			highlight(undefined);
		};

		document.addEventListener("pointerover", onPointerOver, { passive: true });
		document.addEventListener("pointerleave", onPointerLeave, {
			passive: true,
		});

		return () => {
			document.removeEventListener("pointerover", onPointerOver);
			document.removeEventListener("pointerleave", onPointerLeave);
		};
	}, []);

	return (
		<>
			{[...rows].map(([path, row]) => {
				const header = rowHeader(row);

				return header === null
					? null
					: createPortal(
							<RowButton
								label="Scroll the preview to this block"
								onSelect={() => {
									const address = resolveAddressForPath(
										formState.current,
										path,
									);
									if (address) {
										post(adminMessage.scrollTo(address));
									}
								}}
							/>,
							header,
							path,
						);
			})}
		</>
	);
};
