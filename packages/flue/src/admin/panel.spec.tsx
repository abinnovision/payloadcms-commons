import {
	AssistantRuntimeProvider,
	useExternalStoreRuntime,
} from "@assistant-ui/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { flueApi } from "./api.js";
import { fixtureJson } from "../../test/builders/fixtures.js";

import type { AgentSummary } from "./api.js";
import type { PanelView } from "./panel.js";
import type { ThreadsListProps } from "./threads-view.js";
import type { FlueConversationMessage, FlueConversationState } from "@flue/sdk";
import type { ReactNode } from "react";

/*
 * The real module pulls in the whole admin bundle, including its styles. The
 * link renders as the anchor Payload's router adapter would produce.
 */
vi.mock("@payloadcms/ui", () => ({
	PayloadLink: ({
		children,
		className,
		href,
	}: {
		children: ReactNode;
		className?: string;
		href: string;
	}) => (
		<a className={className} href={href}>
			{children}
		</a>
	),
	CheckIcon: () => <svg />,
	ChevronIcon: () => <svg />,
	CircledXIcon: () => <svg />,
	CopyIcon: () => <svg />,
	PlusIcon: () => <svg />,
	SearchIcon: () => <svg />,
	SpinnerIcon: () => <svg />,
	XIcon: () => <svg />,
}));

const { ConversationTitle, FluePanel, LOST_CONVERSATION, lostConversation } =
	await import("./panel.js");
const { ThreadsList } = await import("./threads-view.js");
const { shownMessages, toThreadMessage } = await import("./convert.js");
const { ToolsContext } = await import("./tools.js");

const history = fixtureJson<FlueConversationState>("flue-history.json");

const api = flueApi({
	serverURL: "",
	apiRoute: "/api",
	endpointPath: "/flue",
	threadsSlug: "flue-threads",
	mcpxEndpointPath: "/mcpx",
});

const deletion = (url: string): FlueConversationMessage => ({
	id: "entry_delete",
	role: "assistant",
	purpose: "assistant",
	display: "visible",
	parts: [
		{
			type: "dynamic-tool",
			toolName: "mcp__payload__deleteDocument",
			toolCallId: "call_delete",
			state: "output-available",
			input: { collection: "pages", id: "12" },
			output: { confirmation: { id: "c-1", url } },
		},
	],
});

const answer = (text: string): FlueConversationMessage => ({
	id: "entry_answer",
	role: "assistant",
	purpose: "assistant",
	display: "visible",
	parts: [{ type: "text", text, state: "done" }],
});

const Thread: React.FC<{
	messages: FlueConversationMessage[];
	view?: PanelView | undefined;
	agent: string | undefined;
	runAgents?: AgentSummary[] | undefined;
}> = ({ messages, view = "conversation", agent, runAgents }) => {
	const runtime = useExternalStoreRuntime({
		messages,
		convertMessage: toThreadMessage,
		onNew: () => Promise.resolve(),
	});

	return (
		<AssistantRuntimeProvider runtime={runtime}>
			<ToolsContext
				value={{ api, adminRoute: "/admin", origin: "https://cms.example.com" }}
			>
				<FluePanel
					agent={agent}
					agents={
						agent === undefined ? [] : [{ slug: "editor", label: "Editor" }]
					}
					api={api}
					loadMoreError={undefined}
					onAgent={() => undefined}
					onClose={() => undefined}
					onOpenRun={() => undefined}
					onOpenThread={() => undefined}
					onResize={() => undefined}
					onResizeEnd={() => undefined}
					onStale={() => undefined}
					onView={() => undefined}
					open
					runAgents={runAgents}
					view={view}
					width={420}
				/>
			</ToolsContext>
		</AssistantRuntimeProvider>
	);
};

const render = (
	messages: FlueConversationMessage[],
	view?: PanelView,
	props: { agent?: string | undefined; runAgents?: AgentSummary[] } = {},
): string =>
	renderToStaticMarkup(
		<Thread
			agent={"agent" in props ? props.agent : "editor"}
			messages={messages}
			runAgents={props.runAgents}
			view={view}
		/>,
	);

// Local times, so the groups hold in every time zone.
const NOW = new Date(2026, 10, 8, 14, 30);

const LIST: ThreadsListProps = {
	entries: [],
	grouped: true,
	now: NOW,
	loading: false,
	loadingMore: false,
	hasMore: false,
	error: undefined,
	loadMoreError: undefined,
	empty: <p>Nothing here.</p>,
	renderRow: (index) => <button type="button">{`Row ${String(index)}`}</button>,
	onLoadMore: () => undefined,
	onRetry: () => undefined,
	onRetryMore: () => undefined,
};

const list = (props: Partial<ThreadsListProps>): string =>
	renderToStaticMarkup(<ThreadsList {...LIST} {...props} />);

const entries = (...dates: Date[]) =>
	dates.map((lastMessageAt, index) => ({ key: String(index), lastMessageAt }));

describe("the FluePanel component", () => {
	it("renders the conversation with its tool call collapsed", () => {
		const html = render(shownMessages(history));

		expect(html).toContain("Word?");
		expect(html).toContain("The word is &quot;pelican.&quot;");
		expect(html).toContain("lookup_word");
		expect(html).toContain('aria-expanded="false"');
		expect(html).not.toContain("&quot;word&quot;");
	});

	it("shows the conversation with a Threads toggle that is not pressed", () => {
		const html = render([]);

		expect(html).toContain('aria-pressed="false"');
		expect(html).toMatch(/<section[^>]*aria-label="Threads"[^>]*hidden=""/);
		expect(html).not.toMatch(/class="flue-conversation"[^>]*hidden/);
		expect(html).toContain("New thread</h2>");
		expect(html).not.toContain(LOST_CONVERSATION);
	});

	it("shows the Threads view with the toggle pressed and the conversation hidden", () => {
		const html = render([], "threads");

		expect(html).toContain('aria-pressed="true"');
		expect(html).toMatch(/class="flue-conversation"[^>]*hidden=""/);
		expect(html).toContain('aria-label="Search threads"');
	});

	it("shows no Runs tab without the right to read runs", () => {
		const html = render([], "threads");

		expect(html).not.toContain('role="tablist"');
		expect(html).not.toContain("Runs");
	});

	it("offers Chats and Runs tabs with the right to read runs", () => {
		const html = render([], "threads", {
			runAgents: [
				{ slug: "editor", label: "Editor" },
				{ slug: "auditor", label: "Auditor" },
			],
		});

		expect(html).toContain('role="tablist"');
		expect(html).toMatch(/aria-selected="true"[^>]*>Chats</);
		expect(html).toMatch(/aria-selected="false"[^>]*>Runs</);
	});

	it("lists runs without picker, New thread, Chats tab or composer in Runs-only mode", () => {
		const html = render([], "threads", {
			agent: undefined,
			runAgents: [{ slug: "auditor", label: "Auditor" }],
		});

		expect(html).not.toContain('aria-label="Agent"');
		expect(html).not.toContain("New thread</button>");
		expect(html).not.toContain('role="tablist"');
		expect(html).not.toContain('aria-label="Message"');
		expect(html).toContain('aria-label="Search runs"');
		expect(html).toContain('aria-label="Agent of the runs"');
		expect(html).toContain("Open a run from Threads to read it.");
	});

	it("offers the agent picker and the composer", () => {
		const html = render([]);

		expect(html).toContain('aria-label="Agent"');
		expect(html).toContain("Editor");
		expect(html).toContain('aria-label="Message"');
	});

	it("shows a deletion waiting for approval with its review link", () => {
		const html = render([
			deletion(
				"https://cms.example.com/admin/collections/mcpx-api-keys/3?confirmation=c-1",
			),
		]);

		expect(html).toContain("deleteDocument");
		expect(html).toContain("Checking the approval.");
		expect(html).toContain(
			'href="/admin/collections/mcpx-api-keys/3?confirmation=c-1"',
		);
	});

	it("offers no approval for a confirmation URL outside the admin", () => {
		const html = render([deletion("https://evil.example/phish")]);

		expect(html).toContain("deleteDocument");
		expect(html).not.toContain("Review in admin");
		expect(html).not.toContain("evil.example");
	});

	it("renders the agent's Markdown", () => {
		const html = render([answer("Two pages:\n\n- **Home**\n- `The team`")]);

		expect(html).toContain("<strong>Home</strong>");
		expect(html).toContain("<code>The team</code>");
	});

	it("loads no image from the agent's Markdown", () => {
		const html = render([answer("Look: ![x](https://x.example/p.png)")]);

		expect(html).toContain("Look:");
		expect(html).not.toContain("<img");
		expect(html).not.toContain("x.example");
	});

	it("renders no raw HTML from the agent's Markdown", () => {
		const html = render([answer('<img src="https://x.example/p.png">')]);

		expect(html).not.toContain("<img");
	});

	it("opens the agent's links in a new tab without a referrer", () => {
		const html = render([answer("[Docs](https://docs.example.com)")]);

		expect(html).toContain('href="https://docs.example.com"');
		expect(html).toContain('target="_blank"');
		expect(html).toContain('rel="noopener noreferrer nofollow"');
	});
});

describe("the ThreadsList component", () => {
	it("puts the rows under their date headings, in order", () => {
		const html = list({
			entries: entries(
				new Date(2026, 10, 8, 10, 0),
				new Date(2026, 10, 8, 9, 0),
				new Date(2026, 10, 7, 9, 0),
				new Date(2026, 10, 4, 9, 0),
				new Date(2026, 9, 20, 9, 0),
				new Date(2026, 9, 1, 9, 0),
			),
		});
		const headings = [...html.matchAll(/<h3[^>]*>([^<]+)<\/h3>/g)].map(
			(match) => match[1],
		);

		expect(headings).toEqual([
			"Today",
			"Yesterday",
			"Previous 7 days",
			"Previous 30 days",
			"October",
		]);
		expect(html.indexOf("Row 1")).toBeLessThan(html.indexOf("Yesterday"));
	});

	it("lists search results without headings", () => {
		const html = list({
			entries: entries(new Date(2026, 10, 8, 10, 0)),
			grouped: false,
		});

		expect(html).toContain("Row 0");
		expect(html).not.toContain("<h3");
	});

	it("offers Load more only while more rows follow", () => {
		const one = entries(new Date(2026, 10, 8, 10, 0));

		expect(list({ entries: one, hasMore: true })).toContain("Load more");
		expect(list({ entries: one })).not.toContain("Load more");
		expect(list({ entries: one, hasMore: true, loadingMore: true })).toContain(
			"Loading more threads.",
		);
	});

	it("shows skeleton rows while the first page loads", () => {
		const html = list({ loading: true });

		expect(html.match(/class="flue-skeleton"/g)).toHaveLength(6);
		expect(html).toContain("Loading threads.");
	});

	it("shows the empty state once nothing loaded", () => {
		expect(list({})).toContain("Nothing here.");
	});

	it("offers Retry when the first page failed", () => {
		const html = list({ error: new Error("offline") });

		expect(html).toContain("The threads could not be loaded.");
		expect(html).toContain("Retry");
		expect(html).not.toContain("Nothing here.");
	});

	it("offers Retry under the rows when the next page failed", () => {
		const html = list({
			entries: entries(new Date(2026, 10, 8, 10, 0)),
			hasMore: true,
			loadMoreError: new Error("offline"),
		});

		expect(html).toContain("More threads could not be loaded.");
		expect(html).toContain("Retry");
		expect(html).not.toContain("Load more");
	});
});

describe("the lost-conversation hint", () => {
	it.each([
		{
			label: "a failed row whose conversation is absent",
			failed: true,
			phase: "absent",
			lost: true,
		},
		{
			label: "a failed row whose conversation is live",
			failed: true,
			phase: "live",
			lost: false,
		},
		{
			label: "a thread without a conversation yet",
			failed: false,
			phase: "absent",
			lost: false,
		},
	] as const)("is $lost for $label", ({ failed, phase, lost }) => {
		expect(lostConversation({ failed }, phase)).toBe(lost);
	});

	it("names the lost conversation under the title", () => {
		const html = renderToStaticMarkup(
			<ConversationTitle lost title="Fix the home page" />,
		);

		expect(html).toContain("Fix the home page");
		expect(html).toContain(LOST_CONVERSATION);
	});

	it("shows the agent and how a run started", () => {
		const html = renderToStaticMarkup(
			<ConversationTitle
				lost={false}
				meta="Editor · Scheduled"
				title="Nightly link check"
			/>,
		);

		expect(html).toContain("Editor · Scheduled");
		expect(html).not.toContain(LOST_CONVERSATION);
	});
});
