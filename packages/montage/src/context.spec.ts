import { describe, expect, it } from "vitest";

import {
	createBlockContext,
	createChildContext,
	createContextExtension,
} from "./context.js";

interface MyContext {
	locale: string;
	document: { collection: string };
}

describe("createBlockContext", () => {
	it("returns the base object with its own fields readable", () => {
		const ctx = createBlockContext<MyContext>({
			locale: "de",
			document: { collection: "pages" },
		});
		expect(ctx.locale).toBe("de");
		expect(ctx.document.collection).toBe("pages");
	});
});

describe("createChildContext", () => {
	it("preserves the parent's own fields", () => {
		const ctx = createBlockContext<MyContext>({
			locale: "de",
			document: { collection: "pages" },
		});
		const child = createChildContext(ctx);
		expect(child.locale).toBe("de");
	});

	it("replacing a top-level field on the child does not affect the parent", () => {
		const ctx = createBlockContext<MyContext>({
			locale: "de",
			document: { collection: "pages" },
		});
		const child = createChildContext(ctx);
		(child as MyContext).locale = "en";
		expect(ctx.locale).toBe("de");
		expect(child.locale).toBe("en");
	});

	it("writing to the montage results store through a child is visible on the parent", () => {
		const ctx = createBlockContext<MyContext>({
			locale: "de",
			document: { collection: "pages" },
		});
		const ext = createContextExtension<{ count: number }>("shared-store-probe");
		ext.set(ctx, { count: 0 });

		const child = createChildContext(ctx);
		// mutate the object referenced by both parent and child's slot
		const shared = ext.get(child);
		expect(shared).toBeDefined();
		(shared as { count: number }).count = 42;

		expect(ext.get(ctx)?.count).toBe(42);
	});
});

describe("createContextExtension", () => {
	it("get/set round-trips a value", () => {
		const ctx = createBlockContext<MyContext>({
			locale: "de",
			document: { collection: "pages" },
		});
		const isFirstSection = createContextExtension<boolean>("is-first-section");

		expect(isFirstSection.get(ctx)).toBeUndefined();
		isFirstSection.set(ctx, true);
		expect(isFirstSection.get(ctx)).toBe(true);
	});

	it("two extensions sharing a name collide", () => {
		const ctx = createBlockContext<MyContext>({
			locale: "de",
			document: { collection: "pages" },
		});
		const a = createContextExtension<string>("shared-name");
		const b = createContextExtension<number>("shared-name");

		a.set(ctx, "from-a");
		expect(b.get(ctx)).toBe("from-a");
	});

	it("does not affect a context's own fields", () => {
		const ctx = createBlockContext<MyContext>({
			locale: "de",
			document: { collection: "pages" },
		});
		const ext = createContextExtension<boolean>("probe");
		ext.set(ctx, true);

		const ownKeys = Object.keys(ctx).filter(
			(key) => !key.startsWith("montage:"),
		);
		expect(ownKeys.sort()).toEqual(["document", "locale"]);
	});
});
