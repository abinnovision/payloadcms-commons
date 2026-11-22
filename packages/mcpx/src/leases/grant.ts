import {
	claimLease,
	issueLease,
	LEASE_ID,
	leaseHandle,
	leasePrefixes,
	leasesMatching,
	unexpired,
} from "./lease.js";

import type { FallbackLocale, LeaseOwner, StoredCall } from "./lease.js";
import type { DocumentId } from "../entity.js";
import type { Payload } from "payload";

const GRANT_TTL_MS = 5 * 60 * 1000;

const GRANTS_PER_PRINCIPAL = 10;

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
export interface DownloadGrant extends LeaseOwner {
	kind: "download";
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
 * Stores a grant and returns its id. A principal may hold at most
 * {@link GRANTS_PER_PRINCIPAL} grants.
 */
export const issueGrant = async (
	payload: Payload,
	slug: string,
	grant: Omit<DownloadGrant, "exp"> | Omit<UploadGrant, "exp">,
): Promise<{ id: string; exp: number }> =>
	await issueLease(payload, slug, {
		...leasePrefixes("grant", grant.principal),
		cap: GRANTS_PER_PRINCIPAL,
		capMessage: `This client already has ${String(GRANTS_PER_PRINCIPAL)} uploads or downloads waiting. Use or abandon them first; each expires 5 minutes after it was issued.`,
		ttlMs: GRANT_TTL_MS,
		data: grant,
	});

/**
 * Loads the grant for `grantId`, asks `accept` about it and, when it answers
 * other than `null`, marks it used. Returns the grant with that answer, or
 * `undefined` for a malformed, unknown, expired, used or refused grant, which
 * stays claimable when refused. A malformed id is refused before any read.
 */
export const claimGrant = async <Accepted>(
	payload: Payload,
	slug: string,
	grantId: string,
	accept: (grant: Grant) => Promise<Accepted | null>,
): Promise<{ grant: Grant; accepted: Accepted } | undefined> => {
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

	const prefixes = leasePrefixes("grant", grant.principal);

	if (row.key !== `${prefixes.prefix}${handle}`) {
		return undefined;
	}

	const accepted = await accept(grant);

	return accepted !== null &&
		(await claimLease(payload, slug, prefixes, handle, grant.exp))
		? { grant, accepted }
		: undefined;
};
