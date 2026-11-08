import { PANEL_WIDTH } from "./layout.js";

const PANEL_MIN = `${String(PANEL_WIDTH.min)}px`;

/**
 * The layout and panel styles, on Payload's design tokens so they follow the
 * admin's light and dark themes and its theme overrides. The metrics mirror
 * Payload's own elements: the header lines up with the nav header, controls
 * use the button height, selected rows the nav's inset highlight and the
 * composer the field tokens. Rendered as a hoisted `<style>` element, so the
 * package ships no stylesheet for the consumer's bundler to process.
 */
export const PANEL_CSS = `
.flue-layout {
	display: flex;
	width: 100%;
	min-height: 100vh;
}

/*
 * The admin keeps room for its document before the panel takes its full
 * width; the panel gives way down to its minimum.
 */
.flue-layout__main {
	flex: 1 1 0;
	min-width: min(30rem, calc(100% - ${PANEL_MIN}));
}

.flue-layout:has(.nav--nav-open) .flue-layout__main {
	min-width: min(
		calc(var(--nav-width) + 30rem),
		calc(100% - ${PANEL_MIN})
	);
}

.flue-layout:has(.flue-panel[data-resizing]) {
	cursor: col-resize;
	user-select: none;
}

.flue-panel {
	position: sticky;
	top: 0;
	display: flex;
	flex: 0 1 var(--flue-panel-width);
	flex-direction: column;
	align-self: flex-start;
	width: var(--flue-panel-width);
	min-width: ${PANEL_MIN};
	height: 100vh;
	border-inline-start: var(--stroke-width-small) solid var(--color-border);
	background: var(--color-bg);
	color: var(--color-text);
	animation: flue-panel-in 150ms ease-out;
}

.flue-panel[hidden] {
	display: none;
}

@keyframes flue-panel-in {
	from {
		opacity: 0;
	}
}

.flue-panel__resize {
	position: absolute;
	inset-block: 0;
	inset-inline-start: calc(-1 * var(--spacer-1));
	z-index: 2;
	width: var(--spacer-2);
	cursor: col-resize;
	touch-action: none;
}

.flue-panel__resize::after {
	position: absolute;
	inset-block: 0;
	inset-inline-start: calc(var(--spacer-1) - var(--stroke-width-medium));
	width: var(--stroke-width-medium);
	background: transparent;
	content: "";
	transition: background-color 150ms ease-out;
}

.flue-panel__resize:hover::after {
	background: var(--color-border-selected);
	transition-delay: 150ms;
}

.flue-panel__resize:focus-visible {
	outline: none;
}

.flue-panel__resize:focus-visible::after,
.flue-panel[data-resizing] .flue-panel__resize::after {
	background: var(--color-border-selected);
	transition-delay: 0ms;
}

@media (max-width: 1023px) {
	.flue-panel {
		position: fixed;
		inset-block: 0;
		inset-inline-end: 0;
		/* A start alignment would size the fixed panel to its content. */
		align-self: stretch;
		z-index: calc(var(--z-modal) - 1);
		width: min(var(--flue-panel-width), 100vw);
		min-width: 0;
		height: auto;
		border-inline-start: 0;
		box-shadow: var(--elevation-400-menu-panel);
	}

	.flue-panel__resize {
		display: none;
	}
}

.flue-panel__header {
	display: flex;
	flex: none;
	gap: var(--spacer-1);
	align-items: center;
	padding: var(--spacer-2-5) var(--spacer-2-5) var(--spacer-2-5) var(--spacer-2);
	border-bottom: var(--stroke-width-small) solid var(--color-border);
}

.flue-panel__agent {
	position: relative;
	display: flex;
	min-width: 0;
	margin-inline-end: auto;
}

.flue-panel__agent-select {
	max-width: 100%;
	height: var(--button-height);
	padding-block: 0;
	padding-inline: var(--spacer-2) calc(var(--spacer-1) + var(--spacer-3));
	overflow: hidden;
	border: 0;
	border-radius: var(--button-radius);
	background: transparent;
	color: var(--color-text);
	font: inherit;
	font-weight: var(--text-body-medium-bold-font-weight);
	text-overflow: ellipsis;
	white-space: nowrap;
	cursor: pointer;
	appearance: none;
	field-sizing: content;
}

.flue-panel__agent-select:hover {
	background: var(--color-bg-transparent-hover);
}

.flue-panel__agent-select option {
	background: var(--color-bg-elevated);
	color: var(--color-text);
	font-weight: var(--text-body-medium-font-weight);
}

.flue-panel__agent-chevron {
	position: absolute;
	top: 50%;
	inset-inline-end: var(--spacer-1);
	display: flex;
	color: var(--color-icon-secondary);
	pointer-events: none;
	translate: 0 -50%;
}

.flue-button {
	display: inline-flex;
	flex: none;
	gap: var(--spacer-1);
	align-items: center;
	justify-content: center;
	height: var(--button-height);
	padding: 0 var(--spacer-2);
	border: var(--stroke-width-small) solid var(--color-border-control);
	border-radius: var(--button-radius);
	background: var(--color-bg);
	color: var(--color-text);
	font: inherit;
	white-space: nowrap;
	cursor: pointer;
}

.flue-button:hover:not(:disabled) {
	background: var(--color-bg-secondary-hover);
}

.flue-button:active:not(:disabled) {
	background: var(--color-bg-secondary-pressed);
}

.flue-button:disabled {
	color: var(--color-text-disabled);
	cursor: not-allowed;
}

.flue-button--primary {
	border-color: transparent;
	background: var(--color-bg-brand);
	color: var(--color-text-onbrand);
}

.flue-button--primary:hover:not(:disabled) {
	background: var(--color-bg-brand-hover);
}

.flue-button--primary:active:not(:disabled) {
	background: var(--color-bg-brand-pressed);
}

.flue-button--primary:disabled {
	background: var(--color-bg-disabled);
	color: var(--color-text-ondisabled);
}

.flue-button--pill {
	border-color: transparent;
	background: var(--color-bg-secondary);
}

.flue-button--icon {
	padding-inline-start: var(--spacer-1);
}

.flue-button > svg {
	flex: none;
}

.flue-icon-button {
	display: inline-flex;
	flex: none;
	align-items: center;
	justify-content: center;
	width: var(--button-height);
	height: var(--button-height);
	padding: 0;
	border: 0;
	border-radius: var(--button-radius);
	background: transparent;
	color: var(--color-icon);
	cursor: pointer;
}

.flue-icon-button:hover {
	background: var(--color-bg-transparent-hover);
}

.flue-icon-button:active {
	background: var(--color-bg-transparent-pressed);
}

.flue-panel__view[aria-pressed="true"] {
	background: var(--color-bg-selected);
}

/* Without the agent picker, in Runs-only mode, the controls keep to the end. */
.flue-panel__header > .flue-panel__view:first-child {
	margin-inline-start: auto;
}

.flue-visually-hidden {
	position: absolute;
	width: 1px;
	height: 1px;
	overflow: hidden;
	clip-path: inset(50%);
	white-space: nowrap;
}

.flue-conversation,
.flue-threads {
	display: flex;
	flex: 1;
	flex-direction: column;
	min-height: 0;
}

.flue-conversation[hidden],
.flue-threads[hidden] {
	display: none;
}

.flue-title {
	flex: none;
	padding: var(--spacer-2) var(--spacer-3);
	border-bottom: var(--stroke-width-small) solid var(--color-border);
}

.flue-title__line {
	display: flex;
	gap: var(--spacer-2);
	align-items: baseline;
	min-width: 0;
}

.flue-title__text {
	min-width: 0;
	margin: 0;
	overflow: hidden;
	font-size: var(--text-body-medium-bold-font-size);
	font-weight: var(--text-body-medium-bold-font-weight);
	line-height: var(--text-body-medium-bold-line-height);
	text-overflow: ellipsis;
	white-space: nowrap;
}

.flue-title__meta {
	flex: none;
	color: var(--color-text-secondary);
	white-space: nowrap;
}

.flue-title__hint {
	margin: var(--spacer-1) 0 0;
	color: var(--color-text-danger);
	line-height: var(--text-body-medium-paragraph-line-height);
}

.flue-threads__bar {
	display: flex;
	flex: none;
	gap: var(--spacer-2);
	align-items: center;
	margin: var(--spacer-2-5) var(--spacer-3) 0;
}

.flue-tabs {
	display: flex;
	gap: var(--spacer-1);
}

.flue-tabs__tab {
	height: var(--button-height);
	padding: 0 var(--spacer-2);
	border: 0;
	border-radius: var(--button-radius);
	background: transparent;
	color: var(--color-text-secondary);
	font: inherit;
	cursor: pointer;
}

.flue-tabs__tab:hover {
	background: var(--color-bg-transparent-hover);
	color: var(--color-text);
}

.flue-tabs__tab[aria-selected="true"] {
	background: var(--color-bg-selected);
	color: var(--color-text);
}

.flue-tabs__tab:focus-visible {
	outline: var(--accessibility-outline);
	outline-offset: var(--accessibility-outline-offset);
}

.flue-threads__filter {
	position: relative;
	display: flex;
	min-width: 0;
	margin-inline-start: auto;
}

.flue-threads__filter .flue-panel__agent-select {
	color: var(--color-text-secondary);
	font-weight: var(--text-body-medium-font-weight);
}

.flue-threads__bar + .flue-search {
	margin-top: var(--spacer-2);
}

.flue-search {
	position: relative;
	display: flex;
	flex: none;
	align-items: center;
	margin: var(--spacer-2-5) var(--spacer-3) var(--spacer-1);
	border: var(--stroke-width-small) solid var(--field-color-border);
	border-radius: var(--field-border-radius);
	background: var(--field-color-bg);
}

.flue-search:hover:not(:focus-within) {
	border-color: var(--field-color-border-hover);
}

.flue-search:focus-within {
	border-color: var(--field-color-border-focus);
}

.flue-search__icon {
	display: flex;
	flex: none;
	padding-inline-start: var(--spacer-1);
	color: var(--color-icon-secondary);
}

.flue-search__input {
	flex: 1;
	min-width: 0;
	height: var(--button-height);
	padding: 0 var(--field-padding-inline) 0 var(--spacer-1);
	border: 0;
	background: transparent;
	color: var(--field-color-text);
	font: inherit;
	appearance: none;
}

.flue-search__input:focus-visible {
	outline: none;
}

.flue-search__input::placeholder {
	color: var(--field-color-placeholder);
}

.flue-search__input::-webkit-search-cancel-button {
	display: none;
}

.flue-search__clear {
	color: var(--color-icon-secondary);
}

.flue-threads__pane {
	display: flex;
	flex: 1;
	flex-direction: column;
	min-height: 0;
}

.flue-threads__list {
	flex: 1;
	padding-block: var(--spacer-1) var(--spacer-3);
	overflow-y: auto;
	overscroll-behavior: contain;
	scrollbar-color: var(--scrollbar-color) transparent;
	scrollbar-width: thin;
}

.flue-threads__group {
	margin: 0;
	padding: var(--spacer-2-5) var(--spacer-3) var(--spacer-1);
	color: var(--color-text-secondary);
	font-size: var(--text-body-medium-bold-font-size);
	font-weight: var(--text-body-medium-bold-font-weight);
	line-height: var(--text-body-medium-bold-line-height);
}

.flue-threads__state {
	display: flex;
	flex-direction: column;
	gap: var(--spacer-2);
	align-items: center;
	max-width: 20rem;
	margin: calc(2 * var(--spacer-3)) auto 0;
	padding-inline: var(--spacer-3);
	color: var(--color-text-secondary);
	line-height: var(--text-body-medium-paragraph-line-height);
	text-align: center;
	text-wrap: balance;
}

.flue-threads__state p,
.flue-threads__more p {
	margin: 0;
}

.flue-threads__more {
	display: flex;
	gap: var(--spacer-2);
	align-items: center;
	justify-content: center;
	margin: var(--spacer-2) var(--spacer-3) 0;
	color: var(--color-text-secondary);
}

.flue-threads__skeleton {
	display: flex;
	flex-direction: column;
	gap: var(--spacer-2-5);
	padding: var(--spacer-2-5) var(--spacer-3);
}

.flue-skeleton {
	height: var(--text-body-medium-paragraph-line-height);
	border-radius: var(--radius-medium);
	background: var(--color-bg-secondary);
	animation: flue-skeleton 1.2s ease-in-out infinite alternate;
}

.flue-skeleton:nth-child(3n) {
	width: 70%;
}

.flue-skeleton:nth-child(3n + 1) {
	width: 85%;
}

@keyframes flue-skeleton {
	to {
		opacity: 0.4;
	}
}

.flue-row {
	position: relative;
	display: flex;
	align-items: center;
	isolation: isolate;
}

.flue-row::before {
	position: absolute;
	inset-block: calc(var(--spacer-1) / 2);
	inset-inline: var(--spacer-2);
	z-index: -1;
	border-radius: var(--button-radius);
	content: "";
}

.flue-row:hover::before {
	background: var(--color-bg-secondary);
}

.flue-row[data-active]::before {
	background: var(--color-bg-selected);
}

.flue-row:has(.flue-row__trigger:focus-visible)::before {
	outline: var(--accessibility-outline);
	outline-offset: var(--accessibility-outline-offset);
}

.flue-row__trigger {
	display: flex;
	flex: 1;
	gap: var(--spacer-1-5);
	align-items: center;
	min-width: 0;
	padding-block: var(--spacer-1-5);
	padding-inline: var(--spacer-2-5) var(--spacer-3);
	border: 0;
	background: transparent;
	color: inherit;
	font: inherit;
	text-align: start;
	cursor: pointer;
}

.flue-row__trigger:focus-visible {
	outline: none;
}

.flue-row__status {
	display: flex;
	flex: none;
	align-items: center;
	justify-content: center;
	width: var(--spacer-3);
	color: var(--color-icon-secondary);
}

.flue-row__glyph {
	display: flex;
}

.flue-row__unread {
	width: var(--spacer-1-5);
	height: var(--spacer-1-5);
	border-radius: var(--radius-full);
	background: var(--color-icon-brand);
}

.flue-row__failed {
	display: flex;
	color: var(--color-text-danger);
}

.flue-row__text {
	display: flex;
	flex: 1;
	flex-direction: column;
	min-width: 0;
}

.flue-row__title,
.flue-row__meta {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.flue-row[data-unread] .flue-row__title {
	font-weight: var(--text-body-medium-bold-font-weight);
}

.flue-row__meta,
.flue-row__time {
	color: var(--color-text-secondary);
}

.flue-row__time {
	flex: none;
	font-variant-numeric: tabular-nums;
	white-space: nowrap;
}

.flue-row__archive {
	position: absolute;
	inset-inline-end: var(--spacer-2-5);
	height: calc(var(--button-height) - var(--spacer-1));
	padding: 0 var(--spacer-1-5);
	border: 0;
	border-radius: var(--button-radius);
	background: transparent;
	color: var(--color-text-secondary);
	font: inherit;
	cursor: pointer;
	opacity: 0;
	pointer-events: none;
}

.flue-row:is(:hover, :focus-within) .flue-row__archive {
	opacity: 1;
	pointer-events: auto;
}

.flue-row:is(:hover, :focus-within):has(.flue-row__archive) .flue-row__time {
	visibility: hidden;
}

.flue-row__archive:hover {
	background: var(--color-bg-transparent-hover);
	color: var(--color-text);
}

.flue-row__archive:focus-visible {
	outline: var(--accessibility-outline);
	outline-offset: var(--accessibility-outline-offset);
}

@media (hover: none) {
	.flue-row__archive {
		position: static;
		flex: none;
		margin-inline-end: var(--spacer-2-5);
		opacity: 1;
		pointer-events: auto;
	}

	.flue-row:has(.flue-row__archive) .flue-row__trigger {
		padding-inline-end: var(--spacer-1);
	}

	.flue-row:is(:hover, :focus-within):has(.flue-row__archive) .flue-row__time {
		visibility: visible;
	}
}

.flue-thread {
	display: flex;
	flex: 1;
	flex-direction: column;
	min-height: 0;
}

.flue-thread__viewport {
	display: flex;
	flex: 1;
	flex-direction: column;
	gap: var(--spacer-3);
	padding: var(--spacer-3);
	overflow-y: auto;
	overscroll-behavior: contain;
	scrollbar-color: var(--scrollbar-color) transparent;
	scrollbar-width: thin;
}

.flue-thread__empty {
	display: flex;
	flex-direction: column;
	gap: var(--spacer-1);
	max-width: 20rem;
	margin: auto;
	color: var(--color-text-secondary);
	line-height: var(--text-body-medium-paragraph-line-height);
	text-align: center;
	text-wrap: balance;
}

.flue-thread__empty-title {
	color: var(--color-text);
	font-size: var(--text-heading-small-font-size);
	font-weight: var(--text-heading-small-font-weight);
	line-height: var(--text-heading-small-line-height);
}

.flue-thread__working {
	display: flex;
	flex: none;
	gap: var(--spacer-1-5);
	align-items: center;
	margin: 0;
	color: var(--color-text-secondary);
}

.flue-message {
	position: relative;
	display: flex;
	flex: none;
	flex-direction: column;
	gap: var(--spacer-2);
	min-width: 0;
	line-height: var(--text-body-medium-paragraph-line-height);
}

.flue-message__text {
	margin: 0;
	overflow-wrap: anywhere;
	white-space: pre-wrap;
}

.flue-message--user {
	align-self: flex-end;
	max-width: 85%;
	padding: var(--spacer-1-5) var(--spacer-2-5);
	border-radius: var(--radius-large);
	background: var(--color-bg-secondary);
}

.flue-message--system {
	flex-direction: row;
	align-items: center;
	color: var(--color-text-secondary);
}

.flue-message--system::before,
.flue-message--system::after {
	flex: 1;
	border-top: var(--stroke-width-small) solid var(--color-border);
	content: "";
}

.flue-message--system .flue-message__text {
	flex: none;
	max-width: 80%;
	text-align: center;
}

.flue-message__actions {
	display: flex;
	gap: var(--spacer-1);
	margin-block-start: calc(-1 * var(--spacer-1));
	margin-inline-start: calc(-1 * var(--spacer-1-5));
}

.flue-message__actions[data-floating] {
	position: absolute;
	top: calc(100% - var(--spacer-1));
	inset-inline-start: 0;
	margin-block-start: 0;
	border-radius: var(--button-radius);
	background: var(--color-bg);
}

.flue-message__action {
	color: var(--color-icon-secondary);
}

.flue-message__action:hover {
	color: var(--color-icon);
}

.flue-message__copy {
	display: flex;
}

.flue-message__copied {
	display: none;
	color: var(--color-icon-success);
}

.flue-message__action[data-copied] .flue-message__copy {
	display: none;
}

.flue-message__action[data-copied] .flue-message__copied {
	display: flex;
}

.flue-markdown {
	min-width: 0;
	overflow-wrap: anywhere;
}

.flue-markdown > :first-child {
	margin-top: 0;
}

.flue-markdown > :last-child {
	margin-bottom: 0;
}

.flue-markdown :is(p, ul, ol, pre, blockquote, hr) {
	margin: 0 0 var(--spacer-2);
}

.flue-markdown :is(h1, h2, h3, h4, h5, h6) {
	margin: var(--spacer-3) 0 var(--spacer-1);
	font-size: var(--text-body-medium-bold-font-size);
	font-weight: var(--text-body-medium-bold-font-weight);
	line-height: var(--text-body-medium-bold-line-height);
}

.flue-markdown :is(h1, h2) {
	font-size: var(--text-heading-small-font-size);
	font-weight: var(--text-heading-small-font-weight);
	line-height: var(--text-heading-small-line-height);
}

.flue-markdown :is(ul, ol) {
	padding-inline-start: calc(var(--spacer-3) + var(--spacer-1));
}

.flue-markdown ul {
	list-style: disc;
}

.flue-markdown ol {
	list-style: decimal;
}

.flue-markdown li + li,
.flue-markdown li > :is(ul, ol) {
	margin-top: var(--spacer-1);
}

.flue-markdown li > :is(ul, ol, p) {
	margin-bottom: 0;
}

.flue-markdown li::marker {
	color: var(--color-text-secondary);
}

.flue-markdown strong {
	font-weight: var(--text-body-medium-bold-font-weight);
}

.flue-markdown a {
	color: var(--color-text-brand);
	text-decoration: underline;
	text-underline-offset: 0.2em;
}

.flue-markdown :not(pre) > code {
	padding: 0 var(--spacer-1);
	border-radius: var(--radius-chip);
	background: var(--color-bg-secondary);
	font-family: var(--font-mono);
	font-size: var(--text-mono-small-font-size);
}

.flue-markdown pre,
.flue-tool__code {
	padding: var(--spacer-2) var(--spacer-2-5);
	border-radius: var(--radius-medium);
	background: var(--color-bg-secondary);
	font-family: var(--font-mono);
	font-size: var(--text-mono-small-font-size);
	line-height: var(--text-mono-small-line-height);
	scrollbar-width: thin;
}

.flue-markdown pre {
	overflow-x: auto;
}

.flue-markdown blockquote {
	padding-inline-start: var(--spacer-2-5);
	border-inline-start: var(--stroke-width-medium) solid var(--color-border);
	color: var(--color-text-secondary);
}

.flue-markdown hr {
	border: 0;
	border-top: var(--stroke-width-small) solid var(--color-border);
}

.flue-disclosure {
	display: flex;
	gap: var(--spacer-1);
	align-items: center;
	width: calc(100% + 2 * var(--spacer-2));
	min-height: var(--button-height);
	margin-inline: calc(-1 * var(--spacer-2));
	padding-inline: var(--spacer-1) var(--spacer-2);
	border: 0;
	border-radius: var(--button-radius);
	background: transparent;
	color: var(--color-text-secondary);
	font: inherit;
	text-align: start;
	list-style: none;
	cursor: pointer;
}

.flue-disclosure::-webkit-details-marker {
	display: none;
}

.flue-disclosure:hover {
	background: var(--color-bg-transparent-hover);
	color: var(--color-text);
}

.flue-disclosure__chevron {
	display: flex;
	flex: none;
	color: var(--color-icon-secondary);
	transition: rotate 150ms ease-out;
}

.flue-reasoning[open] > .flue-disclosure .flue-disclosure__chevron,
.flue-disclosure[aria-expanded="true"] .flue-disclosure__chevron {
	rotate: 90deg;
}

.flue-disclosure__label {
	flex: 1;
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.flue-message--assistant > :is(.flue-reasoning, .flue-tool) + :is(.flue-reasoning, .flue-tool) {
	margin-top: calc(-1 * var(--spacer-2));
}

.flue-reasoning {
	color: var(--color-text-secondary);
}

.flue-reasoning__body {
	margin-block: var(--spacer-1) var(--spacer-2);
	margin-inline-start: calc(var(--spacer-1) - var(--stroke-width-small));
	padding-inline-start: var(--spacer-2-5);
	border-inline-start: var(--stroke-width-small) solid var(--color-border);
}

.flue-tool__status {
	display: inline-flex;
	flex: none;
	gap: var(--spacer-1);
	align-items: center;
}

.flue-tool[data-state="failed"] .flue-tool__status {
	color: var(--color-text-danger);
}

.flue-tool__details {
	display: flex;
	flex-direction: column;
	gap: var(--spacer-1);
	margin-block: var(--spacer-1) var(--spacer-2);
}

.flue-tool__label {
	margin: var(--spacer-1) 0 0;
	color: var(--color-text-secondary);
}

.flue-tool__code {
	max-height: 16rem;
	margin: 0;
	overflow: auto;
	color: var(--color-text);
	white-space: pre-wrap;
	overflow-wrap: anywhere;
}

.flue-approval {
	display: flex;
	flex-direction: column;
	gap: var(--spacer-2);
	padding: var(--spacer-2) var(--spacer-2-5);
	border-radius: var(--radius-medium);
	background: var(--color-bg-warning-tertiary);
	color: var(--color-text);
}

.flue-approval[data-state="approved"] {
	background: var(--color-bg-success-tertiary);
}

.flue-approval:is(
		[data-state="loading"],
		[data-state="rejected"],
		[data-state="closed"],
		[data-state="readOnly"]
	) {
	background: var(--color-bg-secondary);
}

.flue-approval__status,
.flue-approval__error {
	margin: 0;
}

.flue-approval__status {
	font-weight: var(--text-body-medium-bold-font-weight);
}

.flue-approval__error {
	color: var(--color-text-danger);
}

.flue-approval__footer {
	display: flex;
	flex-wrap: wrap;
	gap: var(--spacer-2);
	align-items: center;
}

.flue-approval__actions {
	display: flex;
	gap: var(--spacer-2);
}

.flue-approval__actions + .flue-approval__review {
	margin-inline-start: auto;
}

.flue-approval__review {
	color: inherit;
	text-decoration: underline;
	text-underline-offset: 0.2em;
}

.flue-composer {
	display: flex;
	flex: none;
	flex-direction: column;
	margin: 0 var(--spacer-3) var(--spacer-3);
	border: var(--stroke-width-small) solid var(--field-color-border);
	border-radius: var(--field-border-radius);
	background: var(--field-color-bg);
}

.flue-composer:hover:not(:focus-within) {
	border-color: var(--field-color-border-hover);
}

.flue-composer:focus-within {
	border-color: var(--field-color-border-focus);
}

.flue-composer:has(.flue-composer__input:disabled) {
	border-color: var(--field-color-border-disabled);
	background: var(--field-color-bg-disabled);
	cursor: not-allowed;
}

.flue-composer__input {
	display: block;
	width: 100%;
	padding: var(--spacer-2) var(--field-padding-inline) 0;
	border: 0;
	background: transparent;
	color: var(--field-color-text);
	font: inherit;
	line-height: var(--text-body-medium-paragraph-line-height);
	resize: none;
	scrollbar-width: thin;
}

.flue-composer__input:focus-visible {
	outline: none;
}

.flue-composer__input::placeholder {
	color: var(--field-color-placeholder);
}

.flue-composer__input:disabled {
	color: var(--field-color-text-disabled);
	cursor: not-allowed;
}

.flue-composer__actions {
	display: flex;
	gap: var(--spacer-1);
	justify-content: flex-end;
	padding: var(--spacer-1);
}

@media (prefers-reduced-motion: reduce) {
	.flue-panel {
		animation: none;
	}

	.flue-panel__resize::after,
	.flue-disclosure__chevron {
		transition: none;
	}

	.flue-skeleton {
		animation: none;
	}
}
`;
