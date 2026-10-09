import {
	claimLease,
	issueLease,
	LEASE_ID,
	leaseHandle,
	leasePrefixes,
	leasesMatching,
	unexpired,
} from "./lease.js";

import type { FallbackLocale, StoredCall } from "./lease.js";
import type { DocumentId } from "../entity.js";
import type { Payload } from "payload";

const GRANT_TTL_MS = 5 * 60 * 1000;

const GRANTS_PER_KEY = 10;

/**
 * The file an upload call declared.
 */
export interface UploadFile {
	filename: string;
	mimeType: string;
	size: number;
}

/**
 * A tool call waiting for its file, stored until the PUT that completes it.
 */
export interface UploadGrant extends StoredCall {
	kind: "upload";
	file: UploadFile;
	/**
	 * Epoch milliseconds.
	 */
	exp: number;
}

/**
 * The file of a document read through `getDocument`, stored until the GET
 * that serves it.
 */
export interface DownloadGrant {
	kind: "download";
	apiKeyId: DocumentId;
	collection: string;
	id: DocumentId;
	/**
	 * Whether the latest draft was read, rather than the published version.
	 */
	draft: boolean;
	/**
	 * The locale read and the request's fallback locale, `null` when unset.
	 */
	locale: null | string;
	fallbackLocale: FallbackLocale;
	/**
	 * Epoch milliseconds.
	 */
	exp: number;
}

export type Grant = DownloadGrant | UploadGrant;

/**
 * Stores a grant and returns its id. A key may hold at most
 * {@link GRANTS_PER_KEY} grants.
 */
export const issueGrant = async (
	payload: Payload,
	slug: string,
	grant: Omit<DownloadGrant, "exp"> | Omit<UploadGrant, "exp">,
): Promise<{ id: string; exp: number }> =>
	await issueLease(payload, slug, {
		...leasePrefixes("grant", grant.apiKeyId),
		cap: GRANTS_PER_KEY,
		capMessage: `This key already has ${String(GRANTS_PER_KEY)} uploads or downloads waiting. Use or abandon them first; each expires 5 minutes after it was issued.`,
		ttlMs: GRANT_TTL_MS,
		data: grant,
	});

/**
 * Loads the grant for `grantId` and marks it used, or returns `undefined` for
 * a malformed, unknown, expired or used one. A malformed id is refused before
 * any database read.
 */
export const claimGrant = async (
	payload: Payload,
	slug: string,
	grantId: string,
): Promise<Grant | undefined> => {
	if (!LEASE_ID.test(grantId)) {
		return undefined;
	}

	const handle = leaseHandle(payload, grantId);
	const row = (await leasesMatching<Grant>(payload, slug, [handle])).find(
		(candidate) =>
			candidate.key.startsWith("mcpx-grant:") &&
			candidate.key.endsWith(`:${handle}`),
	);
	const grant = unexpired(row, Date.now());

	if (!row || !grant) {
		return undefined;
	}

	const prefixes = leasePrefixes("grant", grant.apiKeyId);

	return row.key === `${prefixes.prefix}${handle}` &&
		(await claimLease(payload, slug, prefixes, handle, grant.exp))
		? grant
		: undefined;
};
