import { resolveLink } from "@abinnovision/payloadcms-wayfinder";
import { resolveLinkNode } from "@abinnovision/payloadcms-wayfinder/lexical";
import { getMappings } from "@abinnovision/payloadcms-wayfinder/montage";

import { links } from "../links";

import type { AppContext } from "../montage";
import type { BlockContext } from "@abinnovision/payloadcms-montage";
import type { LinkDataOf } from "@abinnovision/payloadcms-wayfinder";
import type { ReactNode } from "react";

/**
 * A rich-text link node's `fields`.
 *
 * `resolveLinkNode` types a reference id as a string. SQLite numbers them, and
 * the resolver stringifies whatever it gets, so what Lexical hands over is
 * wider than the type and callers cast into this.
 */
type LinkNodeFields = Parameters<typeof resolveLinkNode>[0]["fields"];

/** The two shapes an authored link arrives in, and the only two. */
type LinkSource =
	{ link: LinkDataOf<typeof links> | undefined } | { node: LinkNodeFields };

type AppLinkProps = {
	ctx: BlockContext<AppContext>;
	children?: ReactNode;
} & LinkSource;

/**
 * The one place this app turns an authored link into an anchor.
 *
 * Wayfinder ships no link component on purpose: `resolveLink` is synchronous
 * and touches nothing, so where the mappings come from is a decision about the
 * app. This app's answer is the render context — `initWayfinder` parked them
 * there once for the request, so nothing has to thread them down a tree. The
 * version in `packages/wayfinder/docs/recipes.md` takes them as a prop instead,
 * because it does not assume montage.
 *
 * Taking the whole context rather than the pieces is what keeps `formatHref`
 * from being forgotten. `resolveLink` calls `buildHref` internally, so a link
 * resolved without it leaves the locale — and, on a site whose preview lives
 * behind a prefix, preview — that it was rendered in.
 *
 * Rendering falls back to the label when a link resolves to nothing, rather
 * than to a dead anchor, so a target that was deleted or unpublished degrades
 * to plain text.
 */
export const AppLink = ({ ctx, children, ...source }: AppLinkProps) => {
	const shared = {
		links,
		mappings: getMappings(ctx),
		locale: ctx.locale,
		formatHref: ctx.formatHref,
		context: { filesBase: "/files" },
	};

	/*
	 * A rich-text link is the same link in a different envelope, so it takes
	 * the same route rather than a second component. `resolveLinkNode` unwraps
	 * the node's `fields` and hands off to `resolveLink`.
	 */
	const resolved =
		"node" in source
			? resolveLinkNode({ fields: source.node, ...shared })
			: resolveLink({ link: source.link, ...shared });

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

export type { LinkNodeFields };
