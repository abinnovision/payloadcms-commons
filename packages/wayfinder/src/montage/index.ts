import { createContextExtension } from "@abinnovision/payloadcms-montage";

import { loadMappings } from "../config/load-mappings.js";
import { createRouter } from "../runtime/create-router.js";

import type { LoadMappingsArgs } from "../config/load-mappings.js";
import type { LinkDeclaration } from "../pattern/define-links.js";
import type { PayloadCollectionMappingResolved } from "../pattern/types.js";
import type { CreateRouterArgs, Router } from "../runtime/create-router.js";
import type { MontageSlots } from "@abinnovision/payloadcms-montage";

/**
 * The slot the bound router rides in.
 *
 * Prefixed with the package name because extension names share one namespace
 * across every library using montage.
 */
export const wayfinderExtension =
	createContextExtension<Router>("wayfinder:router");

/**
 * What `initWayfinder` needs: a router's settings, plus where the mappings
 * come from.
 *
 * Either hand over mappings already in hand, or the instance to read them
 * from. A route that resolved a path has them already, and reading the global
 * a second time to render the same page is a query for nothing.
 */
export type InitWayfinderArgs<
	TDeclaration extends LinkDeclaration = LinkDeclaration,
> = Omit<CreateRouterArgs<TDeclaration>, "mappings"> &
	(
		| { mappings: PayloadCollectionMappingResolved[] }
		| { load: Omit<LoadMappingsArgs, "localized"> & { localized?: boolean } }
	);

/**
 * Builds the router once and parks it on the render context.
 *
 * Blocks resolve links individually and there may be dozens on a page, so the
 * mappings are read once per request rather than once per link — and the
 * locale and href formatter travel with them, which is what stops a block
 * resolving a link into the wrong locale or out of preview.
 *
 * @param ctx The render context.
 * @param args The router's settings, and the mappings or where to read them.
 */
export const initWayfinder = async <
	TDeclaration extends LinkDeclaration = LinkDeclaration,
>(
	ctx: MontageSlots,
	args: InitWayfinderArgs<TDeclaration>,
): Promise<void> => {
	const mappings =
		"mappings" in args ? args.mappings : await loadMappings(args.load);

	wayfinderExtension.set(ctx, createRouter({ ...args, mappings }));
};

/**
 * Reads the router off the render context.
 *
 * Named for what it does — the router is already built, and this is a slot
 * read rather than a load. Throws when {@link initWayfinder} has not run,
 * because a block rendering links without a locale would silently produce the
 * wrong ones, and a blank page is easier to explain than a page of quietly
 * mislocalised links.
 *
 * @param ctx The render context.
 */
export const wayfinderFrom = <
	TDeclaration extends LinkDeclaration = LinkDeclaration,
>(
	ctx: MontageSlots,
): Router<TDeclaration> => {
	const router = wayfinderExtension.get(ctx);

	if (!router) {
		throw new Error(
			"[wayfinder] No router on the render context. Call `initWayfinder(ctx, ...)` in the route before rendering blocks.",
		);
	}

	return router;
};
