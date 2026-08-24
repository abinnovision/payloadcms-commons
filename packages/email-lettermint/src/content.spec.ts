import { Buffer } from "node:buffer";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";

import { toBase64, toText } from "./content.js";
import { LettermintEmailError } from "./errors.js";

describe("toText", () => {
	it("returns undefined for an absent body", async () => {
		await expect(toText(undefined, "html")).resolves.toBeUndefined();
	});

	it("passes a string through", async () => {
		await expect(toText("<p>hi</p>", "html")).resolves.toBe("<p>hi</p>");
	});

	it("decodes a buffer", async () => {
		await expect(toText(Buffer.from("hi", "utf8"), "html")).resolves.toBe("hi");
	});

	it("drains a stream", async () => {
		await expect(toText(Readable.from(["a", "b", "c"]), "html")).resolves.toBe(
			"abc",
		);
	});

	it("unwraps a { content } wrapper", async () => {
		await expect(toText({ content: "hi" }, "html")).resolves.toBe("hi");
	});

	it("refuses { path }, which would read a file or fetch a URL", async () => {
		await expect(toText({ path: "/etc/passwd" }, "html")).rejects.toThrow(
			LettermintEmailError,
		);
	});
});

describe("toBase64", () => {
	it("encodes a string", async () => {
		await expect(toBase64("hi", "a.txt")).resolves.toBe("aGk=");
	});

	it("passes already-base64 content through untouched", async () => {
		await expect(toBase64("aGk=", "a.txt", "base64")).resolves.toBe("aGk=");
	});

	it("encodes a buffer", async () => {
		await expect(toBase64(Buffer.from([0, 1, 2]), "a.bin")).resolves.toBe(
			"AAEC",
		);
	});

	it("encodes a stream", async () => {
		await expect(
			toBase64(Readable.from([Buffer.from("hi")]), "a.txt"),
		).resolves.toBe("aGk=");
	});

	it("decodes a string in another Buffer encoding", async () => {
		await expect(toBase64("6869", "a.txt", "hex")).resolves.toBe("aGk=");
	});

	it("names the attachment when the encoding is not decodable", async () => {
		await expect(toBase64("hi", "a.txt", "quoted-printable")).rejects.toThrow(
			/declares encoding "quoted-printable"/,
		);
	});
});
