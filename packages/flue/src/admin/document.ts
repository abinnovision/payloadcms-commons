import { createContext } from "react";

/** The document an open edit view shows, as the chat reads and syncs it. */
export interface OpenDocument {
	collection?: string | undefined;
	id?: string | undefined;
	global?: string | undefined;
	/** The document's collection or global has drafts. */
	drafts: boolean;
	/** The form holds edits the server does not have. */
	modified: () => boolean;
	/** The agent changed the document in a way the form's edits cannot follow. */
	stale: () => boolean;
	/** The path of the field the user last focused. */
	focus: () => string | undefined;
	/** Saves the form as a draft, as the Save draft button does. */
	saveDraft: () => Promise<void>;
	/** Loads the document from the server after `writes` agent writes. */
	reload: (writes: number) => void;
}

/** Where the edit view's bridge registers the document it shows. */
export interface DocumentRegistry {
	/** Registers the open document; the result unregisters it. */
	register: (document: OpenDocument) => () => void;
	current: () => OpenDocument | undefined;
	/** Calls `listener` whenever a document registers; the result unsubscribes. */
	subscribe: (listener: () => void) => () => void;
}

export const DocumentRegistryContext = createContext<DocumentRegistry | null>(
	null,
);

/** A registry holding the last registered document. */
export const documentRegistry = (): DocumentRegistry => {
	let current: OpenDocument | undefined;
	const listeners = new Set<() => void>();

	return {
		register: (document) => {
			current = document;

			for (const listener of listeners) {
				listener();
			}

			return () => {
				if (current === document) {
					current = undefined;
				}
			};
		},
		current: () => current,
		subscribe: (listener) => {
			listeners.add(listener);

			return () => {
				listeners.delete(listener);
			};
		},
	};
};

/** The document an edit view shows, or the global, as one comparable value. */
export const documentKey = (
	collection: null | string | undefined,
	id: null | string | undefined,
	global: null | string | undefined,
): string | undefined => {
	if (collection && id) {
		return `${collection}/${id}`;
	}

	return global ? `global/${global}` : undefined;
};

/**
 * The REST URL that reads and writes the document's draft in `locale`,
 * without falling back to another locale, as the Save draft button calls it.
 */
export const documentUrl = (args: {
	serverURL: string;
	apiRoute: string;
	collection?: string | undefined;
	id?: string | undefined;
	global?: string | undefined;
	locale?: string | undefined;
}): string => {
	const params = new URLSearchParams({
		depth: "0",
		draft: "true",
		"fallback-locale": "null",
	});

	if (args.locale !== undefined) {
		params.set("locale", args.locale);
	}

	const path =
		args.global === undefined
			? `/${args.collection ?? ""}/${encodeURIComponent(args.id ?? "")}`
			: `/globals/${args.global}`;

	return `${args.serverURL.replace(/\/+$/, "")}${args.apiRoute}${path}?${params.toString()}`;
};

/**
 * The path of the field an element belongs to, from the id Payload gives a
 * field's input: `field-` and the path with `__` for each dot. Anything after
 * a dash, such as an edit depth or an option, is not part of the path.
 */
export const fieldPathOf = (element: Element | null): string | undefined => {
	const id = element?.closest('[id^="field-"]')?.id;
	const path = id?.slice("field-".length).split("-")[0]?.replace(/__/g, ".");

	return path === "" ? undefined : path;
};

/** Why a turn is refused from a stale form. */
export const STALE_MESSAGE =
	"The agent changed this document while you were editing. Save your edits and reload the page before sending.";

/**
 * Brings the server up to date with the open form before a turn: unsaved
 * edits are saved as a draft, and refused without drafts, where saving
 * would publish them. A stale form is refused, as saving it would revert
 * the agent's changes.
 */
export const prepareTurn = async (
	document: OpenDocument | undefined,
): Promise<void> => {
	if (document === undefined) {
		return;
	}

	if (document.stale()) {
		throw new Error(STALE_MESSAGE);
	}

	if (!document.modified()) {
		return;
	}

	if (!document.drafts) {
		throw new Error("Save the document before asking the agent.");
	}

	await document.saveDraft();
};

/**
 * Runs `run` once at a time. Calls while it runs fold into one more run
 * after it, so a burst of writes causes at most two.
 */
export const coalesced = (
	run: () => Promise<void>,
	onError: (error: unknown) => void,
): (() => void) => {
	let running = false;
	let again = false;

	const start = (): void => {
		running = true;
		again = false;
		run()
			.catch(onError)
			.finally(() => {
				running = false;

				if (again) {
					start();
				}
			});
	};

	return () => {
		if (running) {
			again = true;
		} else {
			start();
		}
	};
};
