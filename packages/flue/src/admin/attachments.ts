import type { AgentFiles, FlueApi } from "./api.js";
import type {
	AttachmentAdapter,
	CompleteAttachment,
	PendingAttachment,
	ThreadUserMessagePart,
} from "@assistant-ui/react";
import type { FlueConversationMessage } from "@flue/sdk";

/** A `file` part of a conversation message. */
export type FilePart = Extract<
	FlueConversationMessage["parts"][number],
	{ type: "file" }
>;

// The types by file extension, which browsers report inconsistently or not at all.
const EXTENSION_TYPES: Record<string, string> = {
	".md": "text/markdown",
	".markdown": "text/markdown",
	".txt": "text/plain",
	".csv": "text/csv",
};

const extensionOf = (name: string): string => {
	const dot = name.lastIndexOf(".");

	return dot === -1 ? "" : name.slice(dot).toLowerCase();
};

// Whether an allowed type, exact or a `type/*` wildcard as Payload takes it, admits `mimeType`.
const admits = (allowed: string, mimeType: string): boolean =>
	allowed.endsWith("/*")
		? mimeType.startsWith(allowed.slice(0, -1))
		: allowed === mimeType;

/**
 * The type of a file if an allowed type admits it: the type of its
 * extension, else the type the browser reports, since browsers report an
 * empty or generic type for files such as `.md` or `.csv`. Never a
 * wildcard.
 */
export const mimeTypeOf = (
	file: Pick<File, "name" | "type">,
	allowed: readonly string[],
): string | undefined => {
	const byExtension = EXTENSION_TYPES[extensionOf(file.name)];

	return [byExtension, file.type].find(
		(type): type is string =>
			type !== undefined &&
			type !== "" &&
			allowed.some((candidate) => admits(candidate, type)),
	);
};

// The file picker's filter: the allowed types, and the extensions of the mapped ones.
const acceptOf = (allowed: readonly string[]): string =>
	[
		...allowed,
		...Object.keys(EXTENSION_TYPES).filter((extension) =>
			allowed.some((candidate) =>
				admits(candidate, EXTENSION_TYPES[extension] ?? ""),
			),
		),
	].join(",");

// Unique within the page; `crypto.randomUUID` needs a secure context.
let attachmentCount = 0;

const refuse = (message: string): Promise<never> =>
	Promise.reject(new Error(message));

// An uploaded file as an attachment's content, which carries its collection and id.
const REF_SCHEME = "flue-file:";

/** A file of an upload collection, as an attachment's content names it. */
export interface UploadRef {
	collection: string;
	id: string;
}

/** The content of an attachment that stands for an uploaded file. */
export const fileRefPart = (
	ref: UploadRef,
	name: string,
	mimeType: string,
): ThreadUserMessagePart => ({
	type: "file",
	data: `${REF_SCHEME}${encodeURIComponent(ref.collection)}/${encodeURIComponent(ref.id)}`,
	mimeType,
	filename: name,
});

/** The uploaded file a file part's data stands for, or undefined for any other. */
export const uploadRefOf = (data: string): undefined | UploadRef => {
	if (!data.startsWith(REF_SCHEME)) {
		return undefined;
	}

	const [collection, id, ...rest] = data.slice(REF_SCHEME.length).split("/");

	return collection && id && rest.length === 0
		? { collection: decodeURIComponent(collection), id: decodeURIComponent(id) }
		: undefined;
};

const fileIdOf = (
	part: ThreadUserMessagePart | undefined,
): string | undefined =>
	part?.type === "file" ? uploadRefOf(part.data)?.id : undefined;

/**
 * The composer's attachment adapter for an agent that takes files. A file
 * is checked against the agent's types and count, uploaded to the upload
 * collection as soon as it is added with its progress shown, and sent as
 * its id; the collection's own checks decide the rest. Removing it deletes
 * the upload, once it finishes when it is still in flight.
 */
export const fileAdapter = (
	limits: AgentFiles,
	count: () => number,
	api: Pick<FlueApi, "deleteFile" | "uploadFile">,
): AttachmentAdapter => {
	// The attachments removed while their upload was in flight.
	const removed = new Set<string>();

	return {
		accept: acceptOf(limits.mimeTypes),

		add: async function* ({ file }) {
			const mimeType = mimeTypeOf(file, limits.mimeTypes);

			if (mimeType === undefined) {
				return await refuse(`${file.name} is not a file type the agent takes.`);
			}

			if (count() >= limits.maxFiles) {
				return await refuse(
					`A message takes at most ${String(limits.maxFiles)} files.`,
				);
			}

			if (file.size === 0) {
				return await refuse(`${file.name} is empty.`);
			}

			const base = {
				id: `attachment-${String(++attachmentCount)}`,
				type: mimeType.startsWith("image/") ? "image" : "document",
				name: file.name,
				contentType: mimeType,
				file,
			};
			const progress: number[] = [];
			let wake = (): void => undefined;
			const outcome: { id?: string; error?: unknown; failed?: true } = {};

			// The browser reports an empty type for some files, so the mapped one is sent.
			api
				.uploadFile(
					limits.collection,
					new File([file], file.name, { type: mimeType }),
					(fraction) => {
						progress.push(fraction);
						wake();
					},
				)
				.then(
					(id) => {
						outcome.id = id;

						if (removed.delete(base.id)) {
							void api.deleteFile(limits.collection, id).catch(() => undefined);
						}
					},
					(error: unknown) => {
						removed.delete(base.id);
						outcome.error = error;
						outcome.failed = true;
					},
				)
				.finally(() => {
					wake();
				});

			yield {
				...base,
				status: { type: "running", reason: "uploading", progress: 0 },
			};

			const settled = (): boolean =>
				outcome.id !== undefined || outcome.failed !== undefined;

			while (!settled()) {
				// eslint-disable-next-line no-await-in-loop
				await new Promise<void>((resolve) => {
					wake = resolve;

					if (progress.length > 0 || settled()) {
						resolve();
					}
				});

				const fraction = progress.pop();

				progress.length = 0;

				if (fraction !== undefined && !settled()) {
					yield {
						...base,
						status: {
							type: "running",
							reason: "uploading",
							progress: fraction,
						},
					};
				}
			}

			if (outcome.id === undefined) {
				throw outcome.error;
			}

			yield {
				...base,
				content: [
					fileRefPart(
						{ collection: limits.collection, id: outcome.id },
						file.name,
						mimeType,
					),
				],
				status: { type: "requires-action", reason: "composer-send" },
			};
		},

		send: (attachment: PendingAttachment): Promise<CompleteAttachment> =>
			Promise.resolve({
				...attachment,
				status: { type: "complete" },
				content: attachment.content ?? [],
			}),

		remove: async (attachment) => {
			const id = fileIdOf(attachment.content?.[0]);

			if (id === undefined) {
				removed.add(attachment.id);
			} else {
				await api.deleteFile(limits.collection, id);
			}
		},
	};
};

/** The uploaded files of a sent message as the `file` parts of its optimistic echo. */
export const echoReferences = (
	attachments: readonly CompleteAttachment[],
): FilePart[] =>
	attachments.flatMap((attachment) =>
		attachment.content.flatMap((part): FilePart[] =>
			part.type === "file" && uploadRefOf(part.data) !== undefined
				? [
						{
							type: "file",
							mediaType: part.mimeType,
							url: part.data,
							...(part.filename === undefined
								? {}
								: { filename: part.filename }),
						},
					]
				: [],
		),
	);

/** The ids of the uploaded files of a sent message. */
export const fileIdsOf = (
	attachments: readonly CompleteAttachment[],
): string[] =>
	attachments.flatMap((attachment) => fileIdOf(attachment.content[0]) ?? []);

// The kinds of file a drop takes, in the order the hint names them.
const KINDS: ReadonlyArray<readonly [string, (mimeType: string) => boolean]> = [
	["images", (mimeType) => mimeType.startsWith("image/")],
	["PDFs", (mimeType) => mimeType === "application/pdf"],
	["text files", (mimeType) => mimeType.startsWith("text/")],
];

/** The limits a drop reads. */
export type Attachable = Pick<AgentFiles, "maxFiles" | "mimeTypes">;

/** What a drop on the chat takes, such as "Images and PDFs, up to 4 per message". */
export const dropHint = (limits: Attachable): string => {
	const kinds = KINDS.filter(([, matches]) =>
		limits.mimeTypes.some(matches),
	).map(([name]) => name);
	const others = limits.mimeTypes.some((mimeType) =>
		KINDS.every(([, matches]) => !matches(mimeType)),
	);

	if (others && kinds.length > 0) {
		kinds.push("other files");
	}

	const listed =
		kinds.length > 1
			? `${kinds.slice(0, -1).join(", ")} and ${kinds.at(-1) ?? ""}`
			: (kinds[0] ?? "files");
	const files =
		limits.maxFiles === 1
			? "one per message"
			: `up to ${String(limits.maxFiles)} per message`;

	return `${listed.charAt(0).toUpperCase()}${listed.slice(1)}, ${files}`;
};
