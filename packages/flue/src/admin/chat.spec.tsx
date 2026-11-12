// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { flueApi } from "./api.js";
import { documentRegistry } from "./document.js";
import { POLL_MS } from "./threads-view.js";

import type {
	ChatResult,
	FlueApi,
	ThreadDoc,
	ThreadFilter,
	ThreadState,
} from "./api.js";
import type { FlueChatProps } from "./chat.js";
import type { DocumentRegistry, OpenDocument } from "./document.js";
import type { Keyset } from "./keyset.js";
import type { AttachmentLimits } from "../protocol/attachments.js";
import type { ReactNode } from "react";

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

/*
 * The real module pulls in the whole admin bundle, including its styles. The
 * panel runs on the dashboard, outside any document, unless a test opens one.
 */
const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }));

let pathname = "/admin";

vi.mock("@payloadcms/ui", () => ({
	toast: { error: toastError },
	useConfig: () => ({
		config: { serverURL: "", routes: { admin: "/admin", api: "/api" } },
	}),
	useLocale: () => undefined,
	usePathname: () => pathname,
	useSearchParams: () => new URLSearchParams(),
	PayloadLink: ({ children }: { children: ReactNode }) => <a>{children}</a>,
	CheckIcon: () => <svg />,
	ChevronIcon: () => <svg />,
	CircledXIcon: () => <svg />,
	CopyIcon: () => <svg />,
	PlusIcon: () => <svg />,
	SearchIcon: () => <svg />,
	SpinnerIcon: () => <svg />,
	XIcon: () => <svg />,
}));

const { FlueChat } = await import("./chat.js");

const NOW = Date.now();
const ago = (ms: number): string => new Date(NOW - ms).toISOString();

// One hundred and twenty chats, newest first; the first one runs.
const chats = (): ThreadDoc[] =>
	Array.from({ length: 120 }, (_, index) => ({
		id: 1000 - index,
		agent: "editor",
		title: `Thread ${String(index)}`,
		status: index === 0 ? "running" : "idle",
		kind: "chat",
		createdBy: { relationTo: "users", value: 7 },
		lastMessageAt: ago(60_000 + index * 60_000),
		lastReadAt: index === 70 ? null : ago(60_000 + index * 60_000),
	}));

// A chat deeper than any loaded page, with a message the user has not read.
const OUTSIDE: ThreadDoc = {
	id: 5,
	agent: "editor",
	title: "Old thread",
	status: "idle",
	kind: "chat",
	createdBy: { relationTo: "users", value: 7 },
	lastMessageAt: ago(90 * 86_400_000),
};

// Two runs of an agent the user cannot chat with, between the chats.
const RUNS: ThreadDoc[] = [
	{
		id: 2001,
		agent: "auditor",
		title: "Nightly link check",
		status: "idle",
		kind: "ambient",
		createdBy: { relationTo: "users", value: 99 },
		lastMessageAt: ago(90_000),
	},
	{
		id: 2002,
		agent: "editor",
		title: "Review new article",
		status: "failed",
		kind: "reactive",
		createdBy: { relationTo: "users", value: 99 },
		lastMessageAt: ago(150_000),
	},
];

// Whether the threads collection lists the row for `filter`.
const matches = (row: ThreadDoc, filter: ThreadFilter): boolean =>
	(filter.kind === "chat" ? row.kind === "chat" : row.kind !== "chat") &&
	(filter.agent === undefined ||
		(typeof filter.agent === "string"
			? row.agent === filter.agent
			: filter.agent.includes(row.agent))) &&
	(filter.title === undefined || (row.title ?? "").includes(filter.title));

const below = (row: ThreadDoc, after: Keyset): boolean =>
	Date.parse(row.lastMessageAt ?? "") < Date.parse(after.lastMessageAt) ||
	(row.lastMessageAt === after.lastMessageAt &&
		Number(row.id) < Number(after.id));

interface Server {
	api: FlueApi;
	rows: ThreadDoc[];
	threads: ReturnType<typeof vi.fn>;
	thread: ReturnType<typeof vi.fn>;
	markRead: ReturnType<typeof vi.fn>;
	reconcile: ReturnType<typeof vi.fn>;
	threadStates: ReturnType<typeof vi.fn>;
	/** Fails the next page asked for after a cursor. */
	failNext: () => void;
}

// The threads collection as the panel's API sees it, over `rows`.
const server = (rows: ThreadDoc[] = chats()): Server => {
	let fail = false;
	const base = flueApi({
		serverURL: "",
		apiRoute: "/api",
		endpointPath: "/flue",
		threadsSlug: "flue-threads",
		mcpxEndpointPath: "/mcpx",
	});
	const threads = vi.fn(
		(
			filter: ThreadFilter,
			page: { limit: number; after?: Keyset | undefined },
		) => {
			if (page.after !== undefined && fail) {
				fail = false;

				return Promise.reject(new Error("The request failed with status 500."));
			}

			const { after } = page;
			const rest = rows.filter(
				(row) =>
					matches(row, filter) && (after === undefined || below(row, after)),
			);

			return Promise.resolve({
				docs: rest.slice(0, page.limit),
				hasNextPage: rest.length > page.limit,
			});
		},
	);
	const thread = vi.fn((id: number | string) => {
		const row = [...rows, OUTSIDE, ...RUNS].find(
			(entry) => String(entry.id) === String(id),
		);

		return row ? Promise.resolve(row) : Promise.reject(new Error("Not Found"));
	});
	const markRead = vi.fn(() => Promise.resolve({}));
	const reconcile = vi.fn(() => Promise.resolve());
	const threadStates = vi.fn(
		(ids: readonly (number | string)[]): Promise<ThreadState[]> =>
			Promise.resolve(
				rows
					.filter((row) => ids.map(String).includes(String(row.id)))
					.map(({ id, status, lastMessageAt }) => ({
						id,
						status,
						lastMessageAt: lastMessageAt ?? null,
					})),
			),
	);

	return {
		api: { ...base, threads, thread, markRead, reconcile, threadStates },
		rows,
		threads,
		thread,
		markRead,
		reconcile,
		threadStates,
		failNext: () => {
			fail = true;
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
		throw new Error("The panel did not reach the expected state.");
	}

	await settle(20);
	await until(check, attempts - 1);
};

/*
 * Mounts the chat with its props held as the provider holds them: the
 * thread it reports opening comes back as `threadId`.
 */
const mount = (
	api: FlueApi,
	props: Partial<FlueChatProps> = {},
	registry: DocumentRegistry = documentRegistry(),
) => {
	const container = document.createElement("div");
	const root = createRoot(container);
	const onView = vi.fn();
	let current = props;
	const chat = () => (
		<FlueChat
			agent="editor"
			agents={[{ slug: "editor", label: "Editor" }]}
			api={api}
			chosen={false}
			onAgent={() => undefined}
			onClose={() => undefined}
			onOpenThread={() => undefined}
			onResize={() => undefined}
			onResizeEnd={() => undefined}
			onRunning={() => undefined}
			onThreadId={onThreadId}
			onView={onView}
			open
			registry={registry}
			threadId={undefined}
			userCollection="users"
			userId={7}
			view="threads"
			width={420}
			{...current}
		/>
	);
	const rerender = (overrides: Partial<FlueChatProps>): void => {
		current = { ...current, ...overrides };
		act(() => {
			root.render(chat());
		});
	};

	// The provider keeps the thread the chat reports, as `threadId`.
	const onThreadId = vi.fn((threadId: string | undefined) => {
		current = { ...current, threadId };
		root.render(chat());
	});

	document.body.append(container);
	act(() => {
		root.render(chat());
	});

	return {
		container,
		onView,
		onThreadId,
		rows: () => container.querySelectorAll(".flue-row__trigger").length,
		titles: () =>
			[...container.querySelectorAll(".flue-row__title")].map(
				(title) => title.textContent,
			),
		click: (text: string) => {
			const button = [...container.querySelectorAll("button")].find(
				(entry) => entry.textContent === text,
			);

			if (!button) {
				throw new Error(`No button "${text}".`);
			}

			act(() => {
				button.click();
			});
		},
		type: (text: string) => {
			const search = container.querySelector<HTMLInputElement>(
				".flue-search__input",
			)!;

			act(() => {
				Object.getOwnPropertyDescriptor(
					HTMLInputElement.prototype,
					"value",
				)!.set!.call(search, text);
				search.dispatchEvent(new Event("input", { bubbles: true }));
			});
		},
		rerender,
		unmount: () => {
			act(() => {
				root.unmount();
			});
			container.remove();
		},
	};
};

beforeEach(() => {
	// The open thread's conversation is not needed; the sidecar has none.
	vi.stubGlobal("fetch", () =>
		Promise.resolve(Response.json({ error: "Not found." }, { status: 404 })),
	);
});

afterEach(() => {
	pathname = "/admin";
	vi.useRealTimers();
	vi.unstubAllGlobals();
	toastError.mockClear();
});

describe("the FlueChat component", () => {
	it("tells the user an agent has no conversations yet", async () => {
		const panel = mount(server([]).api);

		await until(
			() => panel.container.querySelector(".flue-threads__state") !== null,
		);

		expect(panel.container.textContent).toContain(
			"No conversations with Editor yet.",
		);
		panel.unmount();
	});

	it("loads the next page again with Retry after it failed", async () => {
		const backend = server();
		const panel = mount(backend.api);

		await until(() => panel.rows() === 50);
		backend.failNext();
		panel.click("Load more");
		await until(() =>
			panel.container.textContent.includes("More threads could not be loaded."),
		);
		panel.click("Retry");
		await until(() => panel.rows() === 100);

		expect(panel.container.textContent).not.toContain(
			"More threads could not be loaded.",
		);
		panel.unmount();
	});

	it("marks a thread on a later page read from the loaded rows", async () => {
		const backend = server();
		const panel = mount(backend.api);

		await until(() => panel.rows() === 50);
		panel.click("Load more");
		await until(() => panel.rows() === 100);
		panel.rerender({ threadId: "930" });
		await until(() => backend.markRead.mock.calls.length === 1);

		expect(backend.markRead).toHaveBeenCalledWith(
			930,
			backend.rows[70]!.lastMessageAt,
		);
		expect(backend.thread).not.toHaveBeenCalled();
		panel.unmount();
	});

	it("reads a thread outside the loaded rows to mark it read", async () => {
		const backend = server();
		const panel = mount(backend.api);

		await until(() => panel.rows() === 50);
		panel.rerender({ threadId: "5" });
		await until(() => backend.markRead.mock.calls.length === 1);

		expect(backend.thread).toHaveBeenCalledWith("5");
		expect(backend.markRead).toHaveBeenCalledWith(5, OUTSIDE.lastMessageAt);
		panel.unmount();
	});

	it("reloads every loaded page and reads a stale run when a poll finds it changed", async () => {
		vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });

		const backend = server();
		const panel = mount(backend.api);

		await until(() => panel.rows() === 50);
		panel.click("Load more");
		await until(() => panel.rows() === 100);

		expect(backend.reconcile).not.toHaveBeenCalled();

		// The running thread's last message is older than the list knew.
		backend.rows[0] = { ...backend.rows[0]!, lastMessageAt: ago(10 * 60_000) };
		act(() => {
			vi.advanceTimersByTime(POLL_MS);
		});
		await until(() => backend.reconcile.mock.calls.length === 1);
		await until(() => backend.threads.mock.calls.length === 3);

		expect(backend.threadStates).toHaveBeenCalledWith(["1000"]);
		expect(backend.reconcile).toHaveBeenCalledWith("1000");
		expect(backend.threads.mock.calls[2]![1]).toEqual({
			limit: 100,
			after: undefined,
		});
		await settle();
		expect(panel.rows()).toBe(100);
		panel.unmount();
	});

	it("clears the search on Escape, then returns to the conversation", async () => {
		const panel = mount(server().api);
		const search = panel.container.querySelector<HTMLInputElement>(
			".flue-search__input",
		)!;
		const escape = (): void => {
			act(() => {
				search.dispatchEvent(
					new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
				);
			});
		};

		await until(() => panel.rows() === 50);
		act(() => {
			const setValue = Object.getOwnPropertyDescriptor(
				HTMLInputElement.prototype,
				"value",
			)!.set!;

			setValue.call(search, "Thread 7");
			search.dispatchEvent(new Event("input", { bubbles: true }));
		});
		expect(search.value).toBe("Thread 7");

		escape();
		expect(search.value).toBe("");
		expect(panel.onView).not.toHaveBeenCalled();

		escape();
		expect(panel.onView).toHaveBeenCalledWith("conversation");
		panel.unmount();
	});

	it("lists the runs of every agent read-only and opens one in place", async () => {
		const backend = server([...RUNS, ...chats()]);
		const onOpenThread = vi.fn();
		const panel = mount(backend.api, {
			onOpenThread,
			runAgents: [
				{ slug: "editor", label: "Editor" },
				{ slug: "auditor", label: "Auditor" },
			],
		});
		const runRows = () =>
			[...panel.container.querySelectorAll(".flue-row")].map(
				(row) => row.textContent,
			);

		await until(() => panel.rows() === 50);
		panel.click("Runs");
		await until(() => panel.rows() === 2);

		expect(runRows()).toEqual([
			expect.stringContaining("Nightly link checkAuditor · Scheduled"),
			expect.stringContaining("Review new articleEditor · Triggered"),
		]);
		expect(panel.container.querySelector(".flue-row__archive")).toBeNull();
		expect(backend.threads).toHaveBeenLastCalledWith(
			{ kind: "run" },
			{ limit: 50, after: undefined },
		);

		panel.click(runRows()[0]!);
		expect(panel.onThreadId).toHaveBeenCalledWith("2001");
		expect(onOpenThread).not.toHaveBeenCalled();

		// The runtime opened the run; the Chats list does not show it.
		await until(() => backend.thread.mock.calls.length > 0);
		panel.click("Chats");
		await until(() => panel.rows() === 50);
		await settle(100);

		expect(panel.rows()).toBe(50);
		expect(panel.titles()).not.toContain("Nightly link check");
		panel.unmount();
	});

	it("narrows the runs to one agent", async () => {
		const backend = server([...RUNS, ...chats()]);
		const panel = mount(backend.api, {
			agent: undefined,
			agents: [],
			runAgents: [
				{ slug: "editor", label: "Editor" },
				{ slug: "auditor", label: "Auditor" },
			],
		});

		await until(() => panel.rows() === 2);

		const filter = panel.container.querySelector<HTMLSelectElement>(
			'select[aria-label="Agent of the runs"]',
		)!;

		act(() => {
			filter.value = "auditor";
			filter.dispatchEvent(new Event("change", { bubbles: true }));
		});
		await until(() => panel.rows() === 1);

		expect(backend.threads).toHaveBeenLastCalledWith(
			{ kind: "run", agent: "auditor" },
			{ limit: 50, after: undefined },
		);
		expect(panel.container.querySelector('[role="tablist"]')).toBeNull();
		panel.unmount();
	});

	it("moves between the Chats and Runs tabs with the arrow keys", async () => {
		const panel = mount(server([...RUNS, ...chats()]).api, {
			runAgents: [{ slug: "editor", label: "Editor" }],
		});
		const tab = (name: string) =>
			panel.container.querySelector<HTMLElement>(`#flue-threads-tab-${name}`)!;
		const press = (key: string): void => {
			act(() => {
				document.activeElement?.dispatchEvent(
					new KeyboardEvent("keydown", { key, bubbles: true }),
				);
			});
		};

		await until(() => panel.rows() === 50);
		tab("chats").focus();
		press("ArrowRight");

		expect(tab("runs").getAttribute("aria-selected")).toBe("true");
		expect(document.activeElement).toBe(tab("runs"));

		press("ArrowLeft");

		expect(tab("chats").getAttribute("aria-selected")).toBe("true");
		expect(document.activeElement).toBe(tab("chats"));
		panel.unmount();
	});

	it("places a chat it opened beyond the loaded pages by its message time", async () => {
		const panel = mount(server().api);

		await until(() => panel.rows() === 50);
		panel.rerender({ threadId: "5" });
		await until(() => panel.rows() === 51);

		expect(panel.titles()[0]).toBe("Thread 0");
		expect(panel.titles().at(-1)).toBe("Old thread");
		panel.unmount();
	});

	it("polls nothing while the panel is closed and reloads the list on opening", async () => {
		vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });

		const backend = server();
		const panel = mount(backend.api, { open: false });

		await until(() => panel.rows() === 50);
		act(() => {
			vi.advanceTimersByTime(POLL_MS);
		});

		expect(backend.threadStates).not.toHaveBeenCalled();
		expect(backend.threads).toHaveBeenCalledTimes(1);

		panel.rerender({ open: true });
		await until(() => backend.threads.mock.calls.length === 2);
		act(() => {
			vi.advanceTimersByTime(POLL_MS);
		});
		await until(() => backend.threadStates.mock.calls.length === 1);

		expect(backend.threads.mock.calls[1]![1]).toEqual({
			limit: 50,
			after: undefined,
		});
		panel.unmount();
	});

	it("opens a search hit of another agent by switching the agent", async () => {
		const hit: ThreadDoc = {
			id: 3001,
			agent: "summarizer",
			title: "Summary hit",
			status: "idle",
			kind: "chat",
			createdBy: { relationTo: "users", value: 7 },
			lastMessageAt: ago(30_000),
		};
		const onOpenThread = vi.fn();
		const panel = mount(server([hit, ...chats()]).api, {
			agents: [
				{ slug: "editor", label: "Editor" },
				{ slug: "summarizer", label: "Summarizer" },
			],
			onOpenThread,
		});

		await until(() => panel.rows() === 50);
		panel.type("Summary");
		await until(() => panel.rows() === 1);

		expect(panel.titles()).toEqual(["Summary hit"]);

		panel.click(
			panel.container.querySelector(".flue-row__trigger")!.textContent,
		);

		expect(onOpenThread).toHaveBeenCalledWith("summarizer", "3001");
		expect(panel.onThreadId).not.toHaveBeenCalled();
		panel.unmount();
	});
});

describe("attachments in the FlueChat composer", () => {
	const LIMITS: AttachmentLimits = {
		mimeTypes: ["image/png", "application/pdf"],
		maxImageBytes: 3_932_160,
		maxDocumentBytes: 5_242_880,
		maxFiles: 4,
	};

	const RESULT: ChatResult = {
		thread: { id: 1001, status: "running", title: "dot.png" },
		offset: "-1",
		streamUrl: "/api/flue/c/1001",
		submissionId: "sub_1",
	};

	const mountComposer = (chat: FlueApi["chat"]) => {
		const { api } = server([]);
		const panel = mount(
			{ ...api, chat },
			{ attachments: LIMITS, view: "conversation" },
		);

		return {
			...panel,
			// Picks a file through the input the Attach button opens.
			pick: (file: File): HTMLInputElement => {
				panel.click("Attach");

				const input =
					document.body.querySelector<HTMLInputElement>('input[type="file"]')!;

				Object.defineProperty(input, "files", { value: [file] });
				act(() => {
					input.dispatchEvent(new Event("change"));
				});

				return input;
			},
			write: (text: string) => {
				const input = panel.container.querySelector<HTMLTextAreaElement>(
					'textarea[aria-label="Message"]',
				)!;

				act(() => {
					Object.getOwnPropertyDescriptor(
						HTMLTextAreaElement.prototype,
						"value",
					)!.set!.call(input, text);
					input.dispatchEvent(new Event("input", { bubbles: true }));
				});
			},
			attached: () =>
				[
					...panel.container.querySelectorAll(
						".flue-composer .flue-attachment__name",
					),
				].map((name) => name.textContent),
		};
	};

	it("sends a picked image in base64 with the message", async () => {
		const chat = vi.fn(() => Promise.resolve(RESULT));
		const panel = mountComposer(chat);
		const input = panel.pick(
			new File(["png"], "dot.png", { type: "image/png" }),
		);

		expect(input.accept).toBe("image/png,application/pdf");
		await until(() => panel.attached().length === 1);
		expect(panel.attached()).toEqual(["dot.png"]);

		panel.write("What is this?");
		panel.click("Send");
		await until(() => chat.mock.calls.length === 1);

		expect(chat).toHaveBeenCalledWith("editor", {
			message: "What is this?",
			thread: undefined,
			context: { route: "/admin" },
			attachments: [
				{
					type: "image",
					data: btoa("png"),
					mimeType: "image/png",
					filename: "dot.png",
				},
			],
		});
		panel.unmount();
	});

	it("refuses an image over its limit with an error", async () => {
		const panel = mountComposer(vi.fn());

		panel.pick(
			new File(["x".repeat(3_932_161)], "big.png", { type: "image/png" }),
		);
		await until(() => toastError.mock.calls.length > 0);

		expect(toastError).toHaveBeenCalledWith("big.png is larger than 3.75 MiB.");
		expect(panel.attached()).toEqual([]);
		panel.unmount();
	});

	it("puts the text and files back into the composer when the send fails", async () => {
		const chat = vi.fn(() => Promise.reject(new Error("Too large.")));
		const panel = mountComposer(chat);

		panel.pick(new File(["%PDF-1"], "brief.pdf", { type: "application/pdf" }));
		await until(() => panel.attached().length === 1);
		panel.write("Summarize");
		panel.click("Send");
		await until(() => chat.mock.calls.length === 1);
		await until(() => panel.attached().length === 1);

		expect(panel.attached()).toEqual(["brief.pdf"]);
		expect(
			panel.container.querySelector<HTMLTextAreaElement>(
				'textarea[aria-label="Message"]',
			)!.value,
		).toBe("Summarize");
		expect(toastError).toHaveBeenCalledWith("Too large.");
		panel.unmount();
	});
});

describe("the open document in the FlueChat composer", () => {
	const RESULT: ChatResult = {
		thread: { id: 1001, status: "running", title: "Shorter" },
		offset: "-1",
		streamUrl: "/api/flue/c/1001",
		submissionId: "sub_1",
	};

	// What the chat did with the open document, in order.
	let events: string[] = [];

	const openDocument = (state: {
		modified: boolean;
		drafts: boolean;
	}): DocumentRegistry => {
		const registry = documentRegistry();
		const document: OpenDocument = {
			collection: "pages",
			id: "12",
			drafts: state.drafts,
			modified: () => state.modified,
			stale: () => false,
			focus: () => "hero.title",
			saveDraft: async () => {
				events.push("save started");
				await settle(20);
				events.push("saved");
			},
			reload: () => undefined,
		};

		registry.register(document);
		pathname = "/admin/collections/pages/12";

		return registry;
	};

	const send = (registry: DocumentRegistry) => {
		const chat = vi.fn(() => {
			events.push("chat");

			return Promise.resolve(RESULT);
		});
		const panel = mount(
			{ ...server([]).api, chat },
			{ view: "conversation" },
			registry,
		);
		const input = panel.container.querySelector<HTMLTextAreaElement>(
			'textarea[aria-label="Message"]',
		)!;

		act(() => {
			Object.getOwnPropertyDescriptor(
				HTMLTextAreaElement.prototype,
				"value",
			)!.set!.call(input, "Make it shorter");
			input.dispatchEvent(new Event("input", { bubbles: true }));
		});
		panel.click("Send");

		return { panel, chat, input };
	};

	beforeEach(() => {
		events = [];
	});

	it("saves unsaved edits as a draft before the message goes out", async () => {
		const { panel, chat } = send(
			openDocument({ modified: true, drafts: true }),
		);

		await until(() => chat.mock.calls.length === 1);

		expect(events).toEqual(["save started", "saved", "chat"]);
		expect(chat).toHaveBeenCalledWith("editor", {
			message: "Make it shorter",
			thread: undefined,
			context: {
				route: "/admin/collections/pages/12",
				collection: "pages",
				id: "12",
				focus: "hero.title",
			},
		});
		panel.unmount();
	});

	it("refuses to send unsaved edits of a document without drafts", async () => {
		const { panel, chat, input } = send(
			openDocument({ modified: true, drafts: false }),
		);

		await until(() => toastError.mock.calls.length > 0);

		expect(toastError).toHaveBeenCalledWith(
			"Save the document before asking the agent.",
		);
		expect(chat).not.toHaveBeenCalled();
		expect(events).toEqual([]);
		await until(() => input.value === "Make it shorter");
		panel.unmount();
	});

	it("sends without saving when the form has no unsaved edits", async () => {
		const { panel, chat } = send(
			openDocument({ modified: false, drafts: true }),
		);

		await until(() => chat.mock.calls.length === 1);

		expect(events).toEqual(["chat"]);
		panel.unmount();
	});
});
