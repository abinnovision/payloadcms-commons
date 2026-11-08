import type { ChatContext } from "../protocol/context.js";

/** The part of the chat context the admin path decides. */
export type RouteContext = Pick<
	ChatContext,
	"collection" | "global" | "id" | "route"
>;

/**
 * What an admin path shows: the collection of a list or create view, the
 * collection and id of an edit view, or the global. `adminRoute` is
 * `config.routes.admin`; a path outside it carries only `route`.
 */
export const contextFromPath = (
	pathname: string,
	adminRoute: string,
): RouteContext => {
	const base = adminRoute.replace(/\/+$/, "");

	if (pathname !== base && !pathname.startsWith(`${base}/`)) {
		return { route: pathname };
	}

	const [section, slug, third, fourth] = pathname
		.slice(base.length)
		.split("/")
		.filter(Boolean);

	if (slug === undefined) {
		return { route: pathname };
	}

	if (section === "globals") {
		return { route: pathname, global: slug };
	}

	if (section !== "collections") {
		return { route: pathname };
	}

	// A trashed document's view sits one segment deeper.
	const id =
		third === "trash" ? fourth : third === "create" ? undefined : third;

	return id === undefined
		? { route: pathname, collection: slug }
		: { route: pathname, collection: slug, id };
};
