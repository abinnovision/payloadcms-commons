import type { SendEmailOptions } from "payload";

/**
 * The nodemailer shapes this adapter has to accept, derived from Payload's own
 * `SendEmailOptions` rather than imported from `nodemailer/lib/mailer`: that
 * subpath is a directory, which Node's ESM resolution cannot address, so a
 * direct import fails under `moduleResolution: nodenext`.
 */
type Recipients = NonNullable<SendEmailOptions["to"]>;

/** `{ name?, address }`, nodemailer's structured address. */
type Address = Exclude<Recipients, string | unknown[]>;

/**
 * What `from` may hold. Payload declares it as `Address | string`, but its
 * `Address` comes from a direct `nodemailer/lib/mailer` import that does not
 * resolve, leaving the field effectively untyped; this restates it soundly.
 */
type FromField = Address | string;

/** One entry of `attachments`. */
type Attachment = NonNullable<SendEmailOptions["attachments"]>[number];

/** Either header shape: a record, or an array of `{ key, value }`. */
type Headers = NonNullable<SendEmailOptions["headers"]>;

/** What a body field or an attachment payload may hold. */
type Content = NonNullable<SendEmailOptions["html"]>;

export type { Address, Attachment, Content, FromField, Headers };
