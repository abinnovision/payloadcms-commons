import { normalizeAddress, normalizeAddressList } from "./address.js";
import { toBase64, toText } from "./content.js";
import { LettermintEmailError } from "./errors.js";

import type { Attachment, FromField, Headers } from "./nodemailer.js";
import type { LettermintSettings, LettermintTag } from "./types.js";
import type { SendEmailOptions } from "payload";

/** One attachment in Lettermint's wire shape. */
interface LettermintAttachment {
	filename: string;
	content: string;
	content_type?: string;
	content_id?: string;
}

/** The body of `POST /v1/send`. */
interface LettermintSendRequest {
	from: string;
	to: string[];
	subject: string;
	cc?: string[];
	bcc?: string[];
	reply_to?: string[];
	html?: string;
	text?: string;
	headers?: Record<string, string>;
	metadata?: Record<string, string>;
	tags?: LettermintTag[];
	route?: string;
	settings?: LettermintSettings;
	attachments?: LettermintAttachment[];
}

interface MessageDefaults {
	from: string;
	route: string | undefined;
	settings: LettermintSettings | undefined;
	metadata: Record<string, string> | undefined;
	tags: LettermintTag[] | undefined;
	overrideRecipientAddress: string | undefined;
}

interface MappedMessage {
	body: LettermintSendRequest;
	/** Fields present on the message that Lettermint cannot express. */
	dropped: string[];
}

/**
 * Nodemailer options with no counterpart in the Lettermint API. They are
 * reported rather than silently ignored, because a caller who set `envelope`
 * or `dkim` is expecting behaviour that will not happen.
 */
const UNSUPPORTED_FIELDS = [
	"alternatives",
	"amp",
	"attachDataUrls",
	"date",
	"disableFileAccess",
	"disableUrlAccess",
	"dkim",
	"encoding",
	"envelope",
	"icalEvent",
	"list",
	"normalizeHeaderKey",
	"priority",
	"raw",
	"sender",
	"textEncoding",
	"watchHtml",
	"xMailer",
] as const;

/**
 * Lettermint refuses this type outright, so an attachment that only carries the
 * generic fallback is better off with no declared type at all: the API then
 * detects one from the filename.
 */
const BLOCKED_CONTENT_TYPE = "application/octet-stream";

/**
 * Per-attachment nodemailer options the API has no field for. `raw` and
 * `contentTransferEncoding` describe MIME framing that Lettermint builds
 * itself, and per-attachment headers have nowhere to go.
 */
const UNSUPPORTED_ATTACHMENT_FIELDS = [
	"contentTransferEncoding",
	"headers",
	"raw",
] as const;

/**
 * Names the per-attachment options that will not survive the mapping.
 * `contentDisposition: "inline"` only counts when no `cid` accompanies it,
 * because a `content_id` is how Lettermint expresses inline in the first place.
 */
const droppedAttachmentFields = (attachments: Attachment[]): string[] =>
	attachments.flatMap((attachment, index) => {
		const names: string[] = UNSUPPORTED_ATTACHMENT_FIELDS.filter(
			(field) => attachment[field] !== undefined,
		);

		if (
			attachment.contentDisposition === "inline" &&
			attachment.cid === undefined
		) {
			names.push("contentDisposition");
		}

		return names.map((name) => `attachments[${String(index)}].${name}`);
	});

/**
 * Flattens both header shapes nodemailer accepts into the flat record
 * Lettermint takes. Repeated values are joined rather than dropped.
 */
const normalizeHeaders = (headers: Headers): Record<string, string> => {
	const result: Record<string, string> = {};

	const set = (key: string, value: string): void => {
		const existing = result[key];

		result[key] = existing === undefined ? value : `${existing}, ${value}`;
	};

	if (Array.isArray(headers)) {
		for (const { key, value } of headers) {
			set(key, value);
		}

		return result;
	}

	for (const [key, value] of Object.entries(headers)) {
		if (typeof value === "string") {
			set(key, value);
		} else if (Array.isArray(value)) {
			set(key, value.join(", "));
		} else {
			set(key, value.value);
		}
	}

	return result;
};

const toLettermintAttachment = async (
	attachment: Attachment,
	index: number,
): Promise<LettermintAttachment> => {
	const { filename } = attachment;

	if (typeof filename !== "string" || filename === "") {
		throw new LettermintEmailError(
			`Attachment at index ${String(index)} has no filename. Lettermint requires one.`,
		);
	}

	const source = attachment.content ?? attachment;
	const content = await toBase64(source, filename, attachment.encoding);

	return {
		filename,
		content,
		...(attachment.contentType !== undefined &&
		attachment.contentType !== BLOCKED_CONTENT_TYPE
			? { content_type: attachment.contentType }
			: {}),
		...(attachment.cid !== undefined ? { content_id: attachment.cid } : {}),
	};
};

/**
 * The headers to send, combining the caller's own with the ones Lettermint
 * needs to preserve a submitted Message-ID and to keep a thread intact.
 */
const buildHeaders = (message: SendEmailOptions): Record<string, string> => {
	const headers: Record<string, string> = message.headers
		? normalizeHeaders(message.headers)
		: {};

	// Lettermint mints its own Message-ID unless told to keep the submitted one.
	if (message.messageId !== undefined) {
		headers["Message-ID"] = message.messageId;
		headers["X-LM-Preserve-Message-ID"] = "true";
	}

	if (message.inReplyTo !== undefined) {
		headers["In-Reply-To"] = normalizeAddress(message.inReplyTo);
	}

	if (message.references !== undefined) {
		headers["References"] = Array.isArray(message.references)
			? message.references.join(" ")
			: message.references;
	}

	return headers;
};

/**
 * Turns the message Payload hands the adapter into a Lettermint send request.
 * `from` falls back to the configured default, and
 * `overrideRecipientAddress` is applied last so it also clears `cc` and `bcc`:
 * redirecting only `to` would still deliver copies to real people.
 */
const toSendMailRequest = async (
	message: SendEmailOptions,
	defaults: MessageDefaults,
): Promise<MappedMessage> => {
	const dropped: string[] = UNSUPPORTED_FIELDS.filter(
		(field) => message[field as keyof SendEmailOptions] !== undefined,
	);

	const headers = buildHeaders(message);

	const [html, text] = await Promise.all([
		toText(message.html, "html"),
		toText(message.text, "text"),
	]);

	const attachments = message.attachments
		? await Promise.all(message.attachments.map(toLettermintAttachment))
		: undefined;

	if (message.attachments) {
		dropped.push(...droppedAttachmentFields(message.attachments));
	}

	const from = message.from as FromField | undefined;
	const override = defaults.overrideRecipientAddress;
	const cc = normalizeAddressList(message.cc);
	const bcc = normalizeAddressList(message.bcc);
	const replyTo = normalizeAddressList(message.replyTo);

	const body: LettermintSendRequest = {
		from: from ? normalizeAddress(from) : defaults.from,
		to: override ? [override] : normalizeAddressList(message.to),
		subject: message.subject ?? "",
		...(!override && cc.length > 0 ? { cc } : {}),
		...(!override && bcc.length > 0 ? { bcc } : {}),
		...(replyTo.length > 0 ? { reply_to: replyTo } : {}),
		/*
		 * Lettermint rejects a body shorter than three characters, so an empty
		 * one is left out entirely rather than sent and refused.
		 */
		...(html !== undefined && html !== "" ? { html } : {}),
		...(text !== undefined && text !== "" ? { text } : {}),
		...(Object.keys(headers).length > 0 ? { headers } : {}),
		...(defaults.metadata ? { metadata: defaults.metadata } : {}),
		...(defaults.tags ? { tags: defaults.tags } : {}),
		...(defaults.route !== undefined ? { route: defaults.route } : {}),
		...(defaults.settings ? { settings: defaults.settings } : {}),
		...(attachments && attachments.length > 0 ? { attachments } : {}),
	};

	return { body, dropped };
};

export {
	droppedAttachmentFields,
	normalizeHeaders,
	toSendMailRequest,
	UNSUPPORTED_FIELDS,
};
export type {
	LettermintAttachment,
	LettermintSendRequest,
	MappedMessage,
	MessageDefaults,
};
