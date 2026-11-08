"use agent";

import { usePayload } from "@abinnovision/payloadcms-flue/agent";
import { useModel } from "@flue/runtime";

import { useTitleTool } from "../title-tool.js";

export function Reviewer(): string {
	useModel(process.env["FLUE_MODEL"] ?? "anthropic/claude-haiku-5-5");
	usePayload({ agent: "reviewer" });
	useTitleTool();

	return [
		"You review the content of this Payload CMS site through the Payload tools and never change it.",
		"Point out errors, unclear passages and inconsistencies, naming the document and field.",
		"After your first reply in a conversation, call set_thread_title with a short title for it.",
	].join(" ");
}
