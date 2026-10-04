import { describe, expect, it } from "vitest";

import {
	accessLevelOf,
	accessLevelsOf,
	allAccessLevel,
	allDeleteMode,
	buildToggleActions,
	deleteModeOf,
	toolsState,
} from "./capability-toggles.js";

import type {
	AccessLevel,
	CapabilityValues,
	DeleteMode,
	ToggleIntent,
} from "./capability-toggles.js";
import type { CapabilityMatrix } from "../api-keys/capability-matrix.js";

const BASE = "capabilities";

/*
 * Mirrors the integration fixture: a versioned collection that publishes, one
 * that only drafts, a read-only one, and an upload.
 */
const matrix: CapabilityMatrix = {
	collections: [
		{
			fieldName: "pages",
			label: "pages",
			read: true,
			write: true,
			publish: true,
			delete: false,
			deleteUnattended: false,
		},
		{
			fieldName: "posts",
			label: "posts",
			read: true,
			write: true,
			publish: false,
			delete: false,
			deleteUnattended: false,
		},
		{
			fieldName: "tags",
			label: "tags",
			read: true,
			write: false,
			publish: false,
			delete: true,
			deleteUnattended: true,
		},
		{
			fieldName: "media",
			label: "media",
			read: true,
			write: true,
			publish: false,
			delete: false,
			deleteUnattended: false,
		},
	],
	globals: [
		{
			fieldName: "siteSettings",
			label: "site-settings",
			read: true,
			write: true,
			publish: true,
			delete: false,
			deleteUnattended: false,
		},
	],
	tools: [
		{ name: "echo", description: "Echoes the input back." },
		{ name: "whichCollection", description: "Names the collection." },
	],
};

const values = (...granted: string[]): CapabilityValues =>
	Object.fromEntries(granted.map((path) => [path, true]));

const access = (level: AccessLevel, fieldName?: string): ToggleIntent => ({
	kind: "access",
	namespace: "collections",
	level,
	...(fieldName === undefined ? {} : { fieldName }),
});

const deleting = (mode: DeleteMode, fieldName?: string): ToggleIntent => ({
	kind: "deleteMode",
	namespace: "collections",
	mode,
	...(fieldName === undefined ? {} : { fieldName }),
});

const paths = (granted: CapabilityValues, intent: ToggleIntent): string[] =>
	buildToggleActions(matrix, BASE, granted, intent).map(
		(action) => `${action.path}=${String(action.value)}`,
	);

const pages = matrix.collections[0]!;
const tags = matrix.collections[2]!;

describe("accessLevelsOf", () => {
	it("offers none and every level the config exposes", () => {
		expect(accessLevelsOf(pages)).toEqual(["none", "read", "write", "publish"]);
		expect(accessLevelsOf(tags)).toEqual(["none", "read"]);
	});
});

describe("accessLevelOf", () => {
	const levelOf = (...granted: string[]): AccessLevel =>
		accessLevelOf(
			BASE,
			"collections",
			pages,
			values(
				...granted.map((name) => `capabilities.collections.pages.${name}`),
			),
		);

	it("reads the highest level whose flags are all granted", () => {
		expect(levelOf()).toBe("none");
		expect(levelOf("read")).toBe("read");
		expect(levelOf("read", "write")).toBe("write");
		expect(levelOf("read", "write", "publish")).toBe("publish");
	});

	/* The server ignores a write without a read, so the control does too. */
	it("stops at the first missing flag", () => {
		expect(levelOf("write")).toBe("none");
		expect(levelOf("read", "publish")).toBe("read");
	});

	it("ignores a flag the config does not expose", () => {
		expect(
			accessLevelOf(
				BASE,
				"collections",
				tags,
				values(
					"capabilities.collections.tags.read",
					"capabilities.collections.tags.write",
				),
			),
		).toBe("read");
	});
});

describe("deleteModeOf", () => {
	it("reads the stored flags back as a mode", () => {
		const modeOf = (...granted: string[]): DeleteMode =>
			deleteModeOf(
				BASE,
				"collections",
				tags,
				values(
					...granted.map((name) => `capabilities.collections.tags.${name}`),
				),
			);

		expect(modeOf()).toBe("off");
		expect(modeOf("read", "delete")).toBe("approve");
		expect(modeOf("read", "delete", "deleteUnattended")).toBe("trash");
	});
});

/* Stored combinations the server ignores, kept by keys saved before the controls. */
describe("legacy states", () => {
	it("shows write without read as none, and picking a level repairs it", () => {
		const granted = values("capabilities.collections.pages.write");

		expect(accessLevelOf(BASE, "collections", pages, granted)).toBe("none");
		expect(paths(granted, access("none", "pages"))).toEqual([
			"capabilities.collections.pages.write=false",
		]);
		expect(paths(granted, access("write", "pages"))).toEqual([
			"capabilities.collections.pages.read=true",
		]);
	});

	it("shows delete without read as off", () => {
		expect(
			deleteModeOf(
				BASE,
				"collections",
				tags,
				values("capabilities.collections.tags.delete"),
			),
		).toBe("off");
	});

	it("shows deleteUnattended without delete as off", () => {
		expect(
			deleteModeOf(
				BASE,
				"collections",
				tags,
				values(
					"capabilities.collections.tags.read",
					"capabilities.collections.tags.deleteUnattended",
				),
			),
		).toBe("off");
	});
});

describe("buildToggleActions", () => {
	describe("an access level", () => {
		it("grants the level and every one before it", () => {
			expect(paths({}, access("write", "pages"))).toEqual([
				"capabilities.collections.pages.read=true",
				"capabilities.collections.pages.write=true",
			]);
		});

		it("clears the levels above it", () => {
			expect(
				paths(
					values(
						"capabilities.collections.pages.read",
						"capabilities.collections.pages.write",
						"capabilities.collections.pages.publish",
					),
					access("read", "pages"),
				),
			).toEqual([
				"capabilities.collections.pages.write=false",
				"capabilities.collections.pages.publish=false",
			]);
		});

		it("clears delete with access set to none", () => {
			expect(
				paths(
					values(
						"capabilities.collections.tags.read",
						"capabilities.collections.tags.delete",
						"capabilities.collections.tags.deleteUnattended",
					),
					access("none", "tags"),
				),
			).toEqual([
				"capabilities.collections.tags.read=false",
				"capabilities.collections.tags.delete=false",
				"capabilities.collections.tags.deleteUnattended=false",
			]);
		});

		it("keeps delete when lowered to read", () => {
			expect(
				paths(
					values(
						"capabilities.collections.tags.read",
						"capabilities.collections.tags.delete",
					),
					access("read", "tags"),
				),
			).toEqual([]);
		});

		it("caps every row at its ceiling when picked for all", () => {
			expect(paths({}, access("publish"))).toEqual([
				"capabilities.collections.pages.read=true",
				"capabilities.collections.pages.write=true",
				"capabilities.collections.pages.publish=true",
				"capabilities.collections.posts.read=true",
				"capabilities.collections.posts.write=true",
				"capabilities.collections.tags.read=true",
				"capabilities.collections.media.read=true",
				"capabilities.collections.media.write=true",
			]);
		});
	});

	describe("a delete mode", () => {
		it("raises access to read for approval and leaves trashing off", () => {
			expect(paths({}, deleting("approve", "tags"))).toEqual([
				"capabilities.collections.tags.read=true",
				"capabilities.collections.tags.delete=true",
			]);
		});

		it("ticks both flags for trash", () => {
			expect(paths({}, deleting("trash", "tags"))).toEqual([
				"capabilities.collections.tags.read=true",
				"capabilities.collections.tags.delete=true",
				"capabilities.collections.tags.deleteUnattended=true",
			]);
		});

		it("clears both flags when set off and keeps read", () => {
			expect(
				paths(
					values(
						"capabilities.collections.tags.read",
						"capabilities.collections.tags.delete",
						"capabilities.collections.tags.deleteUnattended",
					),
					deleting("off", "tags"),
				),
			).toEqual([
				"capabilities.collections.tags.delete=false",
				"capabilities.collections.tags.deleteUnattended=false",
			]);
		});

		it("drops only the unattended flag when stepping from trash to approval", () => {
			expect(
				paths(
					values(
						"capabilities.collections.tags.read",
						"capabilities.collections.tags.delete",
						"capabilities.collections.tags.deleteUnattended",
					),
					deleting("approve", "tags"),
				),
			).toEqual(["capabilities.collections.tags.deleteUnattended=false"]);
		});

		it("applies to rows that expose delete only when picked for all", () => {
			expect(paths({}, deleting("approve"))).toEqual([
				"capabilities.collections.tags.read=true",
				"capabilities.collections.tags.delete=true",
			]);
		});
	});

	it("toggles one tool and every tool", () => {
		expect(paths({}, { kind: "tool", name: "echo", value: true })).toEqual([
			"capabilities.tools.echo=true",
		]);
		expect(paths({}, { kind: "tools", value: true })).toEqual([
			"capabilities.tools.echo=true",
			"capabilities.tools.whichCollection=true",
		]);
	});

	/* No action means no `setModified`, so a no-op click leaves the form clean. */
	it("emits nothing when the value already holds", () => {
		expect(
			paths(
				values("capabilities.collections.pages.read"),
				access("read", "pages"),
			),
		).toEqual([]);
	});

	it("honours a non-default base path", () => {
		expect(
			buildToggleActions(
				matrix,
				"custom",
				{},
				{ kind: "tool", name: "echo", value: true },
			),
		).toEqual([{ type: "UPDATE", path: "custom.tools.echo", value: true }]);
	});
});

describe("the All controls", () => {
	it("select a level only while every row sits at it, capped", () => {
		expect(allAccessLevel(matrix, BASE, "collections", {})).toBe("none");
		expect(
			allAccessLevel(
				matrix,
				BASE,
				"collections",
				values(
					"capabilities.collections.pages.read",
					"capabilities.collections.pages.write",
					"capabilities.collections.posts.read",
					"capabilities.collections.posts.write",
					"capabilities.collections.tags.read",
					"capabilities.collections.media.read",
					"capabilities.collections.media.write",
				),
			),
		).toBe("write");
	});

	it("select nothing while rows differ", () => {
		expect(
			allAccessLevel(
				matrix,
				BASE,
				"collections",
				values("capabilities.collections.pages.read"),
			),
		).toBeUndefined();
	});

	it("read delete over the rows that expose it", () => {
		expect(allDeleteMode(matrix, BASE, "collections", {})).toBe("off");
		expect(
			allDeleteMode(
				matrix,
				BASE,
				"collections",
				values(
					"capabilities.collections.tags.read",
					"capabilities.collections.tags.delete",
				),
			),
		).toBe("approve");
	});

	/* "All" offers no trash, so a row that trashes directly reads as mixed. */
	it("read a row that trashes directly as mixed", () => {
		expect(
			allDeleteMode(
				matrix,
				BASE,
				"collections",
				values(
					"capabilities.collections.tags.read",
					"capabilities.collections.tags.delete",
					"capabilities.collections.tags.deleteUnattended",
				),
			),
		).toBeUndefined();
	});

	it("report tool state over the whole list", () => {
		expect(toolsState(matrix, BASE, values("capabilities.tools.echo"))).toBe(
			"mixed",
		);
		expect(toolsState(matrix, BASE, {})).toBe("off");
	});
});
