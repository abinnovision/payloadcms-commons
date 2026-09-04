import config from "@payload-config";
import { draftMode } from "next/headers";
import { redirect } from "next/navigation";
import { getPayload } from "payload";

import type { NextRequest } from "next/server";

/**
 * Enables Next's draft mode for the live preview iframe, then hands off to
 * the real route.
 *
 * Gated on the Payload session that the admin already holds, so an
 * unauthenticated visitor cannot turn draft mode on for themselves and read
 * unpublished documents.
 */
export const GET = async (request: NextRequest): Promise<Response> => {
	const path = request.nextUrl.searchParams.get("path");
	if (path === null || !path.startsWith("/")) {
		return new Response("Invalid path", { status: 400 });
	}

	const payload = await getPayload({ config });
	const { user } = await payload.auth({ headers: request.headers });
	if (!user) {
		return new Response("Unauthorized", { status: 401 });
	}

	const draft = await draftMode();
	draft.enable();

	redirect(path);
};
