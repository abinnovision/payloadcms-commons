// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { FlueChatProps } from "./chat.js";

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// The signed-in user the mocked auth provider reports.
let user: null | { id: number; collection: string } = null;

// The `flue` preference the mocked preferences provider stores.
let stored: unknown = null;

const preferences = {
	getPreference: () => Promise.resolve(stored),
	setPreference: () => Promise.resolve(),
};
const config = {
	config: { serverURL: "", routes: { admin: "/admin", api: "/api" } },
};

// The real module pulls in the whole admin bundle, including its styles.
vi.mock("@payloadcms/ui", () => ({
	toast: { error: () => undefined },
	useAuth: () => ({ user }),
	useConfig: () => config,
	useHotkey: () => undefined,
	usePreferences: () => preferences,
}));

// Each mount of the chat, with the props it got.
const mounts: FlueChatProps[] = [];

vi.mock("./chat.js", async () => {
	const { useEffect } = await import("react");

	return {
		FlueChat: (props: FlueChatProps) => {
			useEffect(() => {
				mounts.push(props);
			}, [props]);

			return null;
		},
	};
});

const { FlueProvider } = await import("./provider.js");

const render = (): string =>
	renderToStaticMarkup(
		<FlueProvider
			endpointPath="/flue"
			mcpxEndpointPath="/mcpx"
			threadsSlug="flue-threads"
			userCollection="users"
		>
			<main>Dashboard</main>
		</FlueProvider>,
	);

// The admin's markup inside the layout, with no panel next to it.
const LAYOUT =
	'<div class="flue-layout" style="--flue-panel-width:420px"><div class="flue-layout__main"><main>Dashboard</main></div></div>';

describe("the FlueProvider component", () => {
	it.each([
		["nobody is signed in", null],
		[
			"a user outside the user collection is signed in",
			{ id: 1, collection: "admins" },
		],
	])(
		"renders the admin in the layout without a panel while %s",
		(_label, signedIn) => {
			user = signedIn;

			const html = render();

			expect(html).toContain(LAYOUT);
			expect(html).not.toContain('id="flue-panel"');
		},
	);

	it("keeps the admin in the same elements when a user signs in", () => {
		user = null;

		const signedOut = render();

		user = { id: 1, collection: "users" };

		expect(render()).toBe(signedOut);
	});
});

// Answers the plugin's agents endpoint and the threads collection's rows.
const serve = (
	agents: unknown,
	threads: Record<string, unknown> = {},
): void => {
	vi.stubGlobal("fetch", (url: string) => {
		const row = /\/flue-threads\/(\w+)/.exec(url)?.[1];

		return Promise.resolve(
			row === undefined
				? Response.json(agents)
				: Response.json(threads[row] ?? { errors: [] }, {
						status: row in threads ? 200 : 404,
					}),
		);
	});
};

// Mounts the provider and resolves to the chat's first mount.
const mountProvider = async (): Promise<() => void> => {
	const container = document.createElement("div");
	const root = createRoot(container);

	act(() => {
		root.render(
			<FlueProvider
				endpointPath="/flue"
				mcpxEndpointPath="/mcpx"
				threadsSlug="flue-threads"
				userCollection="users"
			/>,
		);
	});

	await vi.waitFor(() => {
		expect(mounts).not.toHaveLength(0);
	});

	return () => {
		act(() => {
			root.unmount();
		});
	};
};

describe("the FlueProvider with a signed-in user", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		mounts.length = 0;
		stored = null;
	});

	it("opens another agent's thread with agent and thread set together", async () => {
		user = { id: 1, collection: "users" };
		serve({
			agents: [
				{ slug: "editor", label: "Editor" },
				{ slug: "summarizer", label: "Summarizer" },
			],
			runs: null,
		});

		const unmount = await mountProvider();

		expect(mounts.at(-1)).toMatchObject({
			agent: "editor",
			threadId: undefined,
			chosen: false,
			runAgents: undefined,
		});

		act(() => {
			mounts.at(-1)!.onView("threads");
		});
		act(() => {
			mounts.at(-1)!.onOpenThread("summarizer", "42");
		});

		expect(mounts.at(-1)).toMatchObject({
			agent: "summarizer",
			threadId: "42",
			chosen: true,
			view: "conversation",
		});
		unmount();
	});

	it("restores a run of an agent the user cannot chat with", async () => {
		user = { id: 1, collection: "users" };
		stored = { open: true, agent: "editor", threadId: "77", width: 420 };
		serve(
			{
				agents: [{ slug: "editor", label: "Editor" }],
				runs: { agents: [{ slug: "editor" }, { slug: "auditor" }] },
			},
			{ 77: { id: 77, agent: "auditor", kind: "ambient", status: "idle" } },
		);

		const unmount = await mountProvider();

		expect(mounts.at(-1)).toMatchObject({
			agent: "editor",
			threadId: "77",
			runAgents: [{ slug: "editor" }, { slug: "auditor" }],
		});
		unmount();
	});

	it("restores no run for a user who may not read runs", async () => {
		user = { id: 1, collection: "users" };
		stored = { open: true, agent: "editor", threadId: "77", width: 420 };
		serve(
			{ agents: [{ slug: "editor", label: "Editor" }], runs: null },
			{ 77: { id: 77, agent: "auditor", kind: "ambient", status: "idle" } },
		);

		const unmount = await mountProvider();

		expect(mounts.at(-1)).toMatchObject({
			agent: "editor",
			threadId: undefined,
		});
		unmount();
	});

	it("mounts the chat on the runs without an agent in Runs-only mode", async () => {
		user = { id: 1, collection: "users" };
		serve({ agents: [], runs: { agents: [{ slug: "auditor" }] } });

		const unmount = await mountProvider();

		expect(mounts.at(-1)).toMatchObject({
			agent: undefined,
			agents: [],
			runAgents: [{ slug: "auditor" }],
			view: "threads",
		});
		unmount();
	});
});
