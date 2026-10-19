import { createRouter } from "@abinnovision/payloadcms-wayfinder";
import { loadMappings } from "@abinnovision/payloadcms-wayfinder/config";

import { links } from "../links";
import { createFormatHref } from "../locales";

import type { TaskConfig, WorkflowConfig } from "payload";

/*
 * Built from the package rather than `routerArgs` in `src/wayfinder.ts`: that
 * one imports React and the config itself, and this file is part of the
 * config.
 */
export const resolveArticleURLTask: TaskConfig<"resolve-article-url"> = {
	slug: "resolve-article-url",
	inputSchema: [{ name: "articleId", type: "number", required: true }],
	outputSchema: [{ name: "url", type: "text", required: true }],
	handler: async ({ input, req }) => {
		const { payload } = req;

		const article = await payload.findByID({
			collection: "articles",
			id: input.articleId,
			// Populates the section, whose slug the pattern takes.
			depth: 1,
			req,
		});

		const href = createRouter({
			mappings: await loadMappings({ payload }),
			locale: "en",
			formatHref: createFormatHref(),
			links,
			context: { filesBase: "/files" },
		}).href("articles", article);

		if (!href) {
			throw new Error(`No URL for article ${String(input.articleId)}`);
		}

		return {
			output: { url: new URL(href, payload.config.serverURL).toString() },
		};
	},
};

export const announceArticleTask: TaskConfig<"announce-article"> = {
	slug: "announce-article",
	inputSchema: [{ name: "url", type: "text", required: true }],
	handler: ({ input, req }) => {
		req.payload.logger.info(`Article published at ${input.url}`);

		return { output: {} };
	},
};

/**
 * Queued by the `afterChange` hook on `articles` when a document is published.
 * Each task's output is stored on the job, so a retry skips what already ran.
 */
export const articlePublishedWorkflow: WorkflowConfig<"article-published"> = {
	slug: "article-published",
	inputSchema: [{ name: "articleId", type: "number", required: true }],
	handler: async ({ job, tasks }) => {
		const { url } = await tasks["resolve-article-url"]("resolve", {
			input: { articleId: job.input.articleId },
		});

		await tasks["announce-article"]("announce", { input: { url } });
	},
};
