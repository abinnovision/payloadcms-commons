import { createElement, Fragment } from "react";

import {
	checkIdentity,
	getBlockData as rawGetBlockData,
} from "./resolver/execute.js";

import type {
	BlockContext,
	BlockWrapper,
	InternalBlockEntry,
	Renderer,
} from "./types.js";
import type { ReactElement, ReactNode } from "react";

const isDev = (): boolean => process.env["NODE_ENV"] !== "production";

type EvaluateResult =
	| { ok: true; entry: InternalBlockEntry; data: unknown }
	| { ok: false; unknown?: boolean };

/**
 * Creates the dispatch surface (`Block`, `canRender`, `isRegistered`,
 * `renderBlockTree`) for one registry, and injects itself into every
 * component's `renderer` argument. Self-injection, rather than a module-level
 * singleton, is what makes montage reentrant: two consumers in one process,
 * or an example app plus its tests, do not share state.
 *
 * All gating and dispatch branching lives here, exhaustively unit tested via
 * `renderBlockTree`.
 */
export const createBlockTree = <TCtx,>(
	entries: ReadonlyMap<string, InternalBlockEntry>,
	registryCanRender:
		| ((args: {
				block: { blockType?: string };
				ctx: BlockContext<TCtx>;
		  }) => boolean)
		| undefined,
	/** Optional: the existing call sites predate it and pass nothing. */
	wrapBlock?: BlockWrapper<TCtx>,
): Pick<
	Renderer<TCtx>,
	"Block" | "canRender" | "isRegistered" | "renderBlockTree"
> => {
	const isRegistered = (slug: string): boolean => entries.has(slug);

	/**
	 * Render gating, in order: null guard, registry-level `canRender`
	 * (short-circuits before the slug is even looked up, which is what lets a
	 * block hidden by a cross-cutting rule stay silent even if its slug is
	 * not yet registered), the `blockType` guard and registration lookup,
	 * then the block's own `canRender`.
	 */
	const evaluate = (props: {
		block: unknown;
		ctx: BlockContext<TCtx>;
	}): EvaluateResult => {
		if (!props.block) {
			return { ok: false };
		}

		if (
			registryCanRender &&
			!registryCanRender({ block: props.block, ctx: props.ctx })
		) {
			return { ok: false };
		}

		const blockType = (props.block as { blockType?: unknown }).blockType;
		if (typeof blockType !== "string" || !entries.has(blockType)) {
			return { ok: false, unknown: true };
		}

		const entry = entries.get(blockType);
		if (!entry) {
			return { ok: false, unknown: true };
		}

		const data = rawGetBlockData(props.ctx, props.block);
		if (
			entry.canRender &&
			!entry.canRender({
				block: props.block,
				ctx: props.ctx,
				data,
				renderer: renderer as unknown as Renderer<unknown>,
			})
		) {
			return { ok: false };
		}

		return { ok: true, entry, data };
	};

	const canRender = (props: {
		block: unknown;
		ctx: BlockContext<TCtx>;
	}): boolean => {
		const result = evaluate(props);
		if (!result.ok && result.unknown && isDev()) {
			const blockType = (props.block as { blockType?: unknown } | undefined)
				?.blockType;
			/**
			 * Dev-only diagnostic: a block is registered in schema but has no
			 * renderer, which would otherwise fail silently.
			 */
			// eslint-disable-next-line no-console
			console.error(`montage: block "${String(blockType)}" is not registered.`);
		}

		return result.ok;
	};

	/** Wide, for JSX. Throws on an unregistered slug in development, renders nothing otherwise. */
	const Block = (props: {
		block: unknown;
		ctx: BlockContext<TCtx>;
	}): ReactNode | Promise<ReactNode> => {
		const result = evaluate(props);
		if (!result.ok) {
			if (result.unknown) {
				const blockType = (props.block as { blockType?: unknown } | undefined)
					?.blockType;
				if (isDev()) {
					throw new Error(
						`montage: block "${String(blockType)}" is not registered.`,
					);
				}
			}

			return null;
		}

		checkIdentity(props.ctx, props.block, entries);

		const children = result.entry.component({
			block: props.block,
			ctx: props.ctx,
			data: result.data,
			renderer: renderer as unknown as Renderer<unknown>,
		});

		/*
		 * The single choke point: every block reaches this line, at every
		 * nesting depth and through every route into the tree (a parent
		 * calling `renderer.Block`, an inline block, a richtext-embedded
		 * block), so one wrapper instruments the whole tree.
		 */
		if (!wrapBlock) {
			return children;
		}

		return wrapBlock({
			block: props.block as { blockType?: string },
			ctx: props.ctx,
			children,
		});
	};

	/** Narrow, for specs: awaits the component and wraps non-element results. */
	const renderBlockTree = async (props: {
		block: unknown;
		ctx: BlockContext<TCtx>;
	}): Promise<ReactElement | null> => {
		const result = await Block(props);
		if (
			result === null ||
			result === undefined ||
			typeof result === "boolean"
		) {
			return null;
		}

		if (typeof result === "object" && "type" in result && "props" in result) {
			return result as ReactElement;
		}

		/*
		 * Non-element results (string, number, array, fragment) are wrapped so
		 * the return type stays a walkable ReactElement.
		 */
		return createElement(Fragment, null, result as ReactNode);
	};

	const renderer = { Block, canRender, isRegistered, renderBlockTree };

	return renderer;
};
