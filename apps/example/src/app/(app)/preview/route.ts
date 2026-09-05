import { createRouter } from "@abinnovision/payloadcms-wayfinder";
import config from "@payload-config";
import { draftMode } from "next/headers";
import { redirect } from "next/navigation";
import { getPayload } from "payload";

import { routerArgs } from "../../../wayfinder";

import type { NextRequest } from "next/server";
import type { CollectionSlug, TypedLocale } from "payload";

/**
 * Enables Next's draft mode for the live preview iframe, then hands off to
 * the real route.
 *
 * Gated on the Payload session that the admin already holds, so an
 * unauthenticated visitor cannot turn draft mode on for themselves and read
 * unpublished documents.
 *
 * The target is computed from the mapping rather than passed in, so the
 * collection's `livePreview.url` does not have to repeat a URL shape the
 * editor already authored. Editing a pattern moves preview with it.
 */
export const GET = async (request: NextRequest): Promise<Response> => {
	const params = request.nextUrl.searchParams;
	const collection = params.get("collection");
	const id = params.get("id");
	// Written by `livePreview.url`, which Payload only ever hands a real locale.
	const locale = (params.get("locale") ?? "en") as TypedLocale;

	if (!collection || !id) {
		return new Response("Missing collection or id", { status: 400 });
	}

	const payload = await getPayload({ config });
	const { user } = await payload.auth({ headers: request.headers });

	if (!user) {
		return new Response("Unauthorized", { status: 401 });
	}

	const document = await payload.findByID({
		collection: collection as CollectionSlug,
		id,
		locale,
		/*
		 * One level, so a relationship a pattern takes a parameter from arrives
		 * populated. `buildHref` reads the related document's identifier, and a
		 * bare id would build nothing. `defaultPopulate` on the related
		 * collection keeps that read to the fields the pattern needs.
		 */
		depth: 1,
		draft: true,
		overrideAccess: false,
		user,
	});

	/*
	 * The router carries the locale and the href formatter, so the redirect
	 * cannot drop the prefix and land the editor on the default-locale copy of
	 * the document they were previewing.
	 */
	const href = createRouter(await routerArgs(locale)).href(
		collection,
		document,
	);

	if (!href) {
		return new Response("No mapping for this collection", { status: 404 });
	}

	/*
	 * A pattern is authored content and a slug is an editable field, so the
	 * built path is not automatically a same-origin one: a slug beginning
	 * `//` compiles into a protocol-relative URL that Next would treat as
	 * external. Only a single-slash path is worth redirecting to.
	 */
	if (!href.startsWith("/") || href.startsWith("//")) {
		return new Response("Refusing to redirect off-site", { status: 400 });
	}

	const draft = await draftMode();
	draft.enable();

	redirect(href);
};
