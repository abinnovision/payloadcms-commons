import { endpointHandler, json, requireUser } from "./http.js";

import type { PluginSettings } from "../turn.js";
import type { FlueAgentConfig } from "../types.js";
import type { PayloadHandler, PayloadRequest } from "payload";

/** Whether the agent's `access` admits `req`; no `access` admits everyone. */
export const agentAdmits = async (
	agent: FlueAgentConfig,
	req: PayloadRequest,
): Promise<boolean> => (agent.access ? await agent.access({ req }) : true);

/**
 * `GET {base}/agents`: the agents the signed-in user may chat with, and
 * under `runs` every configured agent when `threads.readAgentRuns` lets the
 * user read agent runs, so the panel can label runs of any agent; otherwise
 * `runs` is null. `attachments` holds the chat attachment limits, or null
 * when attachments are off.
 */
export const agentsHandler = (settings: PluginSettings): PayloadHandler =>
	endpointHandler(async (req) => {
		const user = requireUser(req, settings.mcpx.userCollection);

		if (user instanceof Response) {
			return user;
		}

		const admitted = await Promise.all(
			settings.agents.map((agent) => agentAdmits(agent, req)),
		);

		return json(200, {
			agents: settings.agents
				.filter((_, index) => admitted[index])
				.map(({ slug, label, description }) => ({ slug, label, description })),
			attachments: settings.attachments
				? {
						mimeTypes: settings.attachments.mimeTypes,
						maxImageBytes: settings.attachments.maxImageBytes,
						maxDocumentBytes: settings.attachments.maxDocumentBytes,
						maxFiles: settings.attachments.maxFiles,
					}
				: null,
			runs: settings.threads.readAgentRuns(req)
				? {
						agents: settings.agents.map(({ slug, label }) => ({ slug, label })),
					}
				: null,
		});
	});
