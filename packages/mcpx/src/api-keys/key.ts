import crypto from "node:crypto";

/**
 * A fresh API key: 32 random bytes, base64url so it is safe in headers.
 */
const generateApiKey = (): string =>
	crypto.randomBytes(32).toString("base64url");

/**
 * Lookup index of a key, the same HMAC Payload core uses for `apiKeyIndex`.
 */
const hashApiKey = (secret: string, key: string): string =>
	crypto.createHmac("sha256", secret).update(key).digest("hex");

export { generateApiKey, hashApiKey };
