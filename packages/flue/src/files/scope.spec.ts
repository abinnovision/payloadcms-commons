import { describe, expect, it, vi } from "vitest";

import { flueThreadScoped, SCOPE_SETTINGS_KEY } from "./scope.js";

import type { ScopeSettings } from "./scope.js";
import type { FlueAgentConfig } from "../types.js";
import type { PayloadRequest } from "payload";

const settings = {
	agents: [{ slug: "editor", capabilities: {} } satisfies FlueAgentConfig],
	threads: { slug: "flue-threads", readAgentRuns: () => false },
	mcpx: {
		apiKeysSlug: "mcpx-api-keys",
		userCollection: "users",
		endpointPath: "/mcpx",
		mcpPath: "/api/mcpx",
	},
	files: "uploads",
} satisfies ScopeSettings;

const KEY = {
	managedBy: "flue:editor",
	user: 1,
	enabled: true,
	expiresAt: new Date(Date.now() + 60_000).toISOString(),
};

const THREAD = {
	id: 7,
	agent: "editor",
	kind: "chat",
	status: "active",
	createdBy: { relationTo: "users", value: 1 },
};

// A request as user 1 whose key lookup answers `key`.
const requestOf = (
	context: Record<string, unknown>,
	{
		installed = true,
		handle,
		findByID = () => Promise.resolve(KEY),
	}: {
		installed?: boolean;
		handle?: string;
		findByID?: () => Promise<unknown>;
	} = {},
): PayloadRequest =>
	({
		context,
		user: { id: 1, collection: "users" },
		headers: new Headers(handle ? { "x-flue-handle": handle } : {}),
		payload: {
			config: { custom: installed ? { [SCOPE_SETTINGS_KEY]: settings } : {} },
			findByID,
			find: () => Promise.resolve({ docs: [THREAD] }),
			logger: { error: () => undefined },
		},
	}) as unknown as PayloadRequest;

const agent = () => ({ mcpx: { apiKeyId: 1 } });
const scoped = flueThreadScoped(() => true);

describe("flueThreadScoped", () => {
	it("defaults to Payload's access: logged-in users only", async () => {
		const req = requestOf({});

		await expect(flueThreadScoped()({ req, slug: "uploads" })).resolves.toBe(
			true,
		);
		await expect(
			flueThreadScoped()({ req: { ...req, user: null }, slug: "uploads" }),
		).resolves.toBe(false);
	});

	it("passes the wrapped result through for a request without mcpx", async () => {
		const own = { createdBy: { equals: 1 } };

		await expect(
			flueThreadScoped(() => own)({ req: requestOf({}), slug: "uploads" }),
		).resolves.toBe(own);
	});

	it("leaves the in-process mcpx client alone", async () => {
		await expect(
			scoped({
				req: requestOf({ mcpx: { capabilities: {} } }),
				slug: "uploads",
			}),
		).resolves.toBe(true);
	});

	it("refuses a flue-managed key without the handle header", async () => {
		await expect(
			scoped({ req: requestOf(agent()), slug: "uploads" }),
		).resolves.toBe(false);
	});

	it("passes through when the plugin is not installed", async () => {
		await expect(
			scoped({
				req: requestOf(agent(), { installed: false }),
				slug: "uploads",
			}),
		).resolves.toBe(true);
	});

	it("keeps what the wrapped access refuses", async () => {
		await expect(
			flueThreadScoped(() => false)({ req: requestOf({}), slug: "uploads" }),
		).resolves.toBe(false);
	});

	it("narrows a wrapped query to the handle's thread", async () => {
		const base = { createdBy: { equals: 1 } };

		await expect(
			flueThreadScoped(() => base)({
				req: requestOf(agent(), { handle: "h" }),
				slug: "uploads",
			}),
		).resolves.toEqual({ and: [base, { flueThread: { equals: 7 } }] });
	});

	it("refuses a valid handle on another collection", async () => {
		await expect(
			scoped({ req: requestOf(agent(), { handle: "h" }), slug: "pages" }),
		).resolves.toBe(false);
	});

	it("resolves the scope once per request", async () => {
		const findByID = vi.fn(() => Promise.resolve(KEY));
		const req = requestOf(agent(), { handle: "h", findByID });

		await scoped({ req, slug: "uploads" });
		await scoped({ req, slug: "uploads" });

		expect(findByID).toHaveBeenCalledTimes(1);
	});

	it("refuses when resolving fails", async () => {
		await expect(
			scoped({
				req: requestOf(agent(), {
					handle: "h",
					findByID: () => Promise.reject(new Error("down")),
				}),
				slug: "uploads",
			}),
		).resolves.toBe(false);
	});
});
