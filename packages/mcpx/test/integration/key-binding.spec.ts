import { createLocalReq } from "payload";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { API_KEYS_SLUG, bootPayload } from "./helpers/payload.js";

import type { Payload, TypedUser } from "payload";

/**
 * A key acts as its user, so letting a creator pick the user would let anyone
 * mint a key that impersonates anyone. The `user` field denies create access
 * and its default binds to the creator; this proves the two line up.
 */
describe("api key to user binding", () => {
	let payload: Payload;
	let creator: TypedUser;
	let other: { id: number | string };

	beforeAll(async () => {
		({ payload } = await bootPayload());

		const make = async (email: string) =>
			(await payload.create({
				collection: "users" as never,
				data: { email, password: "binding-secret" },
			})) as unknown as TypedUser;

		creator = { ...(await make("creator@example.com")), collection: "users" };
		other = await make("other@example.com");
	});

	afterAll(async () => {
		await payload.destroy();
	});

	it("binds a key to its creator even when another user is supplied", async () => {
		const req = await createLocalReq({ user: creator }, payload);

		const created = (await payload.create({
			collection: API_KEYS_SLUG as never,
			data: {
				label: "bound",
				user: other.id,
				capabilities: { collections: { pages: { read: true } } },
			},
			overrideAccess: false,
			req,
		})) as unknown as { user: number | string | { id: number | string } };

		const boundTo =
			typeof created.user === "object" ? created.user.id : created.user;

		expect(boundTo).toBe(creator.id);
		expect(boundTo).not.toBe(other.id);
	});
});
