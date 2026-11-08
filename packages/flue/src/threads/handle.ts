import { createHash } from "node:crypto";

/** The SHA-256 of a handle, hex encoded. Only the hash is ever stored. */
export const handleHash = (handle: string): string =>
	createHash("sha256").update(handle).digest("hex");
