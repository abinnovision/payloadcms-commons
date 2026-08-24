import {
	beforeChangeTraverseFields,
	beforeValidateTraverseFields,
} from "payload";

import { pointerFromPayloadPath } from "../schema/walk.js";

import type {
	JsonObject,
	PayloadRequest,
	SanitizedCollectionConfig,
	ValidationFieldError,
} from "payload";

/**
 * One reason a human could not publish the draft as it stands.
 */
interface PublishBlocker {
	/** Resolved field label path, e.g. "Layout > Block 2 (Hero) > Title". */
	field?: string;
	message: string;
	/** JSON Pointer to the offending value, e.g. "/layout/2/title". */
	path: string;
}

/**
 * Runs Payload's own field validation over a draft without saving anything.
 *
 * Draft saves skip validation unless `versions.drafts.validate` is set, so an
 * agent building a document incrementally gets no signal until a human presses
 * Publish. This is the same traversal a real save runs, exported from
 * `payload`, called with `skipValidation: false` so it collects into `errors`
 * instead of throwing. The `beforeValidate` pass runs first because some field
 * hooks (Lexical's) prepare state in `context` that their `beforeChange`
 * counterpart depends on.
 *
 * Nothing is written: `data` is a copy, the context is a scratch copy and the
 * locale merge actions are discarded. `overrideAccess` is true because the
 * question is "could this be published", not "may this client write it".
 *
 * Limits: only the locale the doc was read in is checked, and field-level
 * `beforeChange` hooks run again, which is safe only for pure ones.
 */
const collectPublishBlockers = async (
	req: PayloadRequest,
	target: { collection: SanitizedCollectionConfig; doc: JsonObject },
): Promise<PublishBlocker[]> => {
	const { collection, doc } = target;
	const id = doc["id"] as number | string | undefined;
	const errors: ValidationFieldError[] = [];
	const data: JsonObject = { ...structuredClone(doc), _status: "published" };
	const context = { ...req.context };

	const shared = {
		collection,
		context,
		data,
		doc,
		global: null,
		operation: "update" as const,
		overrideAccess: true,
		parentIndexPath: "",
		parentIsLocalized: false,
		parentPath: "",
		parentSchemaPath: "",
		req,
		siblingDoc: doc,
		...(id === undefined ? {} : { id }),
	};

	try {
		await beforeValidateTraverseFields({
			...shared,
			fields: collection.fields,
			siblingData: data,
		});

		await beforeChangeTraverseFields({
			...shared,
			docWithLocales: doc,
			errors,
			fieldLabelPath: "",
			fields: collection.fields,
			mergeLocaleActions: [],
			siblingData: data,
			siblingDocWithLocales: doc,
			skipValidation: false,
		});
	} catch (error) {
		// Advisory only: a failing traversal must not turn a write that already
		// landed into a reported failure.
		req.payload.logger.warn(
			`[payloadcms-mcpx] Could not validate the ${collection.slug} draft: ${error instanceof Error ? error.message : "unknown error"}`,
		);

		return [];
	}

	return errors.map((error) => ({
		message: error.message,
		path: pointerFromPayloadPath(error.path),
		...(typeof error.label === "string" ? { field: error.label } : {}),
	}));
};

export type { PublishBlocker };
export { collectPublishBlockers };
