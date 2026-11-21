/**
 * Bytes `start` to `end` inclusive of a body, all of it by default. Bytes
 * outside the range are discarded and the rest of the body is cancelled, so
 * memory stays bounded by the range and by `maxBytes`. `undefined` once the
 * kept bytes pass `maxBytes`.
 */
export const readBytes = async (
	response: Response,
	maxBytes: number,
	{
		start = 0,
		end = Number.POSITIVE_INFINITY,
	}: { start?: number; end?: number } = {},
): Promise<Uint8Array | undefined> => {
	const reader = response.body?.getReader();
	const whole = start === 0 && end === Number.POSITIVE_INFINITY;

	if (whole && Number(response.headers.get("content-length") ?? 0) > maxBytes) {
		await reader?.cancel().catch(() => undefined);

		return undefined;
	}

	if (reader === undefined) {
		return new Uint8Array();
	}

	const chunks: Uint8Array[] = [];
	let position = 0;
	let size = 0;

	while (position <= end) {
		// eslint-disable-next-line no-await-in-loop
		const { done, value } = await reader.read();

		if (done) {
			break;
		}

		const from = Math.max(start - position, 0);
		const to = Math.min(end + 1 - position, value.byteLength);

		position += value.byteLength;

		if (from < to) {
			size += to - from;

			if (size > maxBytes) {
				// eslint-disable-next-line no-await-in-loop
				await reader.cancel().catch(() => undefined);

				return undefined;
			}

			chunks.push(value.subarray(from, to));
		}
	}

	await reader.cancel().catch(() => undefined);

	const bytes = new Uint8Array(size);
	let offset = 0;

	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}

	return bytes;
};
