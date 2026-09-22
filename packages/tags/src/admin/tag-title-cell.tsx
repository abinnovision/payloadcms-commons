"use client";

import { Link, useConfig } from "@payloadcms/ui";

import { TagPill } from "./tag-pill.js";

import type { DefaultCellComponentProps, TextFieldClient } from "payload";
import type { ReactNode } from "react";

export type TagTitleCellProps = DefaultCellComponentProps<TextFieldClient>;

/**
 * The title column of the tags list, drawn as the tag's own pill. Keeps
 * `DefaultCell`'s behavior around it: a link to the document in the list
 * view, and a button when a relationship drawer selects rows by click.
 */
export const TagTitleCell = (props: TagTitleCellProps): ReactNode => {
	const { cellData, collectionSlug, link, linkURL, onClick, rowData } = props;
	const {
		config: {
			routes: { admin: adminRoute },
		},
	} = useConfig();

	const id = String(rowData["id"]);
	const label =
		typeof cellData === "string" && cellData !== "" ? cellData : `#${id}`;
	const pill = (
		<TagPill color={rowData["color"] as string | null} label={label} />
	);

	if (typeof onClick === "function") {
		return (
			<button
				className="tags-title-cell"
				onClick={() => {
					onClick({ cellData, collectionSlug, rowData });
				}}
				type="button"
			>
				{pill}
			</button>
		);
	}

	if (link) {
		const trash = props.viewType === "trash" ? "/trash" : "";
		const href =
			linkURL ??
			`${adminRoute}/collections/${collectionSlug}${trash}/${encodeURIComponent(id)}`;

		return (
			<Link className="tags-title-cell" href={href} prefetch={false}>
				{pill}
			</Link>
		);
	}

	return pill;
};
