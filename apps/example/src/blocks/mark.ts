import { markBlock } from "@abinnovision/payloadcms-viewfinder";

import type { AppContext } from "../montage";
import type { BlockMarkerAttributes } from "@abinnovision/payloadcms-viewfinder";

/**
 * Addresses a block for viewfinder, spread onto the block's own root element.
 *
 * Imported from the package root rather than `/client`: `markBlock` is a pure
 * function, and the root entrypoint carries no `"use client"`, so a block
 * stays a server component.
 *
 * Two gates, both the app's own policy. Outside preview nothing is emitted, so
 * visitors get the same markup they would without viewfinder installed. An
 * unsaved row has no id, and an empty one would still match `[data-vf-id]` and
 * shadow the nearest real ancestor.
 */
export const mark = (
	block: { id?: string | null; blockType?: string },
	ctx: AppContext,
): Partial<BlockMarkerAttributes> =>
	ctx.isPreview && block.id ? markBlock(block.id, block.blockType) : {};
