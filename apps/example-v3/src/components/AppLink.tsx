import { wayfinderFrom } from "@abinnovision/payloadcms-wayfinder/montage";

import type { links } from "../links";
import type { AppContext } from "../montage";
import type { BlockContext } from "@abinnovision/payloadcms-montage";
import type { LinkDataOf } from "@abinnovision/payloadcms-wayfinder";
import type { ReactNode } from "react";

/** The two shapes an authored link arrives in, and the only two. */
type LinkSource =
	{ link: LinkDataOf<typeof links> | undefined } | { node: unknown };

type AppLinkProps = {
	ctx: BlockContext<AppContext>;
	children?: ReactNode;
} & LinkSource;

/**
 * The one place this app turns an authored link into an anchor.
 *
 * Wayfinder ships no link component on purpose: resolving a link is
 * synchronous and touches nothing, so where the router comes from is a
 * decision about the app. This app's answer is the render context —
 * `initWayfinder` built one there for the request, with the mappings, the
 * locale and the href formatter already bound, so nothing has to thread them
 * down a tree and no block component imports wayfinder at all.
 *
 * Rendering falls back to the label when a link resolves to nothing, rather
 * than to a dead anchor, so a target that was deleted or unpublished degrades
 * to plain text.
 */
export const AppLink = ({ ctx, children, ...source }: AppLinkProps) => {
	const wayfinder = wayfinderFrom<typeof links>(ctx);

	/*
	 * A rich-text link is the same link in a different envelope, so it takes
	 * the same route rather than a second component: `linkNode` unwraps the
	 * node's fields and hands off to the same resolution.
	 */
	const resolved =
		"node" in source
			? wayfinder.linkNode(source.node)
			: wayfinder.link(source.link);

	const label = "node" in source ? undefined : source.link?.label;

	if (!resolved) {
		return <>{children ?? label}</>;
	}

	return (
		<ctx.Link href={resolved.href}>
			{children ?? label ?? resolved.href}
		</ctx.Link>
	);
};
