import { FlueFileError, untrusted } from "@abinnovision/payloadcms-flue/agent";
import { useAgentStart, usePersistentState, useTool } from "@flue/runtime";
import * as v from "valibot";

import type {
	FileArg,
	PayloadRun,
	WorkspaceFile,
} from "@abinnovision/payloadcms-flue/agent";

const READS_PER_TURN = 40;
const PAGE_CHARS = 20_000;

export type FilesApi = Pick<PayloadRun, "files">["files"];

/** Runs a tool body; a file refusal comes back as output the model can act on. */
export const refusalAsOutput = async <T>(run: () => Promise<T>) => {
	try {
		return { output: await run() };
	} catch (error) {
		if (!(error instanceof FlueFileError)) {
			throw error;
		}

		const message = error.message.replace(/^\[payloadcms-flue\] /, "");

		return { output: { error: error.code, message } };
	}
};

/** The listed file of an id; the listing applies the thread's access. */
export const findFile = async (
	files: FilesApi,
	file: FileArg,
): Promise<WorkspaceFile> => {
	const id = String(typeof file === "object" ? file.id : file);
	const found = (await files.list()).find((item) => String(item.id) === id);

	if (!found) {
		throw new FlueFileError("not_found", `File ${id} is not in this thread.`);
	}

	return found;
};

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
				throw new FlueFileError(
					"refused",
					"This turn used up its file reads. Answer with what you have.",
				);
			}

			return { turn, reads: reads + 1 };
		});
	};
};

/** Mounts `list_files` and `read_file` for the files the user attached to the thread. */
export const useFileReadTools = (
	payload: Pick<PayloadRun, "files">,
	spend: () => void,
): void => {
	const { files } = payload;

	useTool({
		name: "list_files",
		description:
			"Lists the files the user attached to this thread: id, name, MIME type and size in bytes.",
		run: async () =>
			await refusalAsOutput(async () => {
				spend();

				return untrusted(JSON.stringify(await files.list()), {
					source: "file-list",
				});
			}),
	});

	useTool({
		name: "read_file",
		description:
			"Reads a text file the user attached, by characters. Answers nextOffset while more text follows.",
		input: v.object({
			file: v.union([v.string(), v.number()]),
			offset: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0))),
		}),
		run: async ({ data, signal }) =>
			await refusalAsOutput(async () => {
				spend();

				const file = await findFile(files, data.file);

				if (!file.mimeType.startsWith("text/")) {
					throw new FlueFileError(
						"refused",
						`File ${String(file.id)} is ${file.mimeType}, not text.`,
					);
				}

				const text = new TextDecoder().decode(
					await files.read(file, signal ? { signal } : {}),
				);
				const offset = data.offset ?? 0;
				const end = Math.min(offset + PAGE_CHARS, text.length);
				const content = untrusted(text.slice(offset, end), { name: file.name });

				return { content, ...(end < text.length ? { nextOffset: end } : {}) };
			}),
	});
};
