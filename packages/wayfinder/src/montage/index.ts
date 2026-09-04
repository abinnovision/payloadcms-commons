import { createContextExtension } from "@abinnovision/payloadcms-montage";

import { loadMappings } from "../config/load-mappings.js";

import type { LoadMappingsArgs } from "../config/load-mappings.js";
import type { PayloadCollectionMappingResolved } from "../pattern/types.js";
import type { MontageSlots } from "@abinnovision/payloadcms-montage";

/**
 * The slot the compiled mappings ride in.
 *
 * Prefixed with the package name because extension names share one namespace
 * across every library using montage.
 */
export const wayfinderExtension =
	createContextExtension<PayloadCollectionMappingResolved[]>(
		"wayfinder:mappings",
	);

/**
 * Loads the mappings once and parks them on the render context.
 *
 * Blocks resolve links individually and there may be dozens on a page, so the
 * read happens once per request rather than once per link.
 *
 * @param ctx The render context.
 * @param args The Payload instance and mapping-global settings.
 */
export const initWayfinder = async (
	ctx: MontageSlots,
	args: LoadMappingsArgs,
): Promise<void> => {
	wayfinderExtension.set(ctx, await loadMappings(args));
};

/**
 * Reads the mappings off the render context.
 *
 * Returns an empty list when {@link initWayfinder} has not run, so a block
 * rendered outside a request renders without links rather than throwing.
 *
 * @param ctx The render context.
 */
export const getMappings = (
	ctx: MontageSlots,
): PayloadCollectionMappingResolved[] => wayfinderExtension.get(ctx) ?? [];
