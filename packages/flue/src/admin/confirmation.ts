import { isRecord } from "../protocol/guards.js";

/** A call waiting for the user's approval, as an mcpx tool result names it. */
export interface PendingConfirmation {
	/** The confirmation id the agent passes to `runConfirmed`. */
	id: string;
	/** The id of the API key whose user decides, from the confirmation URL. */
	key: string;
	/** The key's edit view, where the user can decide as well. */
	review: string;
}

/**
 * The admin path a confirmation URL links to, or undefined unless it leads
 * into `adminRoute`'s collections. Only path and query are kept, so the
 * link stays on the admin's origin; `origin` resolves a relative URL.
 */
export const reviewPath = (
	url: string,
	origin: string,
	adminRoute: string,
): string | undefined => {
	if (!URL.canParse(url, origin)) {
		return undefined;
	}

	const { pathname, search } = new URL(url, origin);

	return pathname.startsWith(`${adminRoute.replace(/\/+$/, "")}/collections/`)
		? `${pathname}${search}`
		: undefined;
};

const parsed = (value: unknown): unknown => {
	if (typeof value !== "string") {
		return value;
	}

	try {
		return JSON.parse(value) as unknown;
	} catch {
		return undefined;
	}
};

/*
 * mcpx answers a confirmable call with `{ confirmation: { id, url } }` as the
 * text of an MCP result, which may reach the conversation as the result, its
 * text or the parsed object.
 */
const confirmationField = (
	result: unknown,
): Record<string, unknown> | undefined => {
	const content =
		isRecord(result) && Array.isArray(result["content"])
			? result["content"].map((entry) =>
					isRecord(entry) ? entry["text"] : undefined,
				)
			: [];

	for (const candidate of [result, ...content].map(parsed)) {
		const confirmation = isRecord(candidate)
			? candidate["confirmation"]
			: undefined;

		if (isRecord(confirmation) && typeof confirmation["url"] === "string") {
			return confirmation;
		}
	}

	return undefined;
};

/**
 * The confirmation a tool result asks for, or undefined when there is none
 * or its URL does not lead into the admin's collections. The URL is
 * unchecked model-visible data, so only its admin path is used.
 */
export const confirmationOf = (
	result: unknown,
	origin: string,
	adminRoute: string,
): PendingConfirmation | undefined => {
	const confirmation = confirmationField(result);
	const url = confirmation?.["url"];
	const review =
		typeof url === "string" ? reviewPath(url, origin, adminRoute) : undefined;

	if (review === undefined) {
		return undefined;
	}

	const { pathname, searchParams } = new URL(review, origin);
	let key: string;

	try {
		key = decodeURIComponent(pathname.split("/").pop() ?? "");
	} catch {
		// A malformed escape in model-visible data leads nowhere.
		return undefined;
	}

	const id =
		typeof confirmation?.["id"] === "string"
			? confirmation["id"]
			: searchParams.get("confirmation");

	return key === "" || !id ? undefined : { id, key, review };
};
