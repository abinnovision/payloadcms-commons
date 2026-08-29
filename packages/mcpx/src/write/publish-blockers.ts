import {
	beforeChangeTraverseFields,
	beforeValidateTraverseFields,
} from "payload";

import { pointerFromPayloadPath } from "../schema/index.js";

import type { ResolvedTarget } from "../tools/target.js";
import type { PublishBlocker } from "../types.js";
import type { JsonObject, PayloadRequest, ValidationFieldError } from "payload";

/**
 * Runs Payload's own field validation over a draft without saving anything.
 *
 * The same traversal a real save runs, exported from `payload` and called with
 * `skipValidation: false` so it collects into `errors` instead of throwing. The
 * `beforeValidate` pass runs first because some field hooks (Lexical's) prepare
 * state in `context` that their `beforeChange` counterpart depends on.
 *
 * Nothing is written: `data` is a copy, the context is a scratch copy and the
 * locale merge actions are discarded. `overrideAccess` is true because the
 * question is "could this be published", not "may this client write it".
 *
 * `unavailable` marks a traversal that threw, which is not the same answer as a
 * document with nothing wrong with it.
 */
export const collectPublishBlockers = async (
	req: PayloadRequest,
	target: { doc: JsonObject; entity: ResolvedTarget },
): Promise<{ blockers: PublishBlocker[]; unavailable?: true }> => {
	const { doc, entity } = target;
	/*
	 * A global doc has no id, so the guard below simply omits it, which is
	 * what the traversal wants for a global.
	 */
	const id = doc["id"] as number | string | undefined;
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
