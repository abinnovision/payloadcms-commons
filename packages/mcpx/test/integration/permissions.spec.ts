import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { collectionEnumOf, createMcpClient } from "./helpers/mcp.js";
import { bootPayload, createKey } from "./helpers/payload.js";

import type { McpClient } from "./helpers/mcp.js";
import type { Booted } from "./helpers/payload.js";
import type { Access, CollectionConfig } from "payload";

const EDITOR = "editor@example.com";

// The editor may change unlocked memos; anyone else may change none.
const editorOnly: Access = ({ req }) =>
	req.user?.email === EDITOR ? { title: { not_equals: "Locked" } } : false;

const memos: CollectionConfig = {
	slug: "memos",
	access: { create: editorOnly, update: editorOnly },
	fields: [{ name: "title", type: "text" }],
};

const WRITE_TOOLS = [
	"createDocument",
	"duplicateDocument",
	"patchDocument",
	"validateDocument",
];

describe("capabilities narrowed to Payload permissions", () => {
	let booted: Booted;
	let editor: McpClient;
	let viewer: McpClient;

	beforeAll(async () => {
		booted = await bootPayload({
			key: "mcpx-integration-permissions",
			collections: [memos],
			plugin: { collections: { memos: true } },
		});

		const clientFor = async (email: string): Promise<McpClient> => {
			const user = await booted.payload.create({
				collection: "users",
				data: { email, password: "permissions-secret" },
				overrideAccess: true,
			});

			return createMcpClient(
				booted,
				await createKey(booted.payload, {
					userId: user.id,
					label: email,
					capabilities: { collections: { memos: { read: true, write: true } } },
				}),
			);
		};

		editor = await clientFor(EDITOR);
		viewer = await clientFor("viewer@example.com");
	});

	afterAll(async () => {
		await booted.payload.destroy();
	});

	it("keeps writes where access answers with a query constraint", async () => {
		const tools = await editor.list();

		expect(tools.map((tool) => tool.name)).toEqual(
			expect.arrayContaining(WRITE_TOOLS),
		);
		expect(
			collectionEnumOf(tools.find((tool) => tool.name === "patchDocument")),
		).toEqual(["memos"]);
	});

	it("drops writes where access denies the update", async () => {
		const names = await viewer.names();

		expect(names).toContain("findDocuments");
		expect(names.filter((name) => WRITE_TOOLS.includes(name))).toEqual([]);
	});

	it("reports the narrowed capabilities", async () => {
		const capabilities = async (client: McpClient) =>
			JSON.stringify((await client.call("listCapabilities")).data);

		expect(await capabilities(viewer)).not.toContain('"write":true');
		expect(await capabilities(editor)).toContain('"write":true');
	});
});
