"use client";

import { PayloadLink } from "@payloadcms/ui";
import { useContext, useEffect, useState } from "react";

import { reviewPath } from "./confirmation.js";
import { ToolsContext } from "./tools.js";
import { isRecord } from "../protocol/guards.js";

import type { PayloadUpload } from "../protocol/events.js";
import type { DataMessagePartComponent } from "@assistant-ui/react";

const isUpload = (value: unknown): value is PayloadUpload =>
	isRecord(value) &&
	typeof value["collection"] === "string" &&
	(typeof value["id"] === "string" || typeof value["id"] === "number") &&
	typeof value["filename"] === "string" &&
	typeof value["mimeType"] === "string" &&
	typeof value["size"] === "number" &&
	typeof value["adminUrl"] === "string";

/** The well-formed entries of a `data-payload-file` part's data. */
const uploadsOf = (data: unknown): PayloadUpload[] =>
	isRecord(data) && Array.isArray(data["files"])
		? data["files"].filter(isUpload)
		: [];

const sizeText = (bytes: number): string => {
	if (bytes < 1024) {
		return `${String(bytes)} B`;
	}

	return bytes < 1_048_576
		? `${(bytes / 1024).toFixed(1)} KiB`
		: `${(bytes / 1_048_576).toFixed(1)} MiB`;
};

/**
 * The files the agent uploaded in one response, each linking to its
 * document. A link outside the admin's collections is left out, so the
 * card never leads off the admin's origin. Malformed data renders nothing.
 */
export const FileCard: DataMessagePartComponent = ({ data }) => {
	const tools = useContext(ToolsContext);
	const uploads = uploadsOf(data);

	if (uploads.length === 0) {
		return null;
	}

	return (
		<div className="flue-files">
			<p className="flue-files__title">
				{uploads.length === 1 ? "Uploaded file" : "Uploaded files"}
			</p>
			<ul className="flue-files__list">
				{uploads.map((upload) => {
					const href =
						tools === null
							? undefined
							: reviewPath(upload.adminUrl, tools.origin, tools.adminRoute);

					return (
						<li
							className="flue-files__item"
							key={`${upload.collection}:${String(upload.id)}`}
						>
							{href === undefined ? (
								<span className="flue-files__name">{upload.filename}</span>
							) : (
								<PayloadLink className="flue-files__name" href={href}>
									{upload.filename}
								</PayloadLink>
							)}
							<span className="flue-files__meta">
								{`${upload.mimeType}, ${sizeText(upload.size)}`}
							</span>
						</li>
					);
				})}
			</ul>
		</div>
	);
};

/*
 * A workspace file a user's message references. Its link is Payload's file
 * route, read when the card shows; a file that is gone shows struck through.
 * While the lookup runs or fails, only the name shows.
 */
export const WorkspaceFile: React.FC<{ id: string; name: string }> = ({
	id,
	name,
}) => {
	const tools = useContext(ToolsContext);
	const [link, setLink] = useState<null | string>();

	useEffect(() => {
		if (tools?.filesSlug === undefined) {
			return;
		}

		let active = true;

		tools.api
			.fileLink(tools.filesSlug, id)
			.then((found) => {
				if (active) {
					setLink(found);
				}
			})
			.catch(() => undefined);

		return () => {
			active = false;
		};
	}, [tools, id]);

	if (link === null) {
		return (
			<span className="flue-attachment flue-attachment--removed">
				{`${name} (removed)`}
			</span>
		);
	}

	return link === undefined ? (
		<span className="flue-attachment">{name}</span>
	) : (
		<a
			className="flue-attachment flue-attachment__link"
			href={link}
			rel="noopener noreferrer"
			target="_blank"
		>
			{name}
		</a>
	);
};
