import { DummyNamedError } from "./errors.js";
import { DummyRowMismatchError, graftRowIds } from "./walk.js";

import type { DummyDocumentId } from "./types.js";
import type { Payload } from "payload";

/** Reads a document or global as one locale stores it, for its row ids. */
type ReadBack = (locale: string) => Promise<Record<string, unknown>>;

/** Writes one locale's override over an existing document or global. */
type WriteLocale = (locale: string, data: unknown) => Promise<void>;

/**
 * Writes the extra locales of a document that has already been written.
 *
 * Each pass reads the stored rows at the locale it is about to write and grafts
 * their ids onto the override, because an array whose rows carry a localized
 * field shares one row set and a write without the ids would drop the other
 * locales' values.
 *
 * The read disables the locale fallback so it answers what that locale actually
 * stores. A fallback would hand back the default locale's rows, and grafting
 * their ids onto an array that is itself localized would collide on the key.
 *
 * @param locales The overrides, already resolved of refs.
 * @param subject How the document reads in a message, such as `pages "/about"`.
 * @param io How to read a locale back and how to write one.
 */
const writeLocales = async (
	locales: Record<string, unknown>,
	subject: string,
	io: { read: ReadBack; write: WriteLocale },
): Promise<void> => {
	for (const [locale, data] of Object.entries(locales)) {
		// eslint-disable-next-line no-await-in-loop -- each locale is read and written in turn
		const stored = await io.read(locale);
		let grafted: unknown;

		try {
			grafted = graftRowIds(structuredClone(data), stored);
		} catch (error) {
			if (error instanceof DummyRowMismatchError) {
				throw new DummyNamedError(
					`${subject}: locale "${locale}" ${error.message}. A localized ` +
						"array shares one row set across locales, so the rows must " +
						"line up.",
					{ cause: error },
				);
			}

			throw error;
		}

		// eslint-disable-next-line no-await-in-loop -- each locale is read and written in turn
		await io.write(locale, grafted);
	}
};

/** Writes the extra locales of a collection document. */
export const writeDocLocales = async (
	payload: Payload,
	target: { collection: string; id: DummyDocumentId; subject: string },
	locales: Record<string, unknown>,
): Promise<void> => {
	await writeLocales(locales, target.subject, {
		read: async (locale) =>
			await payload.findByID({
				collection: target.collection,
				id: target.id,
				depth: 0,
				locale,
				fallbackLocale: false,
				overrideAccess: true,
			}),
		write: async (locale, data) => {
			await payload.update({
				collection: target.collection,
				id: target.id,
				locale,
				data: data as never,
				draft: false,
				overrideAccess: true,
			});
		},
	});
};

/** Writes the extra locales of a global. */
export const writeGlobalLocales = async (
	payload: Payload,
	target: { slug: string; subject: string },
	locales: Record<string, unknown>,
): Promise<void> => {
	await writeLocales(locales, target.subject, {
		read: async (locale) =>
			await payload.findGlobal({
				slug: target.slug,
				depth: 0,
				locale,
				fallbackLocale: false,
				overrideAccess: true,
			}),
		write: async (locale, data) => {
			await payload.updateGlobal({
				slug: target.slug,
				locale,
				data: data as never,
				draft: false,
				overrideAccess: true,
			});
		},
	});
};
