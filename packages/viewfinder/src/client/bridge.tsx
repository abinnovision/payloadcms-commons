"use client";

import { useEffect, useState } from "react";

import { BLOCK_ID_ATTRIBUTE } from "../attributes.js";
import { isAdminMessage, previewMessage } from "../protocol.js";
import { measureElement, scrollBoxIntoView } from "./geometry.js";
import { Overlay } from "./overlay.js";
import { resolveTarget } from "./target.js";

import type { Box } from "./geometry.js";
import type { BlockAddress, PreviewMessage } from "../protocol.js";
import type { ReactNode } from "react";

export interface ViewfinderBridgeProps {
	/**
	 * Origin of the Payload admin, e.g. `https://cms.example.com`. Required
	 * rather than defaulting to `"*"`: this window posts the ids of everything
	 * it renders, and validates what it is told to highlight.
	 */
	adminOrigin: string;
	/**
	 * Suppress link navigation for clicks inside a marked block, so selecting
	 * a block does not navigate away from the page being edited. Hold a
	 * modifier key to follow a link anyway. Defaults to `true`.
	 */
	interceptNavigation?: boolean | undefined;
}

interface Active {
	element: Element;
	label: string | undefined;
}

const findBlock = (id: string): Element | null =>
	document.querySelector(`[${BLOCK_ID_ATTRIBUTE}="${CSS.escape(id)}"]`);

const labelFor = (address: BlockAddress): string | undefined =>
	address.field === undefined
		? address.blockType
		: `${address.blockType ?? "block"} · ${address.field}`;

/**
 * Connects the rendered page to the Payload admin that is previewing it.
 * Mount once, near the root of the app.
 *
 * Does nothing at all when the page is not framed, so the same tree can be
 * served to real visitors without a second code path.
 */
export const ViewfinderBridge = (props: ViewfinderBridgeProps): ReactNode => {
	const { adminOrigin, interceptNavigation = true } = props;
	const [active, setActive] = useState<Active | null>(null);
	const [box, setBox] = useState<Box | undefined>(undefined);

	useEffect(() => {
		if (window.parent === window) {
			return undefined;
		}

		const post = (message: PreviewMessage): void => {
			window.parent.postMessage(message, adminOrigin);
		};

		const show = (element: Element, address: BlockAddress): void => {
			setActive({ element, label: labelFor(address) });
		};

		const onPointerOver = (event: PointerEvent): void => {
			const resolved = resolveTarget(event.target as Element | null);
			if (!resolved) {
				setActive(null);
				post(previewMessage.leave());

				return;
			}

			show(resolved.element, resolved.address);
			post(previewMessage.hover(resolved.address));
		};

		const onClick = (event: MouseEvent): void => {
			const resolved = resolveTarget(event.target as Element | null);
			if (!resolved) {
				return;
			}

			const modified =
				event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
			const link = (event.target as Element | null)?.closest("a[href]");
			if (interceptNavigation && link && !modified) {
				event.preventDefault();
			}

			show(resolved.element, resolved.address);
			post(previewMessage.select(resolved.address));
		};

		const onMessage = (event: MessageEvent): void => {
			if (event.origin !== adminOrigin || event.source !== window.parent) {
				return;
			}

			if (!isAdminMessage(event.data)) {
				return;
			}

			if (event.data.type === "clear") {
				setActive(null);

				return;
			}

			const element = findBlock(event.data.address.id);
			if (!element) {
				return;
			}

			show(element, event.data.address);
			if (event.data.type === "scrollTo") {
				const measured = measureElement(element);
				if (measured) {
					scrollBoxIntoView(window, measured);
				}
			}
		};

		document.addEventListener("pointerover", onPointerOver, { passive: true });
		document.addEventListener("click", onClick);
		window.addEventListener("message", onMessage);
		post(previewMessage.ready());

		return () => {
			document.removeEventListener("pointerover", onPointerOver);
			document.removeEventListener("click", onClick);
			window.removeEventListener("message", onMessage);
		};
	}, [adminOrigin, interceptNavigation]);

	useEffect(() => {
		if (!active) {
			setBox(undefined);

			return undefined;
		}

		const measure = (): void => {
			setBox(measureElement(active.element));
		};

		measure();

		/*
		 * The block's own size, the page's layout and the scroll offset can each
		 * move the frame independently, and images settling after load move it
		 * without any of the three firing. The observer on the element covers
		 * that last case.
		 */
		const observer = new ResizeObserver(measure);
		observer.observe(active.element);
		observer.observe(document.documentElement);
		window.addEventListener("scroll", measure, {
			capture: true,
			passive: true,
		});
		window.addEventListener("resize", measure, { passive: true });

		return () => {
			observer.disconnect();
			window.removeEventListener("scroll", measure, { capture: true });
			window.removeEventListener("resize", measure);
		};
	}, [active]);

	return <Overlay box={box} label={active?.label} />;
};
