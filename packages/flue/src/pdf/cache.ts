import { FlueFileError } from "../agent/files.js";

interface Entry<T> {
	doc: Promise<T>;
	bytes: number;
	/** The calls using the document now; a pinned entry is never evicted. */
	pins: number;
}

/**
 * Open documents by key, least recently used first, bounded by the sum of
 * their file sizes. Only idle documents are evicted; a document that does not
 * fit beside the pinned ones is refused. `close` releases an evicted one and
 * `release` frees what a document holds once no call uses it.
 */
export class DocumentCache<T> {
	private readonly entries = new Map<string, Entry<T>>();

	private total = 0;

	public constructor(
		private readonly maxBytes: number,
		private readonly close: (doc: T) => Promise<unknown>,
		private readonly release?: (doc: T) => Promise<unknown>,
	) {}

	/** Runs `run` on the document of `key`, opening it with `load` when it is not open. */
	public async use<R>(
		key: string,
		bytes: number,
		load: () => Promise<T>,
		run: (doc: T) => Promise<R>,
	): Promise<R> {
		const entry = this.entries.get(key) ?? this.open(key, bytes, load);

		// Re-inserted, so the entry becomes the most recently used.
		this.entries.delete(key);
		this.entries.set(key, entry);
		entry.pins += 1;

		try {
			return await run(await entry.doc);
		} finally {
			entry.pins -= 1;

			if (entry.pins === 0 && this.entries.get(key) === entry) {
				this.idle(entry);
			}

			this.evict(0);
		}
	}

	// The next call awaits the release, so the two never overlap.
	private idle(entry: Entry<T>): void {
		const { release } = this;

		if (!release) {
			return;
		}

		const doc = entry.doc.then(async (opened) => {
			await release(opened).catch(() => undefined);

			return opened;
		});

		doc.catch(() => undefined);
		entry.doc = doc;
	}

	private open(key: string, bytes: number, load: () => Promise<T>): Entry<T> {
		let pinned = 0;

		for (const entry of this.entries.values()) {
			pinned += entry.pins > 0 ? entry.bytes : 0;
		}

		// Checked before evicting, so a refused document evicts nothing.
		if (pinned + bytes > this.maxBytes) {
			throw new FlueFileError(
				"unavailable",
				"Other PDF files are in use right now. Try again shortly.",
			);
		}

		this.evict(bytes);

		const entry: Entry<T> = { doc: load(), bytes, pins: 0 };

		this.total += bytes;
		entry.doc.catch(() => {
			this.drop(key, entry);
		});

		return entry;
	}

	// Evicts idle entries, oldest first, until `incoming` more bytes fit.
	private evict(incoming: number): void {
		for (const [key, entry] of this.entries) {
			if (this.total + incoming <= this.maxBytes) {
				return;
			}

			if (entry.pins === 0) {
				this.drop(key, entry);
				void entry.doc
					.then(async (doc) => await this.close(doc))
					.catch(() => undefined);
			}
		}
	}

	private drop(key: string, entry: Entry<T>): void {
		if (this.entries.get(key) === entry) {
			this.entries.delete(key);
			this.total -= entry.bytes;
		}
	}
}
