import { withMcpxAuth } from "@abinnovision/payloadcms-mcpx";
import { describe, expect, it } from "vitest";

import { flueThreadScoped, SCOPE_SETTINGS_KEY } from "./scope.js";

import type { ScopeSettings } from "./scope.js";
import type { PayloadRequest } from "payload";

const settings = {
	mcpx: { userCollection: "users" },
	files: "uploads",
} satisfies ScopeSettings;

const USER = { id: 1, collection: "users" };

// A request as user 1, authenticated by an agent token of `thread` when given.
const requestOf = ({
	installed = true,
	thread,
}: { installed?: boolean; thread?: string } = {}): PayloadRequest =>
	({
		context: {},
		user:
			thread === undefined
				? USER
				: withMcpxAuth(
						{ ...USER, _strategy: "flue-token" },
						{ principal: `flue-thread:${thread}`, capabilities: {} },
					),
		payload: {
			config: { custom: installed ? { [SCOPE_SETTINGS_KEY]: settings } : {} },
		},
	}) as unknown as PayloadRequest;

const scoped = flueThreadScoped(() => true);

describe("flueThreadScoped", () => {
	it("defaults to the files the requesting user created", async () => {
		await expect(
			flueThreadScoped()({ req: requestOf(), slug: "uploads" }),
		).resolves.toEqual({
			and: [
				{ "createdBy.relationTo": { equals: "users" } },
				{ "createdBy.value": { equals: 1 } },
			],
		});
	});

	it("refuses by default without a user, from another collection or without the plugin", async () => {
		const req = requestOf();

		await expect(
			flueThreadScoped()({ req: { ...req, user: null }, slug: "uploads" }),
		).resolves.toBe(false);
		await expect(
			flueThreadScoped()({
				req: { ...req, user: { id: 1, collection: "admins" } },
				slug: "uploads",
			}),
		).resolves.toBe(false);
		await expect(
			flueThreadScoped()({
				req: requestOf({ installed: false }),
				slug: "uploads",
			}),
		).resolves.toBe(false);
	});

	it("passes the wrapped result through for a request without a token", async () => {
		const own = { createdBy: { equals: 1 } };

		await expect(
			flueThreadScoped(() => own)({ req: requestOf(), slug: "uploads" }),
		).resolves.toBe(own);
	});

	it("leaves a request of another strategy alone", async () => {
		const req = requestOf({ thread: "7" });
		const other = {
			...req,
			user: withMcpxAuth(
				{ ...USER, _strategy: "other" },
				{ principal: "flue-thread:7", capabilities: {} },
			),
		} as unknown as PayloadRequest;

		await expect(scoped({ req: other, slug: "uploads" })).resolves.toBe(true);
	});

	it("keeps what the wrapped access refuses", async () => {
		await expect(
			flueThreadScoped(() => false)({
				req: requestOf({ thread: "7" }),
				slug: "uploads",
			}),
		).resolves.toBe(false);
	});

	it("narrows a wrapped query to the token's thread", async () => {
		const base = { createdBy: { equals: 1 } };

		await expect(
			flueThreadScoped(() => base)({
				req: requestOf({ thread: "7" }),
				slug: "uploads",
			}),
		).resolves.toEqual({ and: [base, { flueThread: { equals: "7" } }] });
	});

	it("refuses a token on another collection", async () => {
		await expect(
			scoped({ req: requestOf({ thread: "7" }), slug: "pages" }),
		).resolves.toBe(false);
	});
});
