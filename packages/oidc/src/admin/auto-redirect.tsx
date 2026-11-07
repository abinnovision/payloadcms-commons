"use client";

import { useEffect } from "react";

/**
 * Leaves for the provider with a full page navigation. A server redirect
 * would be fetched by the admin's client-side router instead whenever it
 * navigates to the login page, which cannot follow a redirect to another
 * origin and only falls back to a full navigation after a failed request.
 */
export const OidcAutoRedirect = ({ href }: { href: string }): null => {
	useEffect(() => {
		window.location.replace(href);
	}, [href]);

	return null;
};
