import { buildHref } from "@abinnovision/payloadcms-wayfinder";
import config from "@payload-config";
import { draftMode } from "next/headers";
import { redirect } from "next/navigation";
import { getPayload } from "payload";

import { createFormatHref } from "../../../locales";
import { getMappings } from "../../../wayfinder";

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

	const href = buildHref({
		mappings: await getMappings(),
		collection,
		document: document,
		locale,
		// Without it the redirect would drop the locale prefix and the
		// catch-all would resolve the document in the default locale instead.
		formatHref: createFormatHref(),
	});

	if (!href) {
		return new Response("No mapping for this collection", { status: 404 });
	}

	const draft = await draftMode();
	draft.enable();

	redirect(href);
};
