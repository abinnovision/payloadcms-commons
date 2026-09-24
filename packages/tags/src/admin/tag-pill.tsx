"use client";

import { colorForName, isHexColor } from "../index.js";
import { TagsStyles } from "./styles.js";

import type { ReactNode } from "react";

export interface TagPillProps {
	label: string;
	/** Any hex color. Missing or invalid falls back to the name-derived one. */
	color?: string | null | undefined;
	/** Gray, for a tag that could not be read. */
	muted?: boolean;
}

/**
 * One tag as a pill tinted by its color. The color is exposed as
 * `--tags-color`, and the stylesheet mixes it against Payload's theme
 * variables, so the same markup reads well in the light and the dark theme.
 */
export const TagPill = (props: TagPillProps): ReactNode => {
	const color = isHexColor(props.color)
		? props.color
		: colorForName(props.label);
	const style: Record<string, string> = { "--tags-color": color };

	return (
		<>
			<TagsStyles />
			<span
				className={props.muted ? "tags-pill tags-pill--muted" : "tags-pill"}
				style={props.muted ? undefined : style}
				title={props.label}
			>
				<span className="tags-pill__label">{props.label}</span>
			</span>
		</>
	);
};
