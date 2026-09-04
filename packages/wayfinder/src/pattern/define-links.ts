import type {
	BaseResolvedLink,
	Contributed,
	LabelLike,
	LinkFieldData,
	LinkVariant,
} from "./types.js";
import type { Field } from "payload";

/**
 * Collapses a union of object types into their intersection.
 *
 * Indexing a record of variants yields a union, and `Contributed<T>` is
 * homomorphic, so it distributes over that union and every property becomes
 * invisible. Intersecting first is what keeps them readable.
 */
type UnionToIntersection<U> = (
	U extends unknown ? (it: U) => void : never
) extends (it: infer I) => void
	? I
	: never;

/** The values a `select` field accepts, from either option shape. */
type OptionValue<O> = O extends readonly (infer I)[]
	? I extends string
		? I
		: I extends { value: infer V }
			? V
			: never
	: never;

/**
 * The value one field holds, as Payload emits it.
 *
 * Deliberately narrow. The scalar types cover what a link variant realistically
 * contributes, and anything else resolves to `unknown` rather than a guess: a
 * wrong type here would be worse than an unhelpful one, because it would be
 * believed. `hasMany` is checked before the scalar case for the same reason —
 * it changes the value to an array, and typing it as a scalar would be wrong
 * rather than merely vague.
 */
type FieldData<F> = F extends { name: infer N extends string }
	? F extends { type: "select"; options: infer O; hasMany: true }
		? { [K in N]?: OptionValue<O>[] | null }
		: F extends { type: "select"; options: infer O }
			? { [K in N]?: OptionValue<O> | null }
			: F extends { type: "text" | "textarea" | "email" | "code" }
				? { [K in N]?: string | null }
				: F extends { type: "number" }
					? { [K in N]?: number | null }
					: F extends { type: "checkbox" }
						? { [K in N]?: boolean | null }
						: { [K in N]?: unknown }
	: object;

/** Everything a variant's own fields contribute, as one object type. */
export type DataOfFields<TFields extends readonly unknown[]> =
	UnionToIntersection<FieldData<TFields[number]>>;

/** A variant that has had no resolver attached. */
export interface LinkVariantSpec<TFields extends readonly Field[]> {
	label: LabelLike;
	fields?: TFields;
}

/**
 * A declared link type: its admin presentation, the fields it contributes, and
 * how it turns into an href.
 */
export interface LinkVariantDefinition<
	TCtx = unknown,
	TFields extends readonly Field[] = readonly Field[],
	TExtra = object,
> {
	label: LabelLike;
	fields?: TFields;
	resolve?: (args: {
		link: LinkFieldData<string, DataOfFields<TFields>>;
		context: TCtx;
	}) => (BaseResolvedLink & TExtra) | null;
}

/**
 * The loosest shape a variant can take, used wherever a declaration is only
 * being constrained rather than read.
 *
 * `resolve` takes `never` so that any resolver satisfies it: a parameter is
 * contravariant, and `never` is assignable to every argument type.
 */
export interface AnyLinkVariantDefinition {
	label: LabelLike;
	fields?: readonly Field[];
	resolve?: (args: never) => unknown;
}

/** The link vocabulary an app declares: which types exist and how each resolves. */
export interface LinkDeclaration<
	TVariants extends Record<string, AnyLinkVariantDefinition> = Record<
		string,
		AnyLinkVariantDefinition
	>,
> {
	variants: TVariants;
}

/** The stored shape of a link field built from a declaration. */
export type LinkDataOf<T> =
	T extends LinkDeclaration<infer TVariants>
		? LinkFieldData<
				Extract<keyof TVariants, string>,
				UnionToIntersection<
					{
						[K in keyof TVariants]: TVariants[K] extends {
							fields?: infer F extends readonly unknown[];
						}
							? DataOfFields<F>
							: object;
					}[keyof TVariants]
				>
			>
		: never;

/** What resolving a link built from a declaration can produce. */
export type ResolvedLinkOf<T> =
	T extends LinkDeclaration<infer TVariants>
		? BaseResolvedLink &
				Contributed<
					UnionToIntersection<
						{
							[K in keyof TVariants]: TVariants[K] extends {
								resolve?: (args: never) => infer R;
							}
								? Extract<R, BaseResolvedLink> extends infer E
									? Omit<E, keyof BaseResolvedLink>
									: object
								: object;
						}[keyof TVariants]
					>
				>
		: never;

/**
 * Builds one variant, inferring what its fields contribute.
 *
 * Two calls rather than one object, because TypeScript will not contextually
 * type a resolver from a sibling property of the same object literal. Passing
 * the fields through `variant(...)` first is what lets `.resolve()` see them.
 */
export type VariantBuilder<TCtx> = <const TFields extends readonly Field[]>(
	spec: LinkVariantSpec<TFields>,
) => LinkVariantDefinition<TCtx, TFields> & {
	resolve: <TExtra extends object>(
		fn: (args: {
			link: LinkFieldData<string, DataOfFields<TFields>>;
			context: TCtx;
		}) => (BaseResolvedLink & TExtra) | null,
	) => LinkVariantDefinition<TCtx, TFields, TExtra>;
};

const createVariantBuilder = <TCtx>(): VariantBuilder<TCtx> =>
	(<const TFields extends readonly Field[]>(
		spec: LinkVariantSpec<TFields>,
	) => ({
		...spec,
		resolve: (fn: unknown) => ({ ...spec, resolve: fn }),
	})) as VariantBuilder<TCtx>;

/**
 * Declares the link types an app offers.
 *
 * One declaration feeds every place a link is handled: the field an editor
 * fills in, the resolver that turns it into an href, and the rich-text
 * feature. Passing the same declaration to all of them is what stops a variant
 * existing in the admin panel but resolving to nothing.
 *
 * Curried because TypeScript has no partial type-argument inference: naming the
 * context type up front would otherwise force every variant's fields to be
 * named too.
 *
 * Returns plain data. It builds no field and resolves no link itself, so it
 * stays free of the Payload runtime and a frontend can hold the same
 * declaration the CMS config does.
 */
export const defineLinks =
	<TCtx = unknown>() =>
	<const TVariants extends Record<string, AnyLinkVariantDefinition>>(
		build: (variant: VariantBuilder<TCtx>) => { variants: TVariants },
	): LinkDeclaration<TVariants> =>
		build(createVariantBuilder<TCtx>());

/**
 * The context a declaration's resolvers expect, recovered from the declaration
 * itself so a caller does not have to name it twice.
 */
type ContextOfVariant<V> = V extends { resolve?: infer R }
	? NonNullable<R> extends (...args: never[]) => unknown
		? Parameters<NonNullable<R>>[0] extends { context: infer C }
			? C
			: never
		: never
	: never;

export type LinkContextOf<T> =
	T extends LinkDeclaration<infer TVariants>
		? UnionToIntersection<
				{
					[K in keyof TVariants]: ContextOfVariant<TVariants[K]>;
				}[keyof TVariants]
			>
		: unknown;

/**
 * Accepts either form of variant declaration.
 *
 * `TDeclaration` is a type parameter rather than the bare
 * {@link LinkDeclaration} so that what the declaration's resolvers return, and
 * the context they expect, both flow to the call site. Without it a caller
 * would have to annotate the result to see its own variants' properties.
 */
export interface LinkVariantSource<
	TCtx = unknown,
	TExtra = object,
	TDeclaration extends LinkDeclaration = LinkDeclaration,
> {
	/** The declaration built by {@link defineLinks}. */
	links?: TDeclaration;
	/** The array form, for hand-written variant types. */
	variants?: readonly LinkVariant<TCtx, TExtra>[];
}

/**
 * Flattens whichever form was supplied into one list.
 *
 * The keyed declaration carries each variant's value as its key, so it is put
 * back on the object here and everything downstream works with one shape.
 *
 * @param source The declaration, the array, or neither.
 */
export const variantsOf = <TCtx, TExtra>(
	source: LinkVariantSource<TCtx, TExtra>,
): readonly LinkVariant<TCtx, TExtra>[] => {
	if (source.links) {
		return Object.entries(source.links.variants).map(([value, definition]) => ({
			...(definition as unknown as LinkVariant<TCtx, TExtra>),
			value,
		}));
	}

	return source.variants ?? [];
};
