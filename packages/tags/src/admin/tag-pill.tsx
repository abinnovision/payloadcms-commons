"use client";

import { colorForName, isHexColor } from "../index.js";
import { TagsStyles } from "./styles.js";

import type { CSSProperties, ReactNode } from "react";

export interface TagPillProps {
	label: string;
	/** Any hex color. Missing or invalid falls back to the name-derived one. */
	color?: unknown;
	/** Gray, for a tag that could not be read. */
	muted?: boolean;
}

/** The `--tags-color` custom property the stylesheet mixes into a pill or swatch. */
export const tagColorStyle = (color: string): CSSProperties => {
	const style: Record<string, string> = { "--tags-color": color };

	return style;
};

/**
 * One tag as a pill tinted by its color. The color is exposed as
 * `--tags-color`, and the stylesheet mixes it against Payload's theme
 * variables, so the same markup reads well in the light and the dark theme.
 */
export const TagPill = (props: TagPillProps): ReactNode => {
	const color = isHexColor(props.color)
		? props.color
		: colorForName(props.label);

	return (
		<>
			<TagsStyles />
			<span
				className={props.muted ? "tags-pill tags-pill--muted" : "tags-pill"}
				style={props.muted ? undefined : tagColorStyle(color)}
				title={props.label}
			>
				<span className="tags-pill__label">{props.label}</span>
			</span>
		</>
	);
};
