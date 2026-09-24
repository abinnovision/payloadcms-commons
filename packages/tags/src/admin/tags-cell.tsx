"use client";

import { useListRelationships, useTranslation } from "@payloadcms/ui";
import { useEffect } from "react";

import { normalizeCellValues } from "../index.js";
import { TagPill } from "./tag-pill.js";

import type { CellRelationshipValue, TagsCellClientProps } from "../index.js";
import type {
	DefaultCellComponentProps,
	RelationshipFieldClient,
} from "payload";
import type { ReactNode } from "react";

export type TagsCellProps = DefaultCellComponentProps<RelationshipFieldClient> &
	TagsCellClientProps;

/**
 * The tags column of a tagged collection's list: up to three pills, then
 * "+N". Like Payload's own relationship cell, bare ids are resolved through
 * the list's shared `RelationshipProvider`, which batches one request for
 * every row. A tag that cannot be read stays a gray `#id` pill.
 */
export const TagsCell = (props: TagsCellProps): ReactNode => {
	const { cellData, field, tagsSlug, titleField } = props;
	const { documents, getRelationships } = useListRelationships();
	const { t } = useTranslation();

	const values = (
		Array.isArray(cellData) ? cellData : []
	) as CellRelationshipValue[];
	const loaded = documents[tagsSlug];

	const resolved = values.map((value) => {
		if (typeof value === "object") {
			return value;
		}

		const doc = loaded?.[value];
		if (!doc) {
			return value;
		}

		return doc;
	});
	const { visible, overflow } = normalizeCellValues(resolved, titleField);

	/* Only the visible ids, and each once: `null` marks one as requested. */
	const unrequested = visible
		.filter((tag) => !tag.readable && loaded?.[tag.id] === undefined)
		.map((tag) => tag.id);
	const unrequestedKey = unrequested.join(",");

	useEffect(() => {
		if (unrequested.length > 0) {
			getRelationships(
				unrequested.map((value) => ({ relationTo: tagsSlug, value })),
			);
		}
		// `unrequestedKey` stands in for the array, which is new every render.
	}, [unrequestedKey, getRelationships, tagsSlug]);

	if (visible.length === 0) {
		return t("general:noLabel", {
			label: typeof field.label === "string" ? field.label : field.name,
		});
	}

	return (
		<div className="tags-cell">
			{visible.map((tag) => (
				<TagPill
					color={tag.color}
					key={String(tag.id)}
					label={tag.label}
					muted={!tag.readable}
				/>
			))}
			{overflow > 0 && <span className="tags-cell__more">+{overflow}</span>}
		</div>
	);
};
