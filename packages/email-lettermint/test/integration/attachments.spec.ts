import { Buffer } from "node:buffer";
import { Readable } from "node:stream";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { bootPayload } from "./helpers/payload.js";

import type { LettermintSendRequest } from "../../src/message.js";
import type { Payload } from "payload";

const sent: RequestInit[] = [];

const stubLettermint = (): void => {
	vi.stubGlobal(
		"fetch",
		vi.fn((_url: string, init: RequestInit) => {
			sent.push(init);

			return Promise.resolve(
				new Response(JSON.stringify({ message_id: "m", status: "pending" }), {
					status: 202,
					headers: { "content-type": "application/json" },
				}),
			);
		}),
	);
};

const lastBody = (): LettermintSendRequest =>
	JSON.parse(sent.at(-1)?.body as string) as LettermintSendRequest;

describe("attachments through Payload", () => {
	let payload: Payload;

	beforeAll(async () => {
		payload = await bootPayload("lettermint-attachments");
	});

	afterEach(() => {
		sent.length = 0;
		vi.unstubAllGlobals();
	});

	it("carries binary content through base64 without corrupting it", async () => {
		stubLettermint();

		const pdf = Buffer.from("%PDF-1.4\n%\xE2\xE3\xCF\xD3\ntrailer", "binary");

		await payload.sendEmail({
			to: "user@example.com",
			subject: "Invoice",
			html: "<p>Attached.</p>",
			attachments: [
				{
					filename: "invoice.pdf",
					content: pdf,
					contentType: "application/pdf",
				},
			],
		});

		const [attachment] = lastBody().attachments ?? [];

		expect(attachment?.filename).toBe("invoice.pdf");
		expect(attachment?.content_type).toBe("application/pdf");
		expect(Buffer.from(attachment?.content ?? "", "base64").equals(pdf)).toBe(
			true,
		);
	});

	it("keeps a cid so an inline image resolves", async () => {
		stubLettermint();

		await payload.sendEmail({
			to: "user@example.com",
			subject: "Logo",
			html: '<img src="cid:logo@cms" />',
			attachments: [
				{
					filename: "logo.png",
					content: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
					contentType: "image/png",
					cid: "logo@cms",
				},
			],
		});

		expect(lastBody().attachments?.[0]?.content_id).toBe("logo@cms");
	});

	it("drains a stream and sends several attachments at once", async () => {
		stubLettermint();

		await payload.sendEmail({
			to: "user@example.com",
			subject: "Files",
			text: "Attached.",
			attachments: [
				{ filename: "notes.txt", content: Readable.from(["a", "b"]) },
				{ filename: "more.txt", content: "ccc" },
			],
		});

		expect(lastBody().attachments).toStrictEqual([
			{ filename: "notes.txt", content: "YWI=" },
			{ filename: "more.txt", content: "Y2Nj" },
		]);
	});

	it("does not encode already-base64 content a second time", async () => {
		stubLettermint();

		await payload.sendEmail({
			to: "user@example.com",
			subject: "Files",
			text: "Attached.",
			attachments: [
				{ filename: "c.txt", content: "aGVsbG8=", encoding: "base64" },
			],
		});

		expect(lastBody().attachments?.[0]?.content).toBe("aGVsbG8=");
	});
});
