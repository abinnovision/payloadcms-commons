import {
	beforeChangeTraverseFields,
	beforeValidateTraverseFields,
} from "payload";

import { pointerFromPayloadPath } from "../schema/index.js";

import type { DocumentId, ResolvedEntity } from "../entity.js";
import type { JsonObject, PayloadRequest, ValidationFieldError } from "payload";

/**
 * One reason a human could not publish the draft as it stands.
 */
export interface PublishBlocker {
	/**
	 * Resolved field label path, e.g. "Layout > Block 2 (Hero) > Title".
	 */
	field?: string;
	message: string;
	/**
	 * JSON Pointer to the offending value, e.g. "/layout/2/title".
	 */
	path: string;
}

/**
 * Payload's field validation over a draft, without saving: `data` and the
 * context are copies. `beforeValidate` runs first because some field hooks
 * (Lexical's) prepare `context` state that `beforeChange` needs. Access is
 * overridden because the question is whether the draft could be published, not
 * whether this client may write it. `unavailable` means the traversal threw,
 * which is not the same as a clean document.
 */
export const collectPublishBlockers = async (
	req: PayloadRequest,
	target: { doc: JsonObject; entity: ResolvedEntity },
): Promise<{ blockers: PublishBlocker[]; unavailable?: true }> => {
	const { doc, entity } = target;
	// A global has no id. The guard below omits it, as the traversal expects.
	const id = doc["id"] as DocumentId | undefined;
	const errors: ValidationFieldError[] = [];
	const data: JsonObject = { ...structuredClone(doc), _status: "published" };
	const context = { ...req.context };

	const shared = {
		collection: entity.kind === "collection" ? entity.config : null,
		context,
		data,
		doc,
		global: entity.kind === "global" ? entity.config : null,
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
			fields: entity.config.fields,
			siblingData: data,
		});

		await beforeChangeTraverseFields({
			...shared,
			docWithLocales: doc,
			errors,
			fieldLabelPath: "",
			fields: entity.config.fields,
			mergeLocaleActions: [],
			siblingData: data,
			siblingDocWithLocales: doc,
			skipValidation: false,
		});
	} catch (error) {
		/*
		 * Advisory only: a failing traversal must not turn a write that already
		 * landed into a reported failure.
		 */
		req.payload.logger.warn(
			`[payloadcms-mcpx] Could not validate the ${entity.slug} draft: ${error instanceof Error ? error.message : "unknown error"}`,
		);

		return { blockers: [], unavailable: true };
	}

	return {
		blockers: errors.map((error) => ({
			message: error.message,
			path: pointerFromPayloadPath(error.path),
			...(typeof error.label === "string" ? { field: error.label } : {}),
		})),
	};
};
