import {
	buildHref,
	resolveLink,
	resolvePathToDocument,
} from "@abinnovision/payloadcms-wayfinder";
import config from "@payload-config";
import { draftMode } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getPayload } from "payload";

import { links } from "../../../links";
import { getMappings } from "../../../wayfinder";

import type { LinkDataOf } from "@abinnovision/payloadcms-wayfinder";

interface Params {
	params: Promise<{ segments?: string[] }>;
}

/**
 * One route for every collection.
 *
 * Nothing here names a collection or a URL shape. Both come from the mapping
 * global, so adding a collection to the site is an edit in the admin panel
 * rather than a new route file.
 */
const Page = async ({ params }: Params) => {
	const { segments } = await params;
	const path = `/${(segments ?? []).join("/")}`;
	const { isEnabled: isPreview } = await draftMode();

	const payload = await getPayload({ config });
	const mappings = await getMappings();

	const resolved = await resolvePathToDocument({
		payload,
		mappings,
		path,
		// No localization in this app, so any locale key resolves the one bucket.
		locale: "default",
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
	const raw = document["title"];
	const title = typeof raw === "string" ? raw : "";
	const body = document["body"];
	const link = document["link"] as LinkDataOf<typeof links> | undefined;

	/*
	 * The same declaration the field was built from, so a variant cannot exist
	 * in the admin panel and resolve to nothing here.
	 */
	const authored = resolveLink({
		link,
		mappings,
		locale: "default",
		links,
		context: { filesBase: "/files" },
	});

	/*
	 * Round-tripping the document back through the mapping shows the two
	 * directions agreeing: this is the path the catch-all just matched.
	 */
	const canonical = buildHref({
		mappings,
		collection,
		document,
		locale: "default",
	});

	return (
		<main style={{ fontFamily: "system-ui, sans-serif", padding: "2rem" }}>
			<p style={{ color: "#666" }}>
				{collection} · {canonical}
			</p>
			<h1>{title}</h1>
			{typeof body === "string" ? <p>{body}</p> : null}
			{authored ? (
				<p>
					<Link href={authored.href} target={authored.target}>
						{link?.label ?? authored.href}
					</Link>
				</p>
			) : null}
		</main>
	);
};

export default Page;
