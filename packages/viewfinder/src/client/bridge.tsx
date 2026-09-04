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
}

interface Active {
	element: Element;
	address: BlockAddress;
}

const findBlock = (id: string): Element | null =>
	document.querySelector(`[${BLOCK_ID_ATTRIBUTE}="${CSS.escape(id)}"]`);

const labelFor = (address: BlockAddress): string =>
	address.field === undefined
		? (address.blockType ?? "block")
		: `${address.blockType ?? "block"} · ${address.field}`;

/**
 * Connects the rendered page to the Payload admin that is previewing it.
 * Mount once, near the root of the app.
 *
 * Hovering a block outlines it and names it; clicking anywhere inside it
 * selects it. The whole block is the target, so there is nothing to aim at.
 *
 * Does nothing at all when the page is not framed, so the same tree can be
 * served to real visitors without a second code path.
 */
export const ViewfinderBridge = (props: ViewfinderBridgeProps): ReactNode => {
	const { adminOrigin } = props;
	const [active, setActive] = useState<Active | null>(null);
	const [box, setBox] = useState<Box | undefined>(undefined);

	useEffect(() => {
		if (window.parent === window) {
			return undefined;
		}

		const post = (message: PreviewMessage): void => {
			window.parent.postMessage(message, adminOrigin);
		};

		/*
		 * `pointerover` fires on every element transition, so hover is posted
		 * only when the block underneath actually changes. Without this the
		 * channel carries a message per mouse twitch.
		 */
		let hovered: string | null = null;
		const postHover = (address: BlockAddress | null): void => {
			const id = address?.id ?? null;
			if (id === hovered) {
				return;
			}

			hovered = id;
			post(address ? previewMessage.hover(address) : previewMessage.leave());
		};

		const onPointerOver = (event: PointerEvent): void => {
			const resolved = resolveTarget(event.target as Element | null);
			if (!resolved) {
				setActive(null);
				postHover(null);

				return;
			}

			setActive({ element: resolved.element, address: resolved.address });
			postHover(resolved.address);
		};

		/*
		 * Capture phase, so a block that stops propagation on its own root
		 * cannot make itself unselectable.
		 *
		 * A click inside a marked block selects it instead of doing whatever
		 * the page would have done, which is the trade this makes: the whole
		 * block is the target, and a link inside one does not navigate while
		 * the page is framed. Modified and secondary clicks are left alone, so
		 * an editor can still open a link in a new tab. Clicks outside every
		 * marked block are never touched.
		 */
		const onClick = (event: MouseEvent): void => {
			if (
				event.button !== 0 ||
				event.metaKey ||
				event.ctrlKey ||
				event.shiftKey ||
				event.altKey
			) {
				return;
			}

			const resolved = resolveTarget(event.target as Element | null);
			if (!resolved) {
				return;
			}

			event.preventDefault();
			event.stopPropagation();
			setActive({ element: resolved.element, address: resolved.address });
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

			setActive({ element, address: event.data.address });
			if (event.data.type === "scrollTo") {
				const measured = measureElement(element);
				if (measured) {
					scrollBoxIntoView(window, measured);
				}
			}
		};

		document.addEventListener("pointerover", onPointerOver, { passive: true });
		document.addEventListener("click", onClick, { capture: true });
		window.addEventListener("message", onMessage);
		post(previewMessage.ready());

		return () => {
			document.removeEventListener("pointerover", onPointerOver);
			document.removeEventListener("click", onClick, { capture: true });
			window.removeEventListener("message", onMessage);
		};
	}, [adminOrigin]);

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

	return (
		<Overlay box={box} label={active ? labelFor(active.address) : undefined} />
	);
};
