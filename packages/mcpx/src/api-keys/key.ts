import crypto from "node:crypto";

/**
 * A fresh API key: 32 random bytes, base64url so it is safe in headers.
 */
export const generateApiKey = (): string =>
	crypto.randomBytes(32).toString("base64url");

/**
 * Lookup index of a key, the same HMAC Payload core uses for `apiKeyIndex`.
 */
export const hashApiKey = (secret: string, key: string): string =>
	crypto.createHmac("sha256", secret).update(key).digest("hex");
