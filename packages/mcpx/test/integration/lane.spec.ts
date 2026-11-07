import { payloadMajor } from "@internal/test-utils/payload-major";
import * as payloadModule from "payload";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { bootPayload } from "./helpers/payload.js";

import type { Booted } from "./helpers/payload.js";

describe("payload lane", () => {
	let booted: Booted;

	beforeAll(async () => {
		booted = await bootPayload({ key: "mcpx-lane" });
	});

	afterAll(async () => {
		await booted.payload.destroy();
	});

	it("loads the Payload major the run targets", () => {
		const isV4 = payloadMajor() === 4;

		expect("createLocalReq" in payloadModule).toBe(!isV4);
		expect("createFolderField" in payloadModule).toBe(isV4);
	});

	it("raises NotFound for a missing document", async () => {
		await expect(
			booted.payload.findByID({
				collection: "users",
				id: 999999,
				overrideAccess: true,
			}),
		).rejects.toBeInstanceOf(payloadModule.NotFound);
	});

	it("raises ValidationError for a duplicate unique value", async () => {
		const data = { email: "dup@example.com", password: "secret" };
		await booted.payload.create({
			collection: "users",
			data,
			overrideAccess: true,
		});

		await expect(
			booted.payload.create({
				collection: "users",
				data,
				overrideAccess: true,
			}),
		).rejects.toBeInstanceOf(payloadModule.ValidationError);
	});
});
