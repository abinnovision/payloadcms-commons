import path from "node:path";

import {
	DummyNamedError,
	decorate,
	describeError,
	errorPaths,
	fail,
} from "./errors.js";
import { writeDocLocales, writeGlobalLocales } from "./locales.js";
import { isDummyRef, describeRef } from "./ref.js";
import { applyRefs, collectRefs } from "./resolve.js";

import type { DummyIndexStore } from "./index-store.js";
import type { NormalizedOptions } from "./options.js";
import type { DummyDocumentId, DummyRef, DummyWriteTally } from "./types.js";
import type { CollectionSlug } from "payload";

/** A `doc` call kept so the runner can complete it once its refs resolve. */
export interface PendingWrite {
	collection: CollectionSlug;
	data: unknown;
	locales: Record<string, unknown> | undefined;
	seedId: string;
	identifier: string;
	refs: readonly DummyRef[];
}

export interface DummyWriter {
	doc: (
		collection: CollectionSlug,
		data: unknown,
		options?: { locales?: Record<string, unknown> | undefined },
	) => Promise<DummyDocumentId>;
	upload: (
		collection: CollectionSlug,
		filePath: string,
		data?: unknown,
	) => Promise<DummyDocumentId>;
	global: (
		slug: string,
		data: unknown,
		options?: {
			keepIfSet?: string | undefined;
			locales?: Record<string, unknown> | undefined;
		},
	) => Promise<void>;
	reset: (collections: readonly CollectionSlug[]) => Promise<void>;
}

export interface WriterDeps {
	options: NormalizedOptions;
	store: DummyIndexStore;
	tally: Map<string, DummyWriteTally>;
	pending: PendingWrite[];
	/** Which seed is running, for the pending queue and the error messages. */
	seedId: () => string;
	/** True while the runner is replaying, so a write is not queued twice. */
	replaying: () => boolean;
}

const emptyTally = (): DummyWriteTally => ({
	created: 0,
	updated: 0,
	skipped: 0,
	deleted: 0,
});

/**
 * Creates the run's write layer.
 *
 * Every write goes through here so that natural keys, publishing, access
 * override, ref resolution and error context are handled once instead of per
 * seed. `overrideAccess` is set and `depth` is 0 on every operation: a seed
 * runs as the system and never needs populated relationships back.
 *
 * Writes go through Payload's hooks and validation deliberately, so a seed
 * cannot produce a document the frontend is unable to render.
 *
 * @param deps The run's options, index, tally and pending queue.
 */
export const createWriter = (deps: WriterDeps): DummyWriter => {
	const { options, store, tally, pending } = deps;
	const { payload, reporter } = options;
	const warnedUploads = new Set<string>();

	const count = (slug: string, kind: keyof DummyWriteTally, by = 1): void => {
		const current = tally.get(slug) ?? emptyTally();

		tally.set(slug, { ...current, [kind]: current[kind] + by });
	};

	const findExisting = async (
		collection: CollectionSlug,
		key: string,
		value: unknown,
	): Promise<DummyDocumentId | undefined> => {
		const found = await payload.find({
			collection,
			where: { [key]: { equals: value } },
			limit: 1,
			depth: 0,
			pagination: false,
			overrideAccess: true,
		});

		return found.docs.at(0)?.id;
	};

	const doc: DummyWriter["doc"] = async (collection, data, docOptions) => {
		const key = options.keyFor(collection);
		const record = data as Record<string, unknown>;
		const keyValue = record[key];

		if (isDummyRef(keyValue)) {
			fail(
				`${collection}: the natural key "${key}" carries a ref. The key is ` +
					"how a replay finds the document again, so it cannot be deferred.",
			);
		}

		if (keyValue === undefined || keyValue === null) {
			fail(
				`${collection}: a document has no "${key}", which is its natural ` +
					"key, so the seed could not find it again on a re-run.",
			);
		}

		const identifier = String(keyValue);
		const subject = `${collection} "${identifier}"`;
		const refs = collectRefs(data);

		await store.warm(refs);

		const applied = applyRefs(data, (ref) => store.get(ref));
		const locales = docOptions?.locales;

		/*
		 * Queued before the write, so a document whose required field was pruned
		 * still reports the ref that caused the failure.
		 */
		if (applied.unresolved.length > 0 && !deps.replaying()) {
			pending.push({
				collection,
				data,
				locales,
				seedId: deps.seedId(),
				identifier,
				refs: applied.unresolved,
			});
		}

		const published = options.collectionHasDrafts(collection)
			? { ...(applied.value as object), _status: "published" }
			: applied.value;
		let id: DummyDocumentId;
		let action: "created" | "updated";

		try {
			const existing = await findExisting(collection, key, keyValue);

			if (existing !== undefined) {
				await payload.update({
					collection,
					id: existing,
					data: published as never,
					draft: false,
					overrideAccess: true,
				});
				count(collection, "updated");
				id = existing;
				action = "updated";
			} else {
				const created = await payload.create({
					collection,
					data: published as never,
					draft: false,
					overrideAccess: true,
				});

				count(collection, "created");
				id = created.id;
				action = "created";
			}
		} catch (error) {
			const blamed = applied.unresolved.find((ref) =>
				errorPaths(error).some((it) => it.includes(ref.collection)),
			);
			const culprit = blamed ?? applied.unresolved[0];

			if (culprit && errorPaths(error).length > 0) {
				return decorate(
					subject,
					error,
					`${describeError(error)}. Its ref ${describeRef(culprit)} is not ` +
						`written yet, so the field was left out of this write. Either ` +
						`add dependsOn: ["${culprit.collection}"] to seed ` +
						`"${deps.seedId()}", or make the field optional.`,
				);
			}

			return decorate(subject, error);
		}

		/*
		 * Recorded before the locale passes, so a ref written later in the same
		 * seed resolves without a query.
		 */
		store.record(collection, identifier, id);
		reporter.wrote?.({
			kind: "collection",
			slug: collection,
			key: identifier,
			action: applied.unresolved.length > 0 ? "deferred" : action,
		});

		if (locales && Object.keys(locales).length > 0) {
			const appliedLocales = applyRefs(locales, (ref) => store.get(ref));

			try {
				await writeDocLocales(
					payload,
					{ collection, id, subject },
					appliedLocales.value,
				);
			} catch (error) {
				if (error instanceof DummyNamedError) {
					throw error;
				}

				return decorate(subject, error);
			}
		}

		return id;
	};

	const upload: DummyWriter["upload"] = async (
		collection,
		filePath,
		data = {},
	) => {
		if (!options.isUpload(collection)) {
			fail(
				`Collection "${collection}" has no upload config, so it cannot take ` +
					"a file. Use doc() instead.",
			);
		}

		const filename = path.basename(filePath);
		const subject = `${collection} "${filename}"`;
		/*
		 * Payload rewrites `filename` only on a collision, so matching it is
		 * correct for a stock upload collection and needs no configuration. A
		 * collection that rewrites filenames in a hook names its own field.
		 */
		const key = options.optionalKeyFor(collection) ?? "filename";

		try {
			const existing = await findExisting(collection, key, filename);

			if (existing !== undefined) {
				await payload.update({
					collection,
					id: existing,
					data: data as never,
					overrideAccess: true,
				});
				count(collection, "updated");
				store.record(collection, filename, existing);
				reporter.wrote?.({
					kind: "upload",
					slug: collection,
					key: filename,
					action: "updated",
				});

				return existing;
			}

			const created = await payload.create({
				collection,
				data: { ...(data as object), [key]: filename },
				filePath,
				overrideAccess: true,
			});
			const id = created.id;

			count(collection, "created");
			store.record(collection, filename, id);

			const stored = (created as { filename?: string }).filename;

			if (
				key === "filename" &&
				stored !== filename &&
				!warnedUploads.has(collection)
			) {
				warnedUploads.add(collection);
				reporter.warned?.({
					message:
						`uploads in "${collection}" are stored under a rewritten ` +
						`filename ("${String(stored)}" for "${filename}"), so ` +
						"re-running will create duplicates. Add an indexed text field " +
						"and name it in naturalKeys.",
				});
			}

			reporter.wrote?.({
				kind: "upload",
				slug: collection,
				key: filename,
				action: "created",
			});

			return id;
		} catch (error) {
			return decorate(subject, error);
		}
	};

	const global: DummyWriter["global"] = async (slug, data, globalOptions) => {
		const subject = `global "${slug}"`;
		const keepIfSet = globalOptions?.keepIfSet;

		try {
			if (keepIfSet !== undefined) {
				const current = (await payload.findGlobal({
					slug: slug as never,
					depth: 0,
					overrideAccess: true,
				})) as unknown as Record<string, unknown>;

				if (current[keepIfSet]) {
					count(slug, "skipped");
					reporter.wrote?.({
						kind: "global",
						slug,
						key: slug,
						action: "skipped",
					});

					return;
				}
			}

			const refs = collectRefs(data);

			await store.warm(refs);

			const applied = applyRefs(data, (ref) => store.get(ref));
			const published = options.globalHasDrafts(slug)
				? { ...(applied.value as object), _status: "published" }
				: applied.value;

			await payload.updateGlobal({
				slug: slug as never,
				data: published as never,
				draft: false,
				overrideAccess: true,
			});
			count(slug, "updated");
			reporter.wrote?.({
				kind: "global",
				slug,
				key: slug,
				action: "updated",
			});

			const locales = globalOptions?.locales;

			if (locales && Object.keys(locales).length > 0) {
				await store.warm(collectRefs(locales));

				const appliedLocales = applyRefs(locales, (ref) => store.get(ref));

				await writeGlobalLocales(
					payload,
					{ slug, subject },
					appliedLocales.value,
				);
			}
		} catch (error) {
			if (error instanceof DummyNamedError) {
				throw error;
			}

			return decorate(subject, error);
		}
	};

	const reset: DummyWriter["reset"] = async (collections) => {
		for (const collection of collections) {
			// eslint-disable-next-line no-await-in-loop -- the reset order is the caller's reverse dependency order
			const deleted = await payload.delete({
				collection,
				where: { id: { exists: true } },
				overrideAccess: true,
				/*
				 * Without this the operation skips trashed documents, and a fresh
				 * run would leave whatever an editor trashed behind. A no-op on
				 * every collection without `trash`.
				 */
				trash: true,
			});

			count(collection, "deleted", deleted.docs.length);
		}
	};

	return { doc, upload, global, reset };
};
