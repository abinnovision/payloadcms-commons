import { describe, expect, it } from "vitest";

import { LettermintEmailError } from "./errors.js";
import {
	droppedAttachmentFields,
	normalizeHeaders,
	toSendMailRequest,
} from "./message.js";

import type { MessageDefaults } from "./message.js";

const defaults: MessageDefaults = {
	from: "Payload <no-reply@example.com>",
	route: undefined,
	settings: undefined,
	metadata: undefined,
	tags: undefined,
	overrideRecipientAddress: undefined,
};

const map = async (
	message: Parameters<typeof toSendMailRequest>[0],
	overrides: Partial<MessageDefaults> = {},
) => await toSendMailRequest(message, { ...defaults, ...overrides });

describe("normalizeHeaders", () => {
	it("flattens the record shape", () => {
		expect(normalizeHeaders({ "X-A": "1", "X-B": ["2", "3"] })).toStrictEqual({
			"X-A": "1",
			"X-B": "2, 3",
		});
	});

	it("flattens the array shape", () => {
		expect(
			normalizeHeaders([
				{ key: "X-A", value: "1" },
				{ key: "X-A", value: "2" },
			]),
		).toStrictEqual({ "X-A": "1, 2" });
	});

	it("unwraps a prepared value", () => {
		expect(
			normalizeHeaders({ "X-A": { prepared: true, value: "1" } }),
		).toStrictEqual({ "X-A": "1" });
	});
});

describe("toSendMailRequest", () => {
	it("maps the message Payload's auth flows send", async () => {
		const { body, dropped } = await map({
			from: '"Payload" <no-reply@example.com>',
			to: "user@example.com",
			subject: "Reset your password",
			html: "<p>Hi</p>",
		});

		expect(body).toStrictEqual({
			from: '"Payload" <no-reply@example.com>',
			to: ["user@example.com"],
			subject: "Reset your password",
			html: "<p>Hi</p>",
		});
		expect(dropped).toStrictEqual([]);
	});

	it("falls back to the configured from address", async () => {
		const { body } = await map({ to: "a@b.io", subject: "s" });

		expect(body.from).toBe("Payload <no-reply@example.com>");
	});

	it("sends reply_to as an array, as the API requires", async () => {
		const { body } = await map({
			to: "a@b.io",
			subject: "s",
			replyTo: { name: "Support", address: "help@example.com" },
		});

		expect(body.reply_to).toStrictEqual(["Support <help@example.com>"]);
	});

	it("omits an empty body, which the API would reject", async () => {
		const { body } = await map({ to: "a@b.io", subject: "s", html: "" });

		expect(body).not.toHaveProperty("html");
	});

	it("preserves a submitted Message-ID", async () => {
		const { body } = await map({
			to: "a@b.io",
			subject: "s",
			messageId: "<abc@example.com>",
		});

		expect(body.headers).toStrictEqual({
			"Message-ID": "<abc@example.com>",
			"X-LM-Preserve-Message-ID": "true",
		});
	});

	it("maps threading fields onto headers", async () => {
		const { body } = await map({
			to: "a@b.io",
			subject: "s",
			inReplyTo: "<a@x.io>",
			references: ["<a@x.io>", "<b@x.io>"],
		});

		expect(body.headers).toStrictEqual({
			"In-Reply-To": "<a@x.io>",
			References: "<a@x.io> <b@x.io>",
		});
	});

	it("redirects every recipient and clears cc and bcc", async () => {
		const { body } = await map(
			{
				to: ["a@b.io", "c@d.io"],
				cc: "cc@b.io",
				bcc: "bcc@b.io",
				subject: "s",
			},
			{ overrideRecipientAddress: "staging@example.com" },
		);

		expect(body.to).toStrictEqual(["staging@example.com"]);
		expect(body).not.toHaveProperty("cc");
		expect(body).not.toHaveProperty("bcc");
	});

	it("merges the configured route, settings, metadata and tags", async () => {
		const { body } = await map(
			{ to: "a@b.io", subject: "s" },
			{
				route: "outgoing",
				settings: { track_opens: false },
				metadata: { app: "cms" },
				tags: [{ name: "kind", value: "transactional" }],
			},
		);

		expect(body.route).toBe("outgoing");
		expect(body.settings).toStrictEqual({ track_opens: false });
		expect(body.metadata).toStrictEqual({ app: "cms" });
		expect(body.tags).toStrictEqual([{ name: "kind", value: "transactional" }]);
	});

	it("encodes attachments and keeps a declared content type", async () => {
		const { body } = await map({
			to: "a@b.io",
			subject: "s",
			attachments: [
				{ filename: "a.txt", content: "hi", contentType: "text/plain" },
			],
		});

		expect(body.attachments).toStrictEqual([
			{ filename: "a.txt", content: "aGk=", content_type: "text/plain" },
		]);
	});

	it("omits application/octet-stream, which Lettermint blocks", async () => {
		const { body } = await map({
			to: "a@b.io",
			subject: "s",
			attachments: [
				{
					filename: "a.bin",
					content: "hi",
					contentType: "application/octet-stream",
				},
			],
		});

		expect(body.attachments?.[0]).not.toHaveProperty("content_type");
	});

	it("maps cid to content_id for inline attachments", async () => {
		const { body } = await map({
			to: "a@b.io",
			subject: "s",
			attachments: [{ filename: "a.png", content: "hi", cid: "logo" }],
		});

		expect(body.attachments?.[0]?.content_id).toBe("logo");
	});

	it("refuses an attachment without a filename", async () => {
		await expect(
			map({
				to: "a@b.io",
				subject: "s",
				attachments: [{ content: "hi" }],
			}),
		).rejects.toThrow(LettermintEmailError);
	});

	it("reports per-attachment fields the API cannot express", async () => {
		const { dropped } = await map({
			to: "a@b.io",
			subject: "s",
			attachments: [
				{ filename: "a.txt", content: "hi", contentDisposition: "inline" },
				{ filename: "b.txt", content: "hi", raw: "x" },
			],
		});

		expect(dropped).toStrictEqual([
			"attachments[0].contentDisposition",
			"attachments[1].raw",
		]);
	});

	it("stays quiet about an inline disposition backed by a cid", () => {
		expect(
			droppedAttachmentFields([
				{
					filename: "a.png",
					content: "hi",
					cid: "logo",
					contentDisposition: "inline",
				},
			]),
		).toStrictEqual([]);
	});

	it("reports fields the API cannot express", async () => {
		const { dropped } = await map({
			to: "a@b.io",
			subject: "s",
			priority: "high",
			dkim: { domainName: "x.io", keySelector: "k", privateKey: "p" },
		});

		expect(dropped).toStrictEqual(["dkim", "priority"]);
	});
});
