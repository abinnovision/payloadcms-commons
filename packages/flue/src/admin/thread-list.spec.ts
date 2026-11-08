// @vitest-environment happy-dom
import {
	AssistantRuntimeProvider,
	useAui,
	useExternalStoreRuntime,
	useRemoteThreadListRuntime,
} from "@assistant-ui/react";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { flueApi } from "./api.js";
import { decodeCursor } from "./keyset.js";
import { PAGE_SIZE, RELOAD_MAX, threadListAdapter } from "./thread-list.js";

import type { FlueApi, ThreadDoc, ThreadFilter, ThreadPage } from "./api.js";
import type { Keyset } from "./keyset.js";
import type { AssistantClient, ThreadMessage } from "@assistant-ui/react";

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const api = flueApi({
	serverURL: "",
	apiRoute: "/api",
	endpointPath: "/flue",
	threadsSlug: "flue-threads",
	mcpxEndpointPath: "/mcpx",
});

const own: ThreadDoc = {
	id: 1,
	agent: "editor",
	title: "Fix the home page",
	status: "running",
	kind: "chat",
	createdBy: { relationTo: "users", value: 7 },
	lastMessageAt: "2026-11-07T10:00:00.000Z",
	lastReadAt: "2026-11-07T09:00:00.000Z",
};

const failed: ThreadDoc = {
	id: 2,
	agent: "editor",
	title: null,
	status: "failed",
	kind: "chat",
	createdBy: { relationTo: "users", value: 7 },
	lastMessageAt: "2026-11-07T09:00:00.000Z",
	lastReadAt: "2026-11-07T09:00:00.000Z",
};

interface Sent {
	url: string;
	method: string;
	body: unknown;
}

const answer = (body: unknown): Sent[] => {
	const sent: Sent[] = [];

	vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
		sent.push({
			url,
			method: init?.method ?? "GET",
			body:
				typeof init?.body === "string"
					? (JSON.parse(init.body) as unknown)
					: undefined,
		});

		return Promise.resolve(Response.json(body));
	});

	return sent;
};

// Six hundred rows, newest first, two on each minute.
const ROWS: ThreadDoc[] = Array.from({ length: 600 }, (_, index) => ({
	id: 1000 - index,
	agent: "editor",
	title: `Thread ${String(index)}`,
	status: "idle",
	kind: "chat",
	createdBy: { relationTo: "users", value: 7 },
	lastMessageAt: new Date(
		Date.UTC(2026, 10, 8) - Math.floor(index / 2) * 60_000,
	).toISOString(),
}));

const below = (row: ThreadDoc, after: Keyset): boolean => {
	const time = Date.parse(row.lastMessageAt ?? "");
	const cursor = Date.parse(after.lastMessageAt);

	return (
		time < cursor || (time === cursor && Number(row.id) < Number(after.id))
	);
};

interface PagedApi {
	api: FlueApi;
	calls: { limit: number; after: Keyset | undefined }[];
	/** Holds the next page asked for after a cursor until released. */
	hold: () => () => void;
	/** Fails the next page asked for after a cursor. */
	failNext: () => void;
}

// The threads collection's keyset paging over `ROWS`.
const pagedApi = (): PagedApi => {
	const calls: PagedApi["calls"] = [];
	let gate: Promise<void> | undefined;
	let fail = false;

	const threads = async (
		_filter: ThreadFilter,
		page: { limit: number; after?: Keyset | undefined },
	): Promise<ThreadPage> => {
		calls.push({ limit: page.limit, after: page.after });

		if (page.after !== undefined) {
			await gate;

			if (fail) {
				fail = false;
				throw new Error("The request failed with status 500.");
			}
		}

		const { after } = page;
		const rest =
			after === undefined ? ROWS : ROWS.filter((row) => below(row, after));

		return {
			docs: rest.slice(0, page.limit),
			hasNextPage: rest.length > page.limit,
		};
	};

	return {
		api: { ...api, threads },
		calls,
		hold: () => {
			let release!: () => void;

			gate = new Promise<void>((resolve) => {
				release = resolve;
			});

			return () => {
				gate = undefined;
				release();
			};
		},
		failNext: () => {
			fail = true;
		},
	};
};

const adapterFor = (
	source: FlueApi = api,
	created = vi.fn<(id: string) => Promise<number>>(),
) => {
	const listed: ThreadDoc[][] = [];
	const errors: unknown[] = [];
	const adapter = threadListAdapter({
		api: source,
		agent: "editor",
		isOwn: (thread) => thread.createdBy?.relationTo === "users",
		onList: (threads) => listed.push(threads),
		onLoadMoreError: (error) => errors.push(error),
		created,
	});

	return { adapter, listed, errors };
};

// Loads `pages` more pages after `cursor`, one after the other.
const pageOn = async (
	adapter: ReturnType<typeof adapterFor>["adapter"],
	cursor: string | undefined,
	pages: number,
): Promise<string | undefined> => {
	if (pages === 0) {
		return cursor;
	}

	const { nextCursor } = await adapter.list({ after: cursor });

	return await pageOn(adapter, nextCursor, pages - 1);
};

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("threadListAdapter", () => {
	it("lists the agent's open chats, newest first, with read state and status", async () => {
		const sent = answer({ docs: [own, failed], hasNextPage: false });
		const { adapter, listed } = adapterFor();

		await expect(adapter.list()).resolves.toEqual({
			threads: [
				{
					status: "regular",
					remoteId: "1",
					title: "Fix the home page",
					lastMessageAt: new Date("2026-11-07T10:00:00.000Z"),
					custom: {
						readOnly: false,
						unread: true,
						running: true,
						failed: false,
						agent: "editor",
						kind: "chat",
					},
				},
				{
					status: "regular",
					remoteId: "2",
					title: undefined,
					lastMessageAt: new Date("2026-11-07T09:00:00.000Z"),
					custom: {
						readOnly: false,
						unread: false,
						running: false,
						failed: true,
						agent: "editor",
						kind: "chat",
					},
				},
			],
			nextCursor: undefined,
		});
		expect(listed).toEqual([[own, failed]]);

		const query = new URL(sent[0]!.url, "https://cms.example.com").searchParams;

		expect(query.get("where[and][0][status][not_equals]")).toBe("archived");
		expect(query.get("where[and][1][kind][equals]")).toBe("chat");
		expect(query.get("where[and][2][agent][equals]")).toBe("editor");
		expect(query.get("where[and][3][lastMessageAt][exists]")).toBe("true");
		expect(query.get("sort")).toBe("-lastMessageAt,-id");
		expect(query.get("limit")).toBe(String(PAGE_SIZE));
	});

	it("hands out a cursor while more pages follow and continues after it", async () => {
		const paged = pagedApi();
		const { adapter } = adapterFor(paged.api);
		const first = await adapter.list();

		expect(first.threads).toHaveLength(PAGE_SIZE);
		expect(decodeCursor(first.nextCursor ?? "")).toEqual({
			lastMessageAt: ROWS[49]!.lastMessageAt,
			id: ROWS[49]!.id,
		});

		const second = await adapter.list({ after: first.nextCursor });

		expect(second.threads.map((thread) => thread.remoteId)).toEqual(
			ROWS.slice(50, 100).map((row) => String(row.id)),
		);
	});

	it("hands out no cursor on the last page", async () => {
		answer({ docs: [own], hasNextPage: false });

		const { adapter } = adapterFor();

		expect((await adapter.list()).nextCursor).toBeUndefined();
	});

	it("asks for every loaded row on a list without a cursor, up to the cap", async () => {
		const paged = pagedApi();
		const { adapter, listed } = adapterFor(paged.api);
		let cursor = (await adapter.list()).nextCursor;

		cursor = (await adapter.list({ after: cursor })).nextCursor;
		await adapter.list({ after: cursor });
		await adapter.list();

		expect(paged.calls.map((call) => call.limit)).toEqual([50, 50, 50, 150]);
		expect(listed.map((rows) => rows.length)).toEqual([50, 100, 150, 150]);

		await pageOn(adapter, cursor, 8);
		await adapter.list();

		expect(paged.calls.at(-1)?.limit).toBe(RELOAD_MAX);
	});

	it("records a failed next page, rethrows it and clears it once a page loads", async () => {
		const paged = pagedApi();
		const { adapter, errors } = adapterFor(paged.api);
		const cursor = (await adapter.list()).nextCursor;

		paged.failNext();
		await expect(adapter.list({ after: cursor })).rejects.toThrow(
			"The request failed with status 500.",
		);
		await adapter.list({ after: cursor });

		expect(errors).toEqual([
			undefined,
			expect.objectContaining({
				message: "The request failed with status 500.",
			}),
			undefined,
		]);
	});

	it("ignores the failure of a next page a reload superseded", async () => {
		const paged = pagedApi();
		const { adapter, errors } = adapterFor(paged.api);
		const cursor = (await adapter.list()).nextCursor;
		const release = paged.hold();

		paged.failNext();

		const stale = adapter.list({ after: cursor });

		await adapter.list();
		release();
		await expect(stale).rejects.toThrow("The request failed with status 500.");

		expect(errors).toEqual([undefined, undefined]);
	});

	it("drops an archived thread from the loaded rows", async () => {
		const paged = pagedApi();
		const { adapter, listed } = adapterFor(paged.api);

		await adapter.list();
		answer({ doc: ROWS[0] });
		await adapter.archive(String(ROWS[0]!.id));

		expect(listed.at(-1)).toHaveLength(49);
		expect(listed.at(-1)?.map((row) => row.id)).not.toContain(ROWS[0]!.id);
	});

	it("fetches one thread and reports an archived one as archived", async () => {
		const sent = answer({ ...own, status: "archived" });
		const { adapter } = adapterFor();

		await expect(adapter.fetch("1")).resolves.toMatchObject({
			status: "archived",
			remoteId: "1",
		});
		expect(sent[0]!.url).toBe("/api/flue-threads/1?depth=0");
	});

	it("marks a run another user started as read-only", async () => {
		answer({
			...own,
			id: 3,
			kind: "reactive",
			createdBy: { relationTo: "agents", value: 1 },
		});

		const { adapter } = adapterFor();

		await expect(adapter.fetch("3")).resolves.toMatchObject({
			custom: { readOnly: true, unread: false, kind: "reactive" },
		});
	});

	it("renames a thread through its title", async () => {
		const sent = answer({ doc: own });
		const { adapter } = adapterFor();

		await adapter.rename("1", "New title");

		expect(sent).toEqual([
			{
				url: "/api/flue-threads/1",
				method: "PATCH",
				body: { title: "New title" },
			},
		]);
	});

	it("archives a thread when it is archived or deleted", async () => {
		const sent = answer({ doc: own });
		const { adapter } = adapterFor();

		await adapter.archive("1");
		await adapter.delete("2");

		expect(sent.map(({ url, body }) => ({ url, body }))).toEqual([
			{ url: "/api/flue-threads/1", body: { status: "archived" } },
			{ url: "/api/flue-threads/2", body: { status: "archived" } },
		]);
	});

	it("initializes a new thread with the id its first message created", async () => {
		const created = vi.fn((localId: string) =>
			Promise.resolve(localId === "__LOCALID_a" ? 42 : 0),
		);
		const { adapter } = adapterFor(api, created);

		await expect(adapter.initialize("__LOCALID_a")).resolves.toEqual({
			remoteId: "42",
			externalId: undefined,
		});
	});

	it("generates no title, since the agent writes it", async () => {
		const { adapter } = adapterFor();
		const stream = await adapter.generateTitle("1", []);
		const reader = stream.getReader();

		await expect(reader.read()).resolves.toEqual({
			done: true,
			value: undefined,
		});
	});
});

type Threads = AssistantClient["threads"];

// The adapter under assistant-ui's runtime, with the list's methods exposed.
const mount = (paged: PagedApi) => {
	const { adapter } = adapterFor(paged.api);
	let threads: Threads | undefined;

	const Capture = (): null => {
		threads = useAui().threads;

		return null;
	};

	const useThread = () =>
		useExternalStoreRuntime<ThreadMessage>({
			messages: [],
			onNew: () => Promise.resolve(),
		});

	const App = () =>
		createElement(
			AssistantRuntimeProvider,
			{
				runtime: useRemoteThreadListRuntime({
					adapter,
					runtimeHook: useThread,
				}),
			},
			createElement(Capture),
		);

	const container = document.createElement("div");
	const root = createRoot(container);

	document.body.append(container);
	act(() => {
		root.render(createElement(App));
	});

	return {
		threads: () => {
			if (threads === undefined) {
				throw new Error("The runtime is not mounted.");
			}

			return threads;
		},
		unmount: () => {
			act(() => {
				root.unmount();
			});
			container.remove();
		},
	};
};

const settle = async (ms = 30): Promise<void> => {
	await act(async () => {
		await new Promise<void>((resolve) => {
			setTimeout(resolve, ms);
		});
	});
};

const until = async (check: () => boolean, attempts = 100): Promise<void> => {
	if (check()) {
		return;
	}

	if (attempts === 0) {
		throw new Error("The list did not reach the expected state.");
	}

	await settle(20);
	await until(check, attempts - 1);
};

const ids = (count: number): string[] =>
	ROWS.slice(0, count).map((row) => String(row.id));

describe("threadListAdapter under assistant-ui's runtime", () => {
	it("keeps three loaded pages in order across a reload", async () => {
		const paged = pagedApi();
		const { threads, unmount } = mount(paged);
		const listed = () => threads().getState().threadIds;

		await until(() => listed().length === 50);
		void threads().loadMore();
		await until(() => listed().length === 100);
		void threads().loadMore();
		await until(() => listed().length === 150);

		await act(async () => {
			await threads().reload();
		});
		await settle();

		expect(listed()).toEqual(ids(150));

		void threads().loadMore();
		await until(() => listed().length === 200);

		expect(listed()).toEqual(ids(200));
		expect(paged.calls.map((call) => call.limit)).toEqual([
			50, 50, 50, 150, 50,
		]);
		unmount();
	});

	it("loses no row when a next page is in flight during a reload", async () => {
		const paged = pagedApi();
		const { threads, unmount } = mount(paged);
		const listed = () => threads().getState().threadIds;

		await until(() => listed().length === 50);
		void threads().loadMore();
		await until(() => listed().length === 100);

		const release = paged.hold();

		void threads().loadMore();
		await settle();
		await act(async () => {
			await threads().reload();
		});
		release();
		await settle(100);

		expect(listed().slice(0, 100)).toEqual(ids(100));
		expect(listed()).toEqual(ids(listed().length));

		void threads().loadMore();
		await until(
			() => listed().length > 100 && !threads().getState().isLoadingMore,
		);

		expect(listed()).toEqual(ids(listed().length));
		unmount();
	});
});
