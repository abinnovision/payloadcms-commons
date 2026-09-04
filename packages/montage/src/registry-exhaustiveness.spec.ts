import { describe, expect, it } from "vitest";

/* Ambient `GeneratedTypes` augmentation; see create-montage.spec.ts. */
import "../test/fixtures/blocks.js";
import { HeroModule } from "../test/fixtures/components/HeroModule.js";
import { LocationFactsModule } from "../test/fixtures/components/LocationFactsModule.js";

import type { Block } from "payload";

/**
 * Compile-time fixtures for the "Checking the config against the registry"
 * recipe in docs/recipes.md. Every `@ts-expect-error` below is load-bearing:
 * removing one and re-running `tsc --noEmit` must reintroduce the error it
 * silences.
 */

/** Fails to compile unless `T` is `never`. */
type Assert<T extends never> = T;

/*
 * Config side. `as const satisfies Block` keeps the literal slug while still
 * checking the shape.
 */
const heroBlock = { slug: "hero-module", fields: [] } as const satisfies Block;
const factsBlock = {
	slug: "location-facts-module",
	fields: [],
} as const satisfies Block;

const montageBlocks = [heroBlock, factsBlock];
export type RegisteredSlug = (typeof montageBlocks)[number]["slug"];

/* Render side. Kept as its own binding, since the registry itself is opaque. */
const entries = {
	"hero-module": HeroModule,
	"location-facts-module": LocationFactsModule,
};

export type MissingComponent = Exclude<RegisteredSlug, keyof typeof entries>;
export type OrphanComponent = Exclude<keyof typeof entries, RegisteredSlug>;

export type NoMissingComponent = Assert<MissingComponent>;
export type NoOrphanComponent = Assert<OrphanComponent>;

/* A config block with no component must be caught. */
const _incompleteEntries = { "hero-module": HeroModule };
type Missing = Exclude<RegisteredSlug, keyof typeof _incompleteEntries>;
export type DetectsMissingComponent = Assert<
	// @ts-expect-error -- "location-facts-module" has no component
	Missing
>;

/* A component whose slug is in no config block must be caught too. */
type ComponentSlugsWithExtra = keyof typeof entries | "not-registered";
type Orphan = Exclude<ComponentSlugsWithExtra, RegisteredSlug>;
export type DetectsOrphanComponent = Assert<
	// @ts-expect-error -- "not-registered" is not registered in config.blocks
	Orphan
>;

/* A `: Block` annotation widens `slug` to `string` and breaks the derivation. */
const annotatedBlock: Block = { slug: "hero-module", fields: [] };
export type WidenedSlug = (typeof annotatedBlock)["slug"];
// @ts-expect-error -- widened to `string`, so the literal no longer holds
export const widenedIsNotLiteral: "hero-module" = annotatedBlock.slug;

describe("config-to-registry exhaustiveness", () => {
	it("derives the registered slug union from the block configs", () => {
		expect(montageBlocks.map((b) => b.slug)).toEqual([
			"hero-module",
			"location-facts-module",
		]);
	});

	it("keeps the registry keys and the config slugs in step", () => {
		expect(Object.keys(entries).sort()).toEqual(
			montageBlocks.map((b) => b.slug).sort(),
		);
	});
});
