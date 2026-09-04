import { relationship, text } from "payload/shared";

import type {
	LabelLike,
	LinkFieldData,
	LinkVariant,
} from "../pattern/types.js";
import type { Field, PolymorphicRelationshipField, TextField } from "payload";

/** Admin labels for the built-in link types. */
export interface LinkFieldLabels {
	label?: LabelLike;
	none?: LabelLike;
	reference?: LabelLike;
	custom?: LabelLike;
	samePage?: LabelLike;
	newTab?: LabelLike;
	referenceField?: LabelLike;
	urlField?: LabelLike;
	samePageField?: LabelLike;
}

/** Values a variant may claim in order to replace the built-in behaviour. */
const BUILTIN_VALUES = new Set(["none", "reference", "custom", "same-page"]);

const DEFAULT_LABELS: Required<LinkFieldLabels> = {
	label: "Label",
	none: "None",
	reference: "Internal link",
	custom: "Custom",
	samePage: "Same page",
	newTab: "Open in new tab",
	referenceField: "Document to link to",
	urlField: "Custom URL",
	samePageField: "Section identifier",
};

export interface LinkFieldArgs<TCtx = unknown, TExtra = object> {
	/**
	 * Every collection that has a URL. A target missing here cannot be linked
	 * to from the admin panel even if its mapping exists.
	 */
	relationTo: string[];
	/** App-declared link types, appended after the built-ins. */
	variants?: LinkVariant<TCtx, TExtra>[];
	required?: boolean;
	withLabel?: boolean;
	localizedLabel?: boolean;
	labels?: LinkFieldLabels;
	/**
	 * Generated-type name. Unset by default: a package cannot claim a global
	 * type name, and two calls with different targets would collide on it.
	 */
	interfaceName?: string;
}

/**
 * A link that can point at a document, an arbitrary URL, or an anchor.
 *
 * The stored value is routed by `resolveLink`, which reads the collection
 * mapping — so a link authored once follows its target when that collection's
 * URL pattern changes.
 *
 * Each conditional sub-field declares itself optional and re-implements
 * required-ness inside `validate`. Payload validates hidden fields too, so a
 * plain `required: true` on a field behind a condition blocks saving whenever
 * a different link type is selected.
 *
 * @param args Link targets, extra variants and presentation overrides.
 */
/**
 * Shows a variant's own fields only when that variant is selected.
 *
 * Spreading a member of the `Field` union widens its discriminated `admin`
 * shape to the union's, which no longer assigns back — so the result is
 * reassembled through a single narrow assertion here rather than at each of
 * the four call sites this would otherwise need.
 *
 * @param field The variant's field.
 * @param value The variant's own value.
 */
const withVariantCondition = <T extends Field>(field: T, value: string): T => {
	const next: T = { ...field };
	const admin = next as { admin?: Record<string, unknown> };

	admin.admin = {
		...admin.admin,
		condition: (_: unknown, siblingData: LinkFieldData) =>
			siblingData.type === value,
	};

	return next;
};

export const linkField = <TCtx = unknown, TExtra = object>(
	args: LinkFieldArgs<TCtx, TExtra>,
): Field => {
	const isRequired = args.required ?? true;
	const withLabel = args.withLabel ?? false;
	const localizedLabel = args.localizedLabel ?? true;
	const labels = { ...DEFAULT_LABELS, ...args.labels };
	const variants = args.variants ?? [];

	/*
	 * Payload validates hidden fields too, so required-ness has to be checked
	 * against the selected type rather than declared on the field.
	 */
	const missingRequired = (
		type: string,
		value: unknown,
		siblingData: unknown,
	): boolean => (siblingData as LinkFieldData).type === type && !value;

	return {
		name: "link",
		type: "group",
		...(args.interfaceName ? { interfaceName: args.interfaceName } : {}),
		admin: { hideGutter: true },
		fields: [
			{
				name: "label",
				type: "text",
				required: withLabel && isRequired,
				hidden: !withLabel,
				localized: localizedLabel,
				label: labels.label,
			} satisfies TextField,
			{
				type: "row",
				fields: [
					{
						name: "type",
						type: "radio",
						admin: { layout: "horizontal", width: "50%" },
						defaultValue: isRequired ? "reference" : "none",
						options: [
							/*
							 * A variant may claim a built-in's value to replace
							 * how it resolves, so the built-in option is
							 * dropped rather than offered twice. Its position
							 * is kept: editors read this list by shape.
							 */
							...[
								...(!isRequired ? [{ label: labels.none, value: "none" }] : []),
								{ label: labels.reference, value: "reference" },
								{ label: labels.custom, value: "custom" },
								{ label: labels.samePage, value: "same-page" },
							].map(
								(builtin) =>
									variants.find((it) => it.value === builtin.value) ?? builtin,
							),
							...variants.filter((it) => !BUILTIN_VALUES.has(it.value)),
						].map((it) => ({ label: it.label, value: it.value })),
					},
					{
						name: "newTab",
						type: "checkbox",
						label: labels.newTab,
						admin: {
							style: { alignSelf: "flex-end" },
							width: "50%",
							/*
							 * Not offered for an anchor on the current page:
							 * opening one in a new tab loads a second copy of
							 * the page rather than moving within this one, so
							 * `resolveLink` ignores it there and the checkbox
							 * would be a control that does nothing.
							 */
							condition: (_, siblingData: LinkFieldData) =>
								siblingData.type !== "same-page",
						},
					},
				],
			},
			{
				name: "reference",
				type: "relationship",
				label: labels.referenceField,
				admin: {
					condition: (_, siblingData: LinkFieldData) =>
						siblingData.type === "reference",
				},
				/*
				 * No `maxDepth`: Payload measures it from the query root, so any
				 * cap low enough to be worth setting also silently un-populates
				 * links authored inside a referenced block — every header and
				 * footer link — leaving a bare id that cannot be routed.
				 * Declare `defaultPopulate` on linkable collections instead, so
				 * a populated target is a handful of fields and the query's own
				 * depth is the bound.
				 */
				relationTo: args.relationTo,
				hasMany: false,
				required: false,
				validate: (value, ctx) =>
					missingRequired("reference", value, ctx.siblingData)
						? ctx.req.t("validation:required")
						: relationship(value, ctx),
			} satisfies PolymorphicRelationshipField,
			{
				name: "url",
				type: "text",
				label: labels.urlField,
				admin: {
					condition: (_, siblingData: LinkFieldData) =>
						siblingData.type === "custom",
				},
				required: false,
				validate: (value, ctx) =>
					missingRequired("custom", value, ctx.siblingData)
						? ctx.req.t("validation:required")
						: text(value, ctx),
			} satisfies TextField,
			{
				name: "samePageIdentifier",
				type: "text",
				label: labels.samePageField,
				admin: {
					condition: (_, siblingData: LinkFieldData) =>
						siblingData.type === "same-page",
				},
				required: false,
				validate: (value, ctx) =>
					missingRequired("same-page", value, ctx.siblingData)
						? ctx.req.t("validation:required")
						: text(value, ctx),
			} satisfies TextField,
			...variants.flatMap((variant) =>
				(variant.fields ?? []).map((field) =>
					withVariantCondition(field, variant.value),
				),
			),
		],
	} satisfies Field;
};
