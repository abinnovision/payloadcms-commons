"use client";

import { useAllFormFields } from "@payloadcms/ui";
import { useEffect, useRef } from "react";

import { adminMessage, isPreviewMessage } from "../protocol.js";
import { resolveAddressPath } from "../resolve-path.js";
import { resolveAddressForElement } from "./from-element.js";
import { revealPath } from "./reveal.js";

import type { AdminMessage } from "../protocol.js";
import type { FormStateLike } from "../resolve-path.js";
import type { ReactNode } from "react";

/** Payload renders exactly one live-preview iframe, with this id. */
const PREVIEW_IFRAME_ID = "live-preview-iframe";

const previewIframe = (): HTMLIFrameElement | null =>
	document.getElementById(PREVIEW_IFRAME_ID) as HTMLIFrameElement | null;

/**
 * Connects the admin form to the page it is previewing. Mounted inside the
 * document form by `viewfinderPlugin`, renders nothing, and stays inert until
 * a framed page announces itself.
 */
export const ViewfinderFormBridge = (): ReactNode => {
	const [fields] = useAllFormFields();

	/*
	 * Form state changes on every keystroke. Held in a ref so the listeners
	 * below are attached once and still read current state, rather than being
	 * torn down and re-attached as the editor types.
	 */
	const formState = useRef<FormStateLike>(fields);
	formState.current = fields;

	useEffect(() => {
		const post = (message: AdminMessage): void => {
			const iframe = previewIframe();
			const target = iframe?.contentWindow;
			if (!iframe || !target) {
				return;
			}

			target.postMessage(message, new URL(iframe.src, location.href).origin);
		};

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
			if (path === undefined) {
				return;
			}

			void revealPath(document, path);
		};

		const onFormActivity = (event: Event): void => {
			const address = resolveAddressForElement(
				formState.current,
				event.target as HTMLElement | null,
			);
			if (!address) {
				return;
			}

			post(
				event.type === "click"
					? adminMessage.scrollTo(address)
					: adminMessage.highlight(address),
			);
		};

		window.addEventListener("message", onMessage);
		document.addEventListener("focusin", onFormActivity);
		document.addEventListener("click", onFormActivity);

		return () => {
			window.removeEventListener("message", onMessage);
			document.removeEventListener("focusin", onFormActivity);
			document.removeEventListener("click", onFormActivity);
		};
	}, []);

	return null;
};
