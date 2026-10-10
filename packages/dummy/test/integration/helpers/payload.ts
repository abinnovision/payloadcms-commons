import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { getPayload } from "payload";

import { buildFixtureConfig } from "../../fixtures/config.js";

import type { CollectionConfig, Payload, SanitizedConfig } from "payload";

/**
 * A valid one-pixel PNG.
 *
 * Real bytes, so Payload's upload pipeline can read the file. The fixture
 * upload collection declares no `imageSizes`, so no image processor is needed
 * and `sharp` stays out of this package.
 */
export const PIXEL =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AARAAD/wH+BQAAAABJRU5ErkJggg==";

const scratch: string[] = [];

/** Writes {@link PIXEL} to a throwaway directory and answers its path. */
export const writePixelFile = (name = "pixel.png"): string => {
	const dir = mkdtempSync(path.join(tmpdir(), "payloadcms-dummy-"));

	scratch.push(dir);

	const file = path.join(dir, name);

	writeFileSync(file, Buffer.from(PIXEL, "base64"));

	return file;
};

/** Removes every directory {@link writePixelFile} made. */
export const cleanScratch = (): void => {
	for (const dir of scratch.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
};

export interface Booted {
	config: SanitizedConfig;
	payload: Payload;
}

/**
 * Boots Payload on an in-memory database.
 *
 * `getPayload` caches by `key`, so a spec that boots a different config must
 * pass its own or it silently reuses another spec's instance.
 *
 * @param args A cache key, and any extra collections the spec needs.
 */
export const bootPayload = async (args: {
	key: string;
	collections?: CollectionConfig[];
}): Promise<Booted> => {
	const config = await buildFixtureConfig(
		args.collections === undefined ? {} : { collections: args.collections },
	);
	const payload = await getPayload({ config, key: args.key });

	return { config, payload };
};

/**
 * Every document and global, for comparing one run against the next.
 *
 * `locale: "all"` so a localized field's other locales are part of the
 * comparison, and depth 0 so a relationship reads as the id it stores.
 */
export const storedState = async (
	payload: Payload,
	args: { collections: string[]; globals?: string[] },
): Promise<Record<string, unknown>> => {
	const state: Record<string, unknown> = {};

	for (const collection of args.collections) {
		// eslint-disable-next-line no-await-in-loop -- a snapshot reads each collection in turn
		const found = await payload.find({
			collection: collection as never,
			depth: 0,
			limit: 0,
			pagination: false,
			locale: "all",
			overrideAccess: true,
			sort: "id",
		});

		state[collection] = found.docs.map((doc) => {
			const { updatedAt, createdAt, ...rest } = doc as Record<string, unknown>;

			void updatedAt;
			void createdAt;

			return rest;
		});
	}

	for (const global of args.globals ?? []) {
		// eslint-disable-next-line no-await-in-loop -- a snapshot reads each global in turn
		const found = (await payload.findGlobal({
			slug: global as never,
			depth: 0,
			locale: "all",
			overrideAccess: true,
		})) as Record<string, unknown>;
		const { updatedAt, createdAt, ...rest } = found;

		void updatedAt;
		void createdAt;
		state[`global:${global}`] = rest;
	}

	return state;
};

/** Collects the reporter events a run produced, for asserting on outcomes. */
export const recorder = (): {
	reporter: {
		wrote: (event: unknown) => void;
		warned: (event: unknown) => void;
	};
	events: unknown[];
	warnings: string[];
} => {
	const events: unknown[] = [];
	const warnings: string[] = [];

	return {
		reporter: {
			wrote: (event) => events.push(event),
			warned: (event) => warnings.push((event as { message: string }).message),
		},
		events,
		warnings,
	};
};
