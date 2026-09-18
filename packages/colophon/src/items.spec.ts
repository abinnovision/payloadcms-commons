import { afterEach, describe, expect, it, vi } from "vitest";

import { defaultColophonItems, normalizeItems, resolveItems } from "./items.js";

/**
 * Every name the default items reach for. Unsetting all of them is how a test
 * describes a process that was started without any of this configured.
 */
const DEFAULT_NAMES = [
	"APP_VERSION",
	"BUILD_VERSION",
	"APP_COMMIT",
	"BUILD_COMMIT",
	"GIT_COMMIT_SHA",
	"APP_ENVIRONMENT",
	"BUILD_ENVIRONMENT",
];

const unsetDefaults = () => {
	for (const name of DEFAULT_NAMES) {
		vi.stubEnv(name, undefined);
	}
};

afterEach(() => {
	vi.unstubAllEnvs();
});

describe("normalizeItems", () => {
	it("defaults a missing label to the key", () => {
		expect(normalizeItems([{ key: "region" }])[0]?.label).toBe("region");
	});

	it("keeps an explicit label", () => {
		expect(normalizeItems([{ key: "region", label: "Region" }])[0]?.label).toBe(
			"Region",
		);
	});

	/*
	 * Two rows under one key collide as React keys, and React renders one of
	 * them and drops the other without saying so. Failing at boot is the only
	 * point at which this is cheap to notice.
	 */
	it("rejects a duplicate key", () => {
		expect(() =>
			normalizeItems([{ key: "version" }, { key: "version" }]),
		).toThrow(/Duplicate item key "version"/);
	});

	it("rejects an empty key", () => {
		expect(() => normalizeItems([{ key: "" }])).toThrow(/may not be empty/);
	});
});

describe("resolveItems", () => {
	it("tries environment names in order and takes the first one set", () => {
		vi.stubEnv("SECOND", "from-second");

		const [row] = resolveItems([{ key: "v", env: ["FIRST", "SECOND"] }]);

		expect(row?.display).toBe("from-second");
	});

	it("prefers an earlier name when both are set", () => {
		vi.stubEnv("FIRST", "from-first");
		vi.stubEnv("SECOND", "from-second");

		expect(
			resolveItems([{ key: "v", env: ["FIRST", "SECOND"] }])[0]?.display,
		).toBe("from-first");
	});

	/*
	 * A container that declares a variable it has no value for is the normal
	 * way this happens, and it must not shadow the next name in the chain.
	 */
	it("treats an empty environment variable as unset", () => {
		vi.stubEnv("FIRST", "");
		vi.stubEnv("SECOND", "from-second");

		expect(
			resolveItems([{ key: "v", env: ["FIRST", "SECOND"] }])[0]?.display,
		).toBe("from-second");
	});

	it("falls back when no name in the chain is set", () => {
		expect(
			resolveItems([{ key: "v", env: ["MISSING"], fallback: "dev" }])[0]
				?.display,
		).toBe("dev");
	});

	it("lets value win over the environment", () => {
		vi.stubEnv("FIRST", "from-env");

		expect(
			resolveItems([{ key: "v", env: ["FIRST"], value: () => "computed" }])[0]
				?.display,
		).toBe("computed");
	});

	it("applies format to the display value and keeps the full one", () => {
		vi.stubEnv("SHA", "8f079ec2a1b3c4d5e6f708192a3b4c5d6e7f8091");

		const [row] = resolveItems([
			{ key: "commit", env: ["SHA"], format: (it) => it.slice(0, 7) },
		]);

		expect(row?.display).toBe("8f079ec");
		expect(row?.full).toBe("8f079ec2a1b3c4d5e6f708192a3b4c5d6e7f8091");
	});

	it("drops a row that resolves to nothing", () => {
		expect(resolveItems([{ key: "v", env: ["MISSING"] }])).toEqual([]);
	});

	/*
	 * `value` and `format` are consumer code running inside the admin's
	 * navigation. One of them throwing costs its own row and nothing else.
	 */
	it("drops only the row whose format throws", () => {
		vi.stubEnv("A", "a");
		vi.stubEnv("B", "b");
		const warn = vi.fn();

		const rows = resolveItems(
			[
				{
					key: "bad",
					env: ["A"],
					format: () => {
						throw new Error("boom");
					},
				},
				{ key: "good", env: ["B"] },
			],
			warn,
		);

		expect(rows.map((it) => it.key)).toEqual(["good"]);
		expect(warn).toHaveBeenCalledOnce();
	});

	it("drops only the row whose value throws", () => {
		vi.stubEnv("B", "b");

		const rows = resolveItems([
			{
				key: "bad",
				value: () => {
					throw new Error("boom");
				},
			},
			{ key: "good", env: ["B"] },
		]);

		expect(rows.map((it) => it.key)).toEqual(["good"]);
	});
});

describe("defaultColophonItems", () => {
	it("resolves nothing when the environment says nothing", () => {
		unsetDefaults();

		expect(resolveItems(defaultColophonItems)).toEqual([]);
	});

	it("reads the documented names", () => {
		unsetDefaults();
		vi.stubEnv("APP_VERSION", "1.2.3");
		vi.stubEnv("APP_COMMIT", "8f079ec2a1b3c4d5e6f708192a3b4c5d6e7f8091");
		vi.stubEnv("APP_ENVIRONMENT", "staging");

		expect(
			resolveItems(defaultColophonItems).map((it) => [it.key, it.display]),
		).toEqual([
			["version", "1.2.3"],
			["commit", "8f079ec"],
			["environment", "staging"],
		]);
	});

	/*
	 * The chain exists so an app already setting the `BUILD_*` names from its
	 * CI keeps working without touching its deployment.
	 */
	it("still reads the BUILD_ names", () => {
		unsetDefaults();
		vi.stubEnv("BUILD_VERSION", "v2.0.0");

		expect(resolveItems(defaultColophonItems)[0]?.display).toBe("v2.0.0");
	});

	/*
	 * The runtime sets both of these whatever a project does, so reading them
	 * would put a row nobody configured into the sidebar of every app that
	 * installed the plugin and left it at its defaults.
	 */
	it("ignores NODE_ENV and npm_package_version", () => {
		unsetDefaults();
		vi.stubEnv("NODE_ENV", "production");
		vi.stubEnv("npm_package_version", "0.0.0");

		expect(resolveItems(defaultColophonItems)).toEqual([]);
	});
});
