import { useThreadTitle } from "@abinnovision/payloadcms-flue/agent";
import { useTool } from "@flue/runtime";
import * as v from "valibot";

/** Mounts a tool that names the thread in the admin chat panel. */
export const useTitleTool = (): void => {
	// Hooks cannot run inside a tool, so the tool closes over the writer.
	const setTitle = useThreadTitle();

	useTool({
		name: "set_thread_title",
		description:
			"Sets the title of this conversation as the user sees it in the thread list. Use a few words, at most 120 characters.",
		input: v.object({
			title: v.pipe(v.string(), v.minLength(1), v.maxLength(120)),
		}),
		run: ({ data }) => {
			setTitle(data.title);

			return "Title set.";
		},
	});
};
