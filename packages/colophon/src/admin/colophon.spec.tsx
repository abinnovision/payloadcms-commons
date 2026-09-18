import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { COLOPHON_CUSTOM_KEY } from "../index.js";

import type { ColophonOptions } from "../index.js";
import type { ServerProps } from "payload";
import type { ReactNode } from "react";

/*
 * The real module pulls in the whole admin bundle, including SCSS. Only the
 * one element the component renders into matters here.
 */
vi.mock("@payloadcms/ui", () => ({
	NavGroup: ({
		children,
		isOpen,
		label,
	}: {
		children: ReactNode;
		isOpen?: boolean;
		label: string;
	}) => (
		<div data-label={label} data-open={String(isOpen)}>
			{children}
		</div>
	),
}));

const { Colophon } = await import("./colophon.js");

const warn = vi.fn();

const props = (
	options: Partial<ColophonOptions> | undefined,
	overrides: {
		language?: string;
		fallbackLanguage?: string;
		user?: object;
	} = {},
): ServerProps =>
	({
		i18n: { language: overrides.language ?? "en" },
		user: overrides.user,
		payload: {
			logger: { warn },
			config: {
				i18n: { fallbackLanguage: overrides.fallbackLanguage ?? "en" },
				custom: options
					? {
							[COLOPHON_CUSTOM_KEY]: {
								items: [],
								label: "System",
								open: false,
								...options,
							},
						}
					: {},
			},
		},
	}) as unknown as ServerProps;

const render = (...args: Parameters<typeof props>) =>
	renderToStaticMarkup(<Colophon {...props(...args)} />);

beforeEach(() => {
	vi.stubEnv("APP_VERSION", "1.2.3");
	warn.mockClear();
});

afterEach(() => {
	vi.unstubAllEnvs();
});

describe("colophon", () => {
	it("renders a row per resolved item", () => {
		const html = render({
			items: [{ key: "version", label: "Version", env: ["APP_VERSION"] }],
		});

		expect(html).toContain("Version");
		expect(html).toContain("1.2.3");
	});

	it("puts the untruncated value in the row's tooltip", () => {
		vi.stubEnv("APP_COMMIT", "8f079ec2a1b3c4d5e6f708192a3b4c5d6e7f8091");

		const html = render({
			items: [
				{
					key: "commit",
					label: "Commit",
					env: ["APP_COMMIT"],
					format: (it) => it.slice(0, 7),
				},
			],
		});

		expect(html).toContain('title="8f079ec2a1b3c4d5e6f708192a3b4c5d6e7f8091"');
		expect(html).toContain(">8f079ec<");
	});

	it("passes the label and collapsed state to the group", () => {
		const html = render({
			items: [{ key: "version", env: ["APP_VERSION"] }],
			label: "Build",
			open: true,
		});

		expect(html).toContain('data-label="Build"');
		expect(html).toContain('data-open="true"');
	});

	it("resolves a localized group label against the admin language", () => {
		const html = render(
			{
				items: [{ key: "version", env: ["APP_VERSION"] }],
				label: { de: "Fassung", en: "Build" },
			},
			{ language: "de" },
		);

		expect(html).toContain('data-label="Fassung"');
	});

	/*
	 * An empty group would take sidebar height to report that nothing is
	 * configured, which is a message for whoever deployed the app.
	 */
	it("renders nothing when no item resolves", () => {
		vi.stubEnv("APP_VERSION", undefined);

		expect(render({ items: [{ key: "version", env: ["APP_VERSION"] }] })).toBe(
			"",
		);
	});

	it("renders nothing when the condition rejects the user", () => {
		expect(
			render({
				items: [{ key: "version", env: ["APP_VERSION"] }],
				condition: () => false,
			}),
		).toBe("");
	});

	it("gives the condition the signed-in user", () => {
		const condition = vi.fn(() => true);

		render(
			{ items: [{ key: "version", env: ["APP_VERSION"] }], condition },
			{ user: { id: 1 } },
		);

		expect(condition).toHaveBeenCalledWith({ user: { id: 1 } });
	});

	it("renders nothing when the plugin was never applied", () => {
		expect(render(undefined)).toBe("");
	});

	/*
	 * `format` is consumer code running inside the admin's navigation. One of
	 * them throwing costs its own row and leaves the sidebar standing.
	 */
	it("drops a row whose format throws and keeps the rest", () => {
		vi.stubEnv("APP_COMMIT", "8f079ec");

		const html = render({
			items: [
				{
					key: "commit",
					env: ["APP_COMMIT"],
					format: () => {
						throw new Error("boom");
					},
				},
				{ key: "version", label: "Version", env: ["APP_VERSION"] },
			],
		});

		expect(html).toContain("1.2.3");
		expect(html).not.toContain("8f079ec");
		expect(warn).toHaveBeenCalledOnce();
	});
});
