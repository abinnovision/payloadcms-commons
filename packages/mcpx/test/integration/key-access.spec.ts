import { Forbidden, NotFound } from "payload";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { API_KEYS_SLUG, bootPayload, createKey } from "./helpers/payload.js";

import type { Payload, TypedUser } from "payload";

const CACHE_KEY = "mcpx-integration-key-access";

interface KeyDoc {
	id: number | string;
	label: string;
	user: number | string | { id: number | string };
}

const ownerOf = (doc: KeyDoc): number | string =>
	typeof doc.user === "object" ? doc.user.id : doc.user;

/**
 * Keys are the credentials of the MCP endpoint, so one user reaching another
 * user's key through Payload's own API would be an impersonation.
 */
describe("api key collection isolation", () => {
	let payload: Payload;
	let alice: TypedUser;
	let bob: TypedUser;
	let seq = 0;

	beforeAll(async () => {
		({ payload } = await bootPayload({ key: CACHE_KEY }));

		const make = async (email: string): Promise<TypedUser> => ({
			...((await payload.create({
				collection: "users",
				data: { email, password: "isolation-secret" },
			})) as unknown as TypedUser),
			collection: "users",
		});

		alice = await make("alice@example.com");
		bob = await make("bob@example.com");
	});

	afterAll(async () => {
		await payload.destroy();
	});

	const seedBobKey = async (): Promise<KeyDoc> => {
		const label = `bob-${String(++seq)}`;

		await createKey(payload, {
			userId: bob.id,
			label,
			capabilities: { collections: { tags: { read: true } } },
		});

		const { docs } = await payload.find({
			collection: API_KEYS_SLUG as never,
			where: { label: { equals: label } },
			overrideAccess: true,
		});

		return docs[0] as unknown as KeyDoc;
	};

	const storedKey = async (id: number | string): Promise<KeyDoc | null> =>
		(await payload.findByID({
			collection: API_KEYS_SLUG as never,
			id,
			overrideAccess: true,
			disableErrors: true,
		})) as unknown as KeyDoc | null;

	it("does not read another user's key by id or by query", async () => {
		const key = await seedBobKey();

		await expect(
			payload.findByID({
				collection: API_KEYS_SLUG as never,
				id: key.id,
				overrideAccess: false,
				user: alice,
			}),
		).rejects.toThrow(NotFound);

		const listed = await payload.find({
			collection: API_KEYS_SLUG as never,
			overrideAccess: false,
			user: alice,
		});

		expect(listed.docs.map((doc) => doc.id)).not.toContain(key.id);

		const own = (await payload.findByID({
			collection: API_KEYS_SLUG as never,
			id: key.id,
			overrideAccess: false,
			user: bob,
		})) as unknown as KeyDoc;
		const ownListed = await payload.find({
			collection: API_KEYS_SLUG as never,
			overrideAccess: false,
			user: bob,
		});

		expect(own.id).toBe(key.id);
		expect(ownListed.docs.map((doc) => doc.id)).toContain(key.id);
	});

	it("does not update another user's key", async () => {
		const key = await seedBobKey();

		await expect(
			payload.update({
				collection: API_KEYS_SLUG as never,
				id: key.id,
				data: { label: "taken", enabled: false },
				overrideAccess: false,
				user: alice,
			}),
		).rejects.toThrow(Forbidden);

		const stored = await storedKey(key.id);

		expect(stored?.label).toBe(key.label);
		expect(stored && ownerOf(stored)).toBe(bob.id);

		await payload.update({
			collection: API_KEYS_SLUG as never,
			id: key.id,
			data: { label: "renamed" },
			overrideAccess: false,
			user: bob,
		});

		expect((await storedKey(key.id))?.label).toBe("renamed");
	});

	it("does not update another user's key through a bulk where", async () => {
		const key = await seedBobKey();

		const result = await payload.update({
			collection: API_KEYS_SLUG as never,
			where: { id: { equals: key.id } },
			data: { label: "taken" },
			overrideAccess: false,
			user: alice,
		});

		expect(result.docs).toHaveLength(0);
		expect((await storedKey(key.id))?.label).toBe(key.label);

		const own = await payload.update({
			collection: API_KEYS_SLUG as never,
			where: { id: { equals: key.id } },
			data: { label: "renamed" },
			overrideAccess: false,
			user: bob,
		});

		expect(own.docs).toHaveLength(1);
		expect((await storedKey(key.id))?.label).toBe("renamed");
	});

	it("does not delete another user's key", async () => {
		const key = await seedBobKey();

		await expect(
			payload.delete({
				collection: API_KEYS_SLUG as never,
				id: key.id,
				overrideAccess: false,
				user: alice,
			}),
		).rejects.toThrow(Forbidden);

		const bulk = await payload.delete({
			collection: API_KEYS_SLUG as never,
			where: { id: { equals: key.id } },
			overrideAccess: false,
			user: alice,
		});

		expect(bulk.docs).toHaveLength(0);
		expect(await storedKey(key.id)).not.toBeNull();

		await payload.delete({
			collection: API_KEYS_SLUG as never,
			id: key.id,
			overrideAccess: false,
			user: bob,
		});

		expect(await storedKey(key.id)).toBeNull();
	});

	it("does not create a key bound to another user", async () => {
		const label = `forged-${String(++seq)}`;

		const created = (await payload.create({
			collection: API_KEYS_SLUG as never,
			data: {
				label,
				user: bob.id,
				capabilities: { collections: { tags: { read: true } } },
			},
			overrideAccess: false,
			user: alice,
		})) as unknown as KeyDoc;

		expect(ownerOf(created)).toBe(alice.id);

		const boundToBob = await payload.find({
			collection: API_KEYS_SLUG as never,
			where: {
				and: [{ label: { equals: label } }, { user: { equals: bob.id } }],
			},
			overrideAccess: true,
		});

		expect(boundToBob.totalDocs).toBe(0);
	});

	it("does not rebind an own key to another user", async () => {
		const label = `own-${String(++seq)}`;
		const created = (await payload.create({
			collection: API_KEYS_SLUG as never,
			data: { label },
			overrideAccess: false,
			user: alice,
		})) as unknown as KeyDoc;

		await payload.update({
			collection: API_KEYS_SLUG as never,
			id: created.id,
			data: { user: bob.id },
			overrideAccess: false,
			user: alice,
		});

		const stored = await storedKey(created.id);

		expect(stored && ownerOf(stored)).toBe(alice.id);
	});
});
