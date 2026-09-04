import type { BlockSlug, TypedBlock } from "payload";
import type { ReactElement, ReactNode } from "react";

/**
 * Montage owns the `montage:` key prefix on the render context and reads
 * nothing else. Not readonly: `resolveBlockData` and context extensions
 * write here.
 */
export type MontageSlots = { [K in `montage:${string}`]?: unknown };

/**
 * The render context. Generic over the consumer's own base shape, since
 * montage never reads a field outside its own namespace.
 */
export type BlockContext<T> = T & MontageSlots;

/**
 * A defined block component. Opaque to consumers beyond its slug, which the
 * registry uses to check that a component is registered under its own key.
 */
export interface BlockComponent<TSlug extends string = string> {
	readonly slug: TSlug;
}

declare const registryBrand: unique symbol;

/** Opaque handle produced by `defineBlockRegistry`, consumed by `createRenderer`. */
export interface BlockRegistry {
	readonly [registryBrand]: typeof registryBrand;
}

/**
 * Fails closed when generated Payload types are not present: `BlockSlug`
 * degrades to `string` rather than `never`, so without this guard every
 * slug-checking guarantee in the package would silently stop working.
 */
export type RequireGeneratedTypes = string extends BlockSlug
	? "montage: run `payload generate:types` before typechecking"
	: unknown;

export interface BlockRenderArgs<TBlock, D, TCtx> {
	block: TBlock;
	ctx: BlockContext<TCtx>;
	data: D;
	/** Render or test children through this, never through an imported binding. */
	renderer: Renderer<TCtx>;
}

export interface BlockComponentOptions<TBlock, D, TCtx> {
	resolve?: (args: {
		block: TBlock;
		ctx: BlockContext<TCtx>;
	}) => Promise<D> | D;
	/** Only meaningful with `resolve`: this result contains blocks needing resolution. */
	expands?: boolean;
	canRender?: (args: BlockRenderArgs<TBlock, D, TCtx>) => boolean;
	component: (
		args: BlockRenderArgs<TBlock, D, TCtx>,
	) => ReactNode | Promise<ReactNode>;
}

export interface Renderer<TCtx> {
	/** Wide, for JSX. Returns whatever the component returned. */
	Block: (props: {
		block: unknown;
		ctx: BlockContext<TCtx>;
	}) => ReactNode | Promise<ReactNode>;
	/** Narrow, for specs: awaits the component and wraps non-element results. */
	renderBlockTree: (props: {
		block: unknown;
		ctx: BlockContext<TCtx>;
	}) => Promise<ReactElement | null>;
	canRender: (args: { block: unknown; ctx: BlockContext<TCtx> }) => boolean;
	isRegistered: (slug: string) => boolean;
	resolveBlockData: (args: {
		root: object;
		ctx: BlockContext<TCtx>;
		scope?: "root" | "tree";
		maxPasses?: number;
	}) => Promise<void>;
	/**
	 * `D` lets callers narrow the return type explicitly
	 * (`getBlockData<HeroModuleBlock>(...)`); the lint rule cannot see that as
	 * intentional since it appears once structurally.
	 */
	// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
	getBlockData: <D = unknown>(
		ctx: BlockContext<TCtx>,
		node: object,
	) => D | undefined;
}

export interface Montage<TCtx extends object> {
	defineBlockComponent: <S extends BlockSlug, D = undefined>(
		slug: S,
		options: BlockComponentOptions<TypedBlock[S], D, TCtx>,
	) => BlockComponent<S>;

	/** Curried so `D` still infers once `TBlock` is supplied explicitly. */
	defineInlineBlockComponent: <TBlock extends { blockType: string }>() => <
		D = undefined,
	>(
		slug: TBlock["blockType"],
		options: BlockComponentOptions<TBlock, D, TCtx>,
	) => BlockComponent<TBlock["blockType"]>;

	/**
	 * `entries` is keyed by slug, and the mapped constraint forces each
	 * component's own slug to match its key, so aliasing and mismatched
	 * bindings are compile errors. Dispatch uses the object key.
	 */
	defineBlockRegistry: <
		const E extends { [K in keyof E]: BlockComponent<K & string> },
		/**
		 * `R` is constrained to `keyof E`, which is what makes a `require`
		 * entry missing from `entries` a compile error. The rule sees one
		 * structural occurrence and misses the constraint.
		 */
		// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
		const R extends readonly (keyof E & string)[] = [],
	>(
		/**
		 * `RequireGeneratedTypes` resolves to `unknown` (a no-op intersection)
		 * once a consumer's generated types are present, and to a blocking
		 * string literal otherwise. The lint rule only ever sees whichever
		 * resolution is in scope for the current compilation, so it calls the
		 * `unknown` case redundant. That is the fail-closed design working as
		 * intended.
		 */
		// eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
		entries: E & RequireGeneratedTypes,
		options?: {
			/** Runs before the blockType guard, so blockType may be absent. */
			canRender?: (args: {
				block: { blockType?: string };
				ctx: BlockContext<TCtx>;
			}) => boolean;
			require?: R;
		},
	) => BlockRegistry;

	createRenderer: (registry: BlockRegistry) => Renderer<TCtx>;
}

/** Internal shape of a defined block component, used only inside montage. */
export interface InternalBlockEntry {
	readonly slug: string;
	readonly expands: boolean;
	/*
	 * Sync or async: `unknown` already covers `Promise<unknown>` structurally,
	 * and `await` unwraps either at the call site in `resolver/execute.ts`.
	 */
	readonly resolve?:
		| ((args: { block: unknown; ctx: BlockContext<unknown> }) => unknown)
		| undefined;
	readonly canRender?:
		| ((args: {
				block: unknown;
				ctx: BlockContext<unknown>;
				data: unknown;
				renderer: Renderer<unknown>;
		  }) => boolean)
		| undefined;
	readonly component: (args: {
		block: unknown;
		ctx: BlockContext<unknown>;
		data: unknown;
		renderer: Renderer<unknown>;
	}) => ReactNode | Promise<ReactNode>;
}

/** Internal shape of `BlockRegistry`, used only inside montage. */
export interface InternalRegistry extends BlockRegistry {
	readonly entries: ReadonlyMap<string, InternalBlockEntry>;
	readonly canRender?:
		| ((args: {
				block: { blockType?: string };
				ctx: BlockContext<unknown>;
		  }) => boolean)
		| undefined;
}
