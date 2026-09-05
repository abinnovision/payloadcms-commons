import { createBlockContext } from "@abinnovision/payloadcms-montage";
import {
	buildHref,
	resolvePathToDocument,
} from "@abinnovision/payloadcms-wayfinder";
import { initWayfinder } from "@abinnovision/payloadcms-wayfinder/montage";
import config from "@payload-config";
import { draftMode } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getPayload } from "payload";

import { blocks } from "../../../blocks/registry";
import { createFormatHref, splitLocale } from "../../../locales";
import { createRenderer } from "../../../montage";
import { WAYFINDER_OPTIONS, getMappings } from "../../../wayfinder";

interface Params {
	params: Promise<{ segments?: string[] }>;
}

interface LayoutBlock {
	id?: string | null;
	blockType: string;
}

const renderer = createRenderer(blocks);

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
	const { locale, path } = splitLocale(segments ?? []);
	const { isEnabled: isPreview } = await draftMode();

	const payload = await getPayload({ config });
	const mappings = await getMappings();
	const formatHref = createFormatHref();

	const resolved = await resolvePathToDocument({
		payload,
		mappings,
		path,
		locale,
		/*
		 * Drafts are reachable only in preview. The published-only condition
		 * that implies is applied by the package, and only on collections that
		 * keep drafts — writing it here instead would break `sections`, which
		 * has no versions and therefore no `_status` column to filter on.
		 */
		draft: isPreview,
	});

	if (!resolved) {
		notFound();
	}

	const { collection, document } = resolved;

	/*
	 * The resolved document is an open record: which collection it came from
	 * is decided by the mapping at request time, so its fields are read
	 * defensively rather than through a generated type.
	 */
	const title = typeof document["title"] === "string" ? document["title"] : "";
	const layout = Array.isArray(document["layout"])
		? (document["layout"] as LayoutBlock[])
		: [];

	const ctx = createBlockContext({ Link, isPreview, locale, formatHref });

	/*
	 * Parks the compiled mappings on the render context once, so the dozens of
	 * links a page may hold share one read instead of one read each.
	 */
	await initWayfinder(ctx, { payload, ...WAYFINDER_OPTIONS });

	const root = { blockType: `${collection}-root`, id: document.id, layout };

	await renderer.resolveBlockData({ root, ctx });

	/*
	 * Round-tripping the document back through the mapping shows the two
	 * directions agreeing: this is the path the catch-all just matched.
	 */
	const canonical = buildHref({
		mappings,
		collection,
		document,
		locale,
		formatHref,
	});

	return (
		<main style={{ fontFamily: "system-ui, sans-serif", padding: "2rem" }}>
			<p style={{ color: "#666" }}>
				{collection} · {locale} · {canonical}
			</p>
			<h1>{title}</h1>
			{layout.map((block) => (
				<renderer.Block key={block.id} block={block} ctx={ctx} />
			))}
		</main>
	);
};

export default Page;
