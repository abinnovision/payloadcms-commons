import { text } from "payload/shared";

import { translate } from "./translations.js";

import type { Field, TextField } from "payload";

export interface CreateCollectionStringFieldArgs {
	name: string;
	required?: boolean;
	label?: TextField["label"];
	admin?: TextField["admin"];
}

/**
 * A text field holding a collection slug, validated against the collections
 * actually registered on this Payload instance.
 *
 * A select would need its options frozen at config-build time, which would
 * make the field go stale whenever a collection is added.
 *
 * @param args Field name and presentation overrides.
 */
export const createCollectionStringField = (
	args: CreateCollectionStringFieldArgs,
): Field => {
	/*
	 * Typed as TextField rather than Field so `validate` gets its parameters
	 * contextually; the Field union cannot supply them.
	 */
	const field: TextField = {
		name: args.name,
		type: "text",
		required: args.required ?? false,
		...(args.label !== undefined ? { label: args.label } : {}),
		...(args.admin !== undefined ? { admin: args.admin } : {}),
		validate: (value, opts) => {
			const base = text(value, opts);

			if (base !== true) {
				return base;
			}

			if (value === undefined || value === null || value === "") {
				return true;
			}

			const known = Object.keys(opts.req.payload.collections);

			if (!known.includes(value)) {
				return translate(opts.req.t as never, "unknownCollection", {
					value,
					known: known.join(", "),
				});
			}

			return true;
		},
	};

	return field;
};
