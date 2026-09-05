"use client";

import { RefreshRouteOnSave as PayloadRefreshRouteOnSave } from "@payloadcms/live-preview-react";
import { useRouter } from "next/navigation";

import type { ReactNode } from "react";

/**
 * The "live" half of live preview: the admin posts an update, this asks Next
 * to re-render the route on the server, and the page comes back with fresh
 * data. Viewfinder's addressing is unaffected either way — it only needs the
 * page in an iframe — but re-rendering server-side is what keeps montage's
 * resolvers working.
 */
export const RefreshOnSave = ({
	serverURL,
}: {
	serverURL: string;
}): ReactNode => {
	const router = useRouter();

	return (
		<PayloadRefreshRouteOnSave
			refresh={() => {
				router.refresh();
			}}
			serverURL={serverURL}
		/>
	);
};
