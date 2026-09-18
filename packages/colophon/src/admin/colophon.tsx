import { NavGroup } from "@payloadcms/ui";

import {
	DEFAULT_COLOPHON_LABEL,
	readColophonOptions,
	resolveItems,
	resolveLabel,
} from "../index.js";

import type { ResolvedColophonItem } from "../index.js";
import type { ServerProps } from "payload";
import type { CSSProperties, ReactNode } from "react";

/**
 * One row, laid out as the label and the value rather than the value alone.
 *
 * A bare value reads as a riddle the moment there is more than one of them:
 * `1.2.3` over `8f079ec` over `staging` gives an editor no way to say which is
 * which when reporting a problem.
 */
const ROW: CSSProperties = {
	display: "flex",
	alignItems: "baseline",
	gap: "calc(var(--base) * 0.4)",
	cursor: "default",
};

/**
 * The elevation Payload uses for secondary text in the sidebar, so the label
 * recedes behind the value without inventing a colour that a theme switch or
 * a Payload upgrade would leave behind.
 */
const LABEL: CSSProperties = {
	color: "var(--theme-elevation-500)",
	flexShrink: 0,
};

/** A long value has to be cut here, or it widens the whole sidebar. */
const VALUE: CSSProperties = {
	overflow: "hidden",
	textOverflow: "ellipsis",
	whiteSpace: "nowrap",
};

const Row = (props: {
	item: ResolvedColophonItem;
	language: string | undefined;
	fallbackLanguage: string | undefined;
}): ReactNode => {
	const label = resolveLabel(
		props.item.label,
		props.language,
		props.fallbackLanguage,
	);

	return (
		/*
		 * Payload's own nav classes rather than a styled `<span>`, so the row
		 * inherits the sidebar's type scale and padding and stays aligned with
		 * the links above it. Not an `<a>`: there is nowhere to go.
		 */
		<span className="nav__link" style={ROW} title={props.item.full}>
			{label !== undefined && (
				<span className="nav__link-label" style={LABEL}>
					{label}
				</span>
			)}
			<span className="nav__link-label" style={VALUE}>
				{props.item.display}
			</span>
		</span>
	);
};

/**
 * The system metadata group at the foot of the admin sidebar.
 *
 * A server component on purpose. Reading `process.env` here happens in the
 * running process on each admin render, so the same image redeployed with a
 * new version reports it without a rebuild, and no consumer has to inline
 * anything through its own bundler config.
 *
 * `NavGroup` is a client component, so rendering it from here opens a client
 * boundary and the resolved strings cross it as props. That is the whole of
 * what reaches the browser: a variable that resolved to no row was never read
 * into the tree, and nothing hands the environment over wholesale.
 */
export const Colophon = (props: ServerProps): ReactNode => {
	const options = readColophonOptions(props.payload.config.custom);
	if (!options) {
		return null;
	}

	if (options.condition && !options.condition({ user: props.user })) {
		return null;
	}

	const items = resolveItems(options.items, (message, error) => {
		props.payload.logger.warn({ err: error }, message);
	});

	/*
	 * An empty group is worse than no group: it takes sidebar height to say
	 * that nothing is configured, which is a message for whoever deployed the
	 * app rather than for the editor looking at it.
	 */
	if (items.length === 0) {
		return null;
	}

	const language = props.i18n.language;
	const fallbackLanguage = props.payload.config.i18n.fallbackLanguage;
	const label =
		resolveLabel(options.label, language, fallbackLanguage) ??
		DEFAULT_COLOPHON_LABEL;

	return (
		<NavGroup isOpen={options.open} label={label}>
			{items.map((item) => (
				<Row
					fallbackLanguage={fallbackLanguage}
					item={item}
					key={item.key}
					language={language}
				/>
			))}
		</NavGroup>
	);
};
