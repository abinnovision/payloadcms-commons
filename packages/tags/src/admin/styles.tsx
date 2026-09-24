"use client";

import type { ReactNode } from "react";

/*
 * Unlayered on purpose: Payload's own rules sit in `@layer payload-default`,
 * so any unlayered rule wins without raising specificity.
 *
 * The stored color only tints the background, the border and the dot. Text
 * is always `--theme-text`, so contrast holds for any color in either theme.
 * The border mixes against `--theme-elevation-150` rather than transparent,
 * which keeps an outline for colors that match the page, like `#fff` in the
 * light theme or `#000` in the dark one.
 */
const SHEET = `
.tags-pill {
	display: inline-flex;
	align-items: center;
	gap: 0.4em;
	max-width: 100%;
	padding: 0 0.6em;
	border-radius: 999px;
	background: var(--theme-elevation-100);
	background: color-mix(in srgb, var(--tags-color) 16%, var(--theme-bg));
	border: 1px solid var(--theme-elevation-150);
	border: 1px solid color-mix(in srgb, var(--tags-color) 45%, var(--theme-elevation-150));
	color: var(--theme-text);
	line-height: 1.6;
	white-space: nowrap;
}
.tags-pill::before {
	content: "";
	flex: none;
	width: 0.6em;
	height: 0.6em;
	border-radius: 50%;
	background: var(--tags-color);
	box-shadow: 0 0 0 1px var(--theme-elevation-150);
}
.tags-pill--muted { --tags-color: var(--theme-elevation-400); }
.tags-pill__label { overflow: hidden; text-overflow: ellipsis; }
.tags-cell { display: flex; flex-wrap: wrap; align-items: center; gap: 0.3em; }
.tags-cell__more { color: var(--theme-elevation-500); }
.tags-title-cell {
	padding: 0;
	border: 0;
	background: none;
	color: inherit;
	font: inherit;
	cursor: pointer;
	text-decoration: none;
}
.tags-field .rs__multi-value,
.tags-field .rs__multi-value:hover {
	background: none;
	border-color: transparent;
}
.tags-field .multi-value-label { padding: 0; max-width: 200px; }
.tags-color-field__row { display: flex; flex-wrap: wrap; align-items: center; gap: calc(var(--base) * 0.5); }
.tags-color-field__swatches { display: flex; flex-wrap: wrap; gap: calc(var(--base) * 0.25); }
.tags-color-field__swatch {
	width: calc(var(--base) * 1.2);
	height: calc(var(--base) * 1.2);
	padding: 0;
	border: 1px solid var(--theme-elevation-150);
	border-radius: 50%;
	background: var(--tags-color);
	cursor: pointer;
}
.tags-color-field__swatch[aria-checked="true"] {
	outline: 2px solid var(--theme-text);
	outline-offset: 2px;
}
.tags-color-field__swatch:disabled { cursor: default; }
.tags-color-field__custom {
	width: calc(var(--base) * 2);
	height: calc(var(--base) * 1.2);
	padding: 0;
	border: 1px solid var(--theme-elevation-150);
	border-radius: var(--style-radius-s);
	background: none;
	cursor: pointer;
}
`;

/**
 * The package's stylesheet. React 19 hoists a `<style>` with `href` and
 * `precedence` into the head and renders it once per `href`, so every pill
 * can render this without repeating it across list rows.
 */
export const TagsStyles = (): ReactNode => (
	<style href="payloadcms-tags" precedence="default">
		{SHEET}
	</style>
);
