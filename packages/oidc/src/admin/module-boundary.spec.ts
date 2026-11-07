import { walkModuleGraph } from "@internal/test-utils/module-graph";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const entry = resolve(here, "index.ts");

describe("./admin module boundary", () => {
	/*
	 * The admin bundle must not pull in the OpenID client, jose or the Payload
	 * runtime through a shared module; it reaches the admin UI and React only.
	 */
	it("reaches only the admin bundle and React", () => {
		expect([...walkModuleGraph(entry).bareSpecifiers].sort()).toEqual([
			"@payloadcms/ui",
			"react",
		]);
	});

	it("actually walks into login.tsx (sanity check against a vacuous pass)", () => {
		const { files } = walkModuleGraph(entry);

		expect([...files].some((file) => file.endsWith("login.tsx"))).toBe(true);
	});

	/*
	 * The login component reads cookies on the server; only the logout button
	 * and the redirect may be client components.
	 */
	it('carries "use client" on the logout button and the redirect only', () => {
		const clients = [...walkModuleGraph(entry).files].filter((file) =>
			/^\s*["']use client["']/m.test(readFileSync(file, "utf8")),
		);

		expect(clients.map((file) => file.split("/").pop()).sort()).toEqual([
			"auto-redirect.tsx",
			"logout-button.tsx",
		]);
	});
});
