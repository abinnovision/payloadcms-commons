import { FluePayloadError } from "./exchange.js";
import { isRecord } from "../protocol/guards.js";

const trimmed = (path: string): string => path.replace(/\/+$/, "");

/**
 * The route below `mcpPath` and the headers to send for a
 * transfer handoff mcpx returned. The handoff names Payload's public origin,
 * so only its path is read, and only `route` is accepted. Throws `missing`
 * for a value that is no handoff.
 */
export const handoffRequest = (
	handoff: unknown,
	mcpPath: string,
	route: "file" | "upload",
	missing: FluePayloadError,
): { path: string; headers: Record<string, string> } => {
	if (
		!isRecord(handoff) ||
		typeof handoff["url"] !== "string" ||
		!isRecord(handoff["headers"])
	) {
		throw missing;
	}

	const path = `${trimmed(mcpPath)}/${route}`;
	let handoffPath: string;

	try {
		handoffPath = trimmed(new URL(handoff["url"]).pathname);
	} catch (error) {
		throw new FluePayloadError(
			"refused",
			"mcpx returned an unparsable handoff URL.",
			undefined,
			{ cause: error },
		);
	}

	if (!handoffPath.endsWith(path)) {
		throw new FluePayloadError(
			"refused",
			`mcpx returned a handoff outside "${path}", so nothing was transferred.`,
		);
	}

	return {
		path,
		headers: Object.fromEntries(
			Object.entries(handoff["headers"]).filter(
				(entry): entry is [string, string] => typeof entry[1] === "string",
			),
		),
	};
};
