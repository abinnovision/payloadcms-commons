/**
 * The Payload major the current test run targets, set by the v4 configs.
 */
export const payloadMajor = (): 3 | 4 => {
	const raw = process.env["PAYLOAD_MAJOR"];
	const major = Number(raw ?? 3);
	if (major !== 3 && major !== 4) {
		throw new Error(`Unsupported PAYLOAD_MAJOR: ${String(raw)}`);
	}

	return major;
};
