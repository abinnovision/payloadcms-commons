/** Joins chunks of `size` bytes in total. */
export const concat = (chunks: Uint8Array[], size: number): Uint8Array => {
	const bytes = new Uint8Array(size);
	let offset = 0;

	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}

	return bytes;
};

/**
 * Reads a body, cancelling it once it passes `maxBytes`, so memory stays
 * bounded by the cap. `undefined` when the body is larger.
 */
export const readCapped = async (
	response: Response,
	maxBytes: number,
): Promise<Uint8Array | undefined> => {
	if (Number(response.headers.get("content-length") ?? 0) > maxBytes) {
		await response.body?.cancel().catch(() => undefined);

		return undefined;
	}

	const reader = response.body?.getReader();

	if (reader === undefined) {
		return new Uint8Array();
	}

	const chunks: Uint8Array[] = [];
	let size = 0;

	for (;;) {
		// eslint-disable-next-line no-await-in-loop
		const { done, value } = await reader.read();

		if (done) {
			break;
		}

		size += value.byteLength;

		if (size > maxBytes) {
			// eslint-disable-next-line no-await-in-loop
			await reader.cancel().catch(() => undefined);

			return undefined;
		}

		chunks.push(value);
	}

	return concat(chunks, size);
};
