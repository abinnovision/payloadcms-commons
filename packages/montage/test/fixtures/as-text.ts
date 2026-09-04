import type { ReactNode } from "react";

/**
 * Every fixture component in this tree returns a plain string, never a real
 * React element, so `Renderer.Block`'s wide `ReactNode | Promise<ReactNode>`
 * return type is narrower than reality here. This makes that narrowing
 * explicit at the one place it is needed, instead of `String(...)`, which
 * would coerce a genuine React element to `"[object Object]"`.
 *
 * For `renderer.Block(...)` results only: `renderBlockTree(...)` wraps a
 * non-element result (like these fixtures' strings) in a real `Fragment`
 * element, so casting its return straight to `string` gives the wrong
 * value. Read `.props.children` for that one instead.
 */
export const asText = (node: ReactNode | Promise<ReactNode>): string =>
	node as string;
