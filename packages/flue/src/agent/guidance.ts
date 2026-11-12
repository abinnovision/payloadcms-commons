import type { ChatContext } from "../protocol/context.js";

// Context values are user-controlled, so control characters become spaces.
const clean = (value: string): string => value.replace(/\p{Cc}/gu, " ");

/**
 * A prompt fragment for a turn sent from a document's edit view, or
 * `undefined` without one. It tells the model that the user sees each write
 * in the form, and what `drafts` and `focus` mean.
 */
export const openDocumentGuidance = (
	context: ChatContext | undefined,
): string | undefined => {
	const target =
		context?.collection !== undefined && context.id !== undefined
			? `document ${clean(context.id)} of the "${clean(context.collection)}" collection`
			: context?.global === undefined
				? undefined
				: `the "${clean(context.global)}" global`;

	if (target === undefined) {
		return undefined;
	}

	return [
		`The user has ${target} open in the admin and sees each of your writes to it as it lands.`,
		"Change it with small patchDocument operations rather than replacing whole fields.",
		context?.drafts === true
			? "Your writes are saved as drafts. Do not publish unless the user asks you to."
			: undefined,
		context?.focus === undefined
			? undefined
			: `The user last focused the field "${clean(context.focus)}"; "this" or "here" most likely means that field.`,
	]
		.filter((line) => line !== undefined)
		.join(" ");
};
