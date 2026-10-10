import { fail } from "./errors.js";
import { createIndexStore, describeUnresolved } from "./index-store.js";
import { normalizeOptions } from "./options.js";
import { dummyPolyRef, dummyRef } from "./ref.js";
import { createWriter } from "./writer.js";

import type {
	DummyContext,
	DummyRunOptions,
	DummyRunResult,
	DummyWriteTally,
} from "./types.js";
import type { PendingWrite } from "./writer.js";

/**
 * Runs every seed in dependency order, then replays the documents whose refs
 * pointed forward.
 *
 * One replay pass is always enough: every queued document already exists, and a
 * prune never removes a natural key, so by the end of the seed loop every key a
 * ref could name is in the index.
 *
 * Throws on the first failure, so a partly written run is visible rather than
 * reported as success.
 *
 * @param options The instance, the seeds and the run's settings.
 */
export const runDummySeeds = async (
	options: DummyRunOptions,
): Promise<DummyRunResult> => {
	const startedAt = Date.now();
	const normalized = normalizeOptions(options);
	const { payload, reporter, seeds } = normalized;
	const tally = new Map<string, DummyWriteTally>();
	const pending: PendingWrite[] = [];
	const store = createIndexStore(payload, normalized.keyFor);
	let seedId = "";
	let replaying = false;

	const writer = createWriter({
		options: normalized,
		store,
		tally,
		pending,
		seedId: () => seedId,
		replaying: () => replaying,
	});

	const ctx: DummyContext = {
		doc: (collection, data, docOptions) =>
			writer.doc(collection, data, {
				locales: docOptions?.locales as Record<string, unknown> | undefined,
			}),
		upload: (collection, filePath, data) =>
			writer.upload(collection, filePath, data),
		global: (slug, data, globalOptions) =>
			writer.global(slug, data, {
				keepIfSet: globalOptions?.keepIfSet,
				locales: globalOptions?.locales as Record<string, unknown> | undefined,
			}),
		ref: dummyRef,
		polyRef: dummyPolyRef,
		payload,
	};

	reporter.runStarted?.({
		seeds: seeds.map((seed) => seed.id),
		fresh: normalized.fresh,
	});

	if (normalized.fresh && normalized.resetCollections.length > 0) {
		await writer.reset(normalized.resetCollections);
		reporter.reset?.({ collections: [...normalized.resetCollections] });
	}

	for (const seed of seeds) {
		const seedStartedAt = Date.now();

		seedId = seed.id;
		// eslint-disable-next-line no-await-in-loop -- seeds run in dependency order, so one at a time
		await seed.run(ctx);
		reporter.seedFinished?.({
			id: seed.id,
			durationMs: Date.now() - seedStartedAt,
		});
	}

	replaying = true;

	for (const entry of pending) {
		seedId = entry.seedId;
		// eslint-disable-next-line no-await-in-loop -- the replay writes in the order the seeds queued
		await writer.doc(entry.collection, entry.data, {
			locales: entry.locales,
		});
	}

	/*
	 * Checked after the replay rather than during it: a ref unresolved now is
	 * genuinely unsatisfiable, and the message is worth more than an early exit.
	 */
	const stranded = pending.flatMap((entry) =>
		entry.refs
			.filter((ref) => store.get(ref) === undefined)
			.map((ref) => ({ entry, ref })),
	);

	if (stranded.length > 0) {
		const lines = stranded.map(
			({ entry, ref }) =>
				`  ${entry.collection} "${entry.identifier}" ` +
				`(seed "${entry.seedId}") -> ${describeUnresolved(ref, store)}`,
		);

		fail(
			`${String(stranded.length)} refs never resolved:\n${lines.join("\n")}`,
		);
	}

	const result: DummyRunResult = {
		durationMs: Date.now() - startedAt,
		seeds: seeds.map((seed) => seed.id),
		writes: tally,
		replayed: pending.length,
	};

	reporter.runFinished?.(result);

	return result;
};
