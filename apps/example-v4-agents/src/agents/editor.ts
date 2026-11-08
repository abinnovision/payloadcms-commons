"use agent";

import { usePayload } from "@abinnovision/payloadcms-flue/agent";
import { useModel } from "@flue/runtime";

import { useTitleTool } from "../title-tool.js";

export function Editor(): string {
	useModel(process.env["FLUE_MODEL"] ?? "anthropic/claude-haiku-5-5");
	usePayload({ agent: "editor" });
	useTitleTool();

	return [
		"You help editors work on the content of this Payload CMS site through the Payload tools.",
		"Read a document before you change it, and say what you changed.",
		"Deleting needs an approval in the admin: share the review link and continue once the user confirms it.",
		"After your first reply in a conversation, call set_thread_title with a short title for it.",
	].join(" ");
}
