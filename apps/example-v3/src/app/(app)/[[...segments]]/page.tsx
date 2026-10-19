import { createBlockContext } from "@abinnovision/payloadcms-montage";
import { createRouter } from "@abinnovision/payloadcms-wayfinder";
import { initWayfinder } from "@abinnovision/payloadcms-wayfinder/montage";
import config from "@payload-config";
import { draftMode } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getPayload } from "payload";
import { cache } from "react";

import { blocks } from "../../../blocks/registry";
import { LOCALES, splitLocale } from "../../../locales";
import { createRenderer } from "../../../montage";
import { routerArgs } from "../../../wayfinder";

import type { Config } from "../../../payload-types";
import type { Metadata } from "next";

interface Params {
	params: Promise<{ segments?: string[] }>;
}

interface LayoutBlock {
	id?: string | null;
	blockType: string;
}

const renderer = createRenderer(blocks);

/**
 * Resolves a request path to the document behind it.
 *
 * Memoised for the request because Next calls `generateMetadata` and the page
 * itself separately, and both need the same document. Without this the page
 * would be looked up twice — and so, through `routerArgs`, would the mapping.
 *
 * Keyed on the joined path rather than on the segments array: `cache` compares
 * arguments by identity, and the two callers each await `params` for
 * themselves, so two equal arrays would miss.
 */
const resolveRequest = cache(async (joined: string) => {
	const { locale, path } = splitLocale(joined === "" ? [] : joined.split("/"));
	const { isEnabled: isPreview } = await draftMode();

	const payload = await getPayload({ config });
	const args = await routerArgs(locale);

	const resolved = await createRouter(args).resolve<Config["collections"]>(
		path,
		{
			payload,
			/*
			 * Drafts are reachable only in preview. The published-only
			 * condition that implies is applied by the package, and only on
			 * collections that keep drafts — writing it here instead would
			 * break `sections`, which has no versions and therefore no
			 * `_status` column to filter on.
			 */
			draft: isPreview,
		},
	);

	return { resolved, locale, isPreview, args };
});

/**
 * The canonical URL and its translations, both built from the mapping the
 * route just matched. A pattern edited in the admin panel moves the canonical
 * tag with it, rather than leaving a second copy of the URL shape here.
 */
export const generateMetadata = async ({
	params,
}: Params): Promise<Metadata> => {
	const { segments } = await params;
	const { resolved, args } = await resolveRequest((segments ?? []).join("/"));

	if (!resolved) {
		return {};
	}

	const { collection, document } = resolved;
	const title = "title" in document ? document.title : undefined;

	const languages: Record<string, string> = {};

	for (const it of LOCALES) {
		const href = createRouter(await routerArgs(it)).href(collection, document);

		if (href) {
			languages[it] = href;
		}
	}

	return {
		...(title ? { title } : {}),
		alternates: {
			canonical: createRouter(args).href(collection, document),
			languages,
		},
	};
};

/**
 * One route for every collection.
 *
 * Nothing here names a collection or a URL shape. Both come from the mapping
 * global, so adding a page type to the site is an edit in the admin panel
 * rather than a new route file. The two things the route does own are the
 * locale prefix, which no pattern can express for the site root, and how to
 * render a `layout` — the one field the routed collections agree on.
 */
const Page = async ({ params }: Params) => {
	const { segments } = await params;
	const { resolved, locale, isPreview, args } = await resolveRequest(
		(segments ?? []).join("/"),
	);

	if (!resolved) {
		notFound();
	}

	const { collection, document } = resolved;

	/*
	 * Narrowed by the collection the mapping chose, so these read off the
	 * generated types rather than off an open record.
	 */
	const title = "title" in document ? document.title : "";
	const layout =
		"layout" in document && Array.isArray(document.layout)
			? (document.layout as LayoutBlock[])
			: [];

	const ctx = createBlockContext({ Link, isPreview, locale });

	/*
	 * Parks a router on the render context, built from the mappings this
	 * request already read. The dozens of links a page may hold then share one
	 * read, one locale and one href formatter, rather than each being handed
	 * the pieces and one of them being handed the wrong ones.
	 */
	await initWayfinder(ctx, args);

	await renderer.resolveBlockData({ root: { layout }, ctx });

	return (
		<main style={{ padding: "2rem" }}>
			<p style={{ color: "#666" }}>
				{collection} · {locale}
			</p>
			<h1>{title}</h1>
			{layout.map((block) => (
				<renderer.Block key={block.id} block={block} ctx={ctx} />
			))}
		</main>
	);
};

export default Page;
