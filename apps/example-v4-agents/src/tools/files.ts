import {
	FluePayloadError,
	untrusted,
} from "@abinnovision/payloadcms-flue/agent";
import { useAgentStart, usePersistentState, useTool } from "@flue/runtime";
import * as v from "valibot";

import type { PayloadRun } from "@abinnovision/payloadcms-flue/agent";

const READS_PER_TURN = 40;
const PAGE_CHARS = 20_000;
const LIST_LIMIT = 25;

const text = (value: unknown): string =>
	typeof value === "string" ? value : "";

const fileOf = (doc: Record<string, unknown>): ThreadFile => ({
	id: doc["id"] as number | string,
	name: text(doc["name"]) || text(doc["filename"]),
	mimeType: text(doc["mimeType"]),
	size: Number(doc["filesize"] ?? 0),
});

/** The upload collection chat files are stored in, as the plugin's `files.collection`. */
export const FILES_COLLECTION = "chat-uploads";

/** A file of the run's thread, as `list_files` answers it. */
export interface ThreadFile {
	id: number | string;
	name: string;
	mimeType: string;
	size: number;
}

/** Runs a tool body; a refusal by Payload comes back as output the model can act on. */
export const refusalAsOutput = async <T>(run: () => Promise<T>) => {
	try {
		return { output: await run() };
	} catch (error) {
		if (!(error instanceof FluePayloadError)) {
			throw error;
		}

		const message = error.message.replace(/^\[payloadcms-flue\] /, "");

		return { output: { error: error.code, message } };
	}
};

/** The files of the run's thread, newest first. Payload narrows the query to the thread. */
export const listFiles = async (
	payload: Pick<PayloadRun, "callTool">,
): Promise<ThreadFile[]> => {
	const result = (await payload.callTool("findDocuments", {
		collection: FILES_COLLECTION,
		sort: "-createdAt",
		limit: LIST_LIMIT,
		select: { name: true, filename: true, mimeType: true, filesize: true },
	})) as { docs?: Record<string, unknown>[] };

	return (result.docs ?? []).map(fileOf);
};

/** A file of the run's thread by its id. */
export const findFile = async (
	payload: Pick<PayloadRun, "callTool">,
	id: number | string,
): Promise<ThreadFile> => {
	const result = (await payload.callTool("getDocument", {
		collection: FILES_COLLECTION,
		id,
	})) as Record<string, unknown>;

	return fileOf(result);
};

/** The bytes of a file of the run's thread, up to `maxBytes`. */
export const readBytes = async (
	payload: Pick<PayloadRun, "download">,
	file: ThreadFile,
	options: { maxBytes?: number; signal?: AbortSignal | undefined } = {},
): Promise<Uint8Array> =>
	(
		await payload.download({
			collection: FILES_COLLECTION,
			id: file.id,
			...(options.maxBytes === undefined ? {} : { maxBytes: options.maxBytes }),
			...(options.signal ? { signal: options.signal } : {}),
		})
	).bytes;

/*
 * A per-turn read budget in persistent state, keyed by a counter that
 * `useAgentStart` bumps for each delivered message. Call it once per agent
 * and pass `spend` to the tool hooks: a state name may be used once per
 * render. Persistent state throws in subagents, so mount it on a root agent.
 */
export const useReadBudget = (): (() => void) => {
	const [turn, setTurn] = usePersistentState("file-turn", 0);
	const [, setBudget] = usePersistentState("file-reads", { turn: 0, reads: 0 });

	useAgentStart(() => {
		setTurn((previous) => previous + 1);
	});

	// The updater sees the current value, so parallel calls cannot overspend.
	return () => {
		setBudget((previous) => {
			const reads = previous.turn === turn ? previous.reads : 0;

			if (reads >= READS_PER_TURN) {
				throw new FluePayloadError(
					"refused",
					"This turn used up its file reads. Answer with what you have.",
				);
			}

			return { turn, reads: reads + 1 };
		});
	};
};

/** Mounts `list_files` and `read_file` for the files the user sent in the thread. */
export const useFileReadTools = (
	payload: Pick<PayloadRun, "callTool" | "download">,
	spend: () => void,
): void => {
	useTool({
		name: "list_files",
		description:
			"Lists the files the user sent in this thread: id, name, MIME type and size in bytes.",
		run: async () =>
			await refusalAsOutput(async () => {
				spend();

				return untrusted(JSON.stringify(await listFiles(payload)), {
					source: "file-list",
				});
			}),
	});

	useTool({
		name: "read_file",
		description:
			"Reads a text file the user sent, by characters. Answers nextOffset while more text follows.",
		input: v.object({
			file: v.union([v.string(), v.number()]),
			offset: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0))),
		}),
		run: async ({ data, signal }) =>
			await refusalAsOutput(async () => {
				spend();

				const file = await findFile(payload, data.file);

				if (!file.mimeType.startsWith("text/")) {
					throw new FluePayloadError(
						"refused",
						`File ${String(file.id)} is ${file.mimeType}, not text.`,
					);
				}

				const decoded = new TextDecoder().decode(
					await readBytes(payload, file, { signal }),
				);
				const offset = data.offset ?? 0;
				const end = Math.min(offset + PAGE_CHARS, decoded.length);
				const content = untrusted(decoded.slice(offset, end), {
					name: file.name,
				});

				return {
					content,
					...(end < decoded.length ? { nextOffset: end } : {}),
				};
			}),
	});
};
