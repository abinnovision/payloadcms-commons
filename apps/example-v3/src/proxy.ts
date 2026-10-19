import { NextResponse } from "next/server";

import type { NextRequest } from "next/server";

/** Where the layout reads the request path back from. */
export const PATHNAME_HEADER = "x-wayfinder-pathname";

/**
 * Puts the request path on a header the root layout can read.
 *
 * The layout owns `<html lang>`, and the locale is a function of the path —
 * but a layout is not given the params of the segments below it, and this
 * app's locale is an optional prefix inside a catch-all rather than a route
 * segment of its own. A header is the supported way to get the one value
 * across, and it works for the not-found path too, where no page runs at all.
 */
export const proxy = (request: NextRequest): NextResponse => {
	const headers = new Headers(request.headers);

	headers.set(PATHNAME_HEADER, request.nextUrl.pathname);

	return NextResponse.next({ request: { headers } });
};

export const config = {
	/*
	 * Only the site. The admin panel and the API bring their own document, and
	 * static assets need no locale.
	 */
	matcher: ["/((?!admin|api|_next|favicon.ico).*)"],
};
