# @abinnovision/payloadcms-email-lettermint

A Payload CMS email adapter that sends transactional mail through
[Lettermint](https://lettermint.co).

It talks to `POST /v1/send` directly over `fetch`, so the package has no runtime
dependencies and runs anywhere Payload does. Lettermint's own SDK is deliberately
not used: it resolves to a CommonJS build, imports Node's `util/types`, and reads
validation failures from a field the API does not return, so a rejected send
arrives without any indication of what was wrong. This adapter keeps that detail.

## Install

```bash
yarn add @abinnovision/payloadcms-email-lettermint
```

- Peer dependency: `payload >=3.88.0 <4`.
- The package is published as ESM only, matching Payload itself.

## Usage

```ts
import { lettermintAdapter } from "@abinnovision/payloadcms-email-lettermint";
import { buildConfig } from "payload";

export default buildConfig({
  // ...
  email: lettermintAdapter({
    apiToken: process.env.LETTERMINT_API_TOKEN!,
    defaultFromAddress: "no-reply@example.com",
    defaultFromName: "Example CMS",
    route: "outgoing",
  }),
});
```

The token is the **project** API token (`lm_…`), sent as `x-lettermint-token`.
The team token (`lm_team_…`) is for the management API and cannot send mail.

The sending domain has to be verified in the project before anything goes out.

## Options

| Option                     | Type                                    | Default                        | Description                                                     |
| -------------------------- | --------------------------------------- | ------------------------------ | --------------------------------------------------------------- |
| `apiToken`                 | `string`                                | —                              | Project API token. Required.                                    |
| `defaultFromAddress`       | `string`                                | —                              | Sender used when a message carries no `from`. Required.         |
| `defaultFromName`          | `string`                                | —                              | Display name paired with the address. Required.                 |
| `route`                    | `string`                                | project default                | Route slug to send on.                                          |
| `settings`                 | `{ track_opens?, track_clicks?, tls? }` | route's own                    | Applied to every message, overriding the route.                 |
| `metadata`                 | `Record<string, string>`                | —                              | Attached to every message. Tracked, never sent as headers.      |
| `tags`                     | `{ name, value }[]`                     | —                              | Attached to every message.                                      |
| `overrideRecipientAddress` | `string`                                | —                              | Redirect every message to one address, dropping `cc` and `bcc`. |
| `baseUrl`                  | `string`                                | `https://api.lettermint.co/v1` | API base URL.                                                   |
| `timeout`                  | `number`                                | `30000`                        | Request timeout in milliseconds.                                |

Payload requires `defaultFromAddress` and `defaultFromName` because its own auth
emails read them. All three required options are validated while the config is
being built, so a missing token fails at startup rather than on the first
password reset.

### Route choice

Payload sends transactional mail, so `route` should name a **transactional**
route. Broadcast routes add hosted unsubscribe handling, which does not belong on
a password reset.

### Redirecting mail in staging

`overrideRecipientAddress` replaces `to` **and clears `cc` and `bcc`**. Redirecting
only `to` would still deliver copies to the real people named in the other two
fields, which defeats the purpose on a database restored from production.

## What the adapter maps

Payload hands an adapter a nodemailer-shaped message, so every field below can
arrive in more forms than Payload itself ever produces.

- **Addresses** (`from`, `to`, `cc`, `bcc`, `replyTo`) accept a string, a
  `{ name, address }` object, or an array of either. A string holding a
  comma-separated list is split on the separating commas only, so
  `"Doe, Jane" <j@x.io>, a@y.io` stays two addresses. `reply_to` reaches
  Lettermint as an array, which is what the API expects.
- **Bodies** (`html`, `text`) accept a string, a `Buffer`, a stream, or a
  `{ content }` wrapper. An empty body is omitted rather than sent, because
  Lettermint rejects one shorter than three characters.
- **Headers** accept both nodemailer shapes: a record (including `string[]` and
  `{ prepared, value }` values) and an array of `{ key, value }`.
- **`messageId`** is preserved via `X-LM-Preserve-Message-ID`, and `inReplyTo` /
  `references` become the matching threading headers.
- **Attachments** are base64-encoded. `cid` becomes `content_id` for inline
  images. A declared `application/octet-stream` is dropped rather than sent,
  because Lettermint blocks that type — omitting it lets the API detect a type
  from the filename instead.

Anything nodemailer-specific with no counterpart in the API is reported once per
send through `payload.logger.warn` rather than silently ignored. That covers
message-level options (`envelope`, `dkim`, `list`, `icalEvent`, `amp`, `raw`,
`priority`, …) and per-attachment ones (`raw`, `headers`,
`contentTransferEncoding`), reported as `attachments[0].raw`.

`contentDisposition: "inline"` is only reported when the attachment carries no
`cid`, because a `content_id` is how Lettermint expresses inline in the first
place.

## Errors

A send that Lettermint refuses throws a `LettermintEmailError` carrying
`statusCode`, the parsed `body`, and, for a `422`, the per-field `errors`:

```ts
import { LettermintEmailError } from "@abinnovision/payloadcms-email-lettermint";

try {
  await payload.sendEmail({ to, subject, html });
} catch (error) {
  if (error instanceof LettermintEmailError) {
    // "Lettermint rejected the message: from: The from domain is not verified."
    payload.logger.error({ err: error, errors: error.errors });
  }
}
```

Errors propagate to the caller, so Payload's auth operations fail loudly when
mail cannot be sent.

## Limits

Lettermint enforces these, and the adapter passes them through rather than
duplicating the rules:

- 50 recipients per message across `to`, `cc` and `bcc`
- 25 MB per message, counting the base64-encoded attachments
- a subject of at most 998 characters
- a blocklist of executable and script attachment types

Exceeding any of them comes back as a `422` with the offending field named.

## Non-goals

- **Retries.** Lettermint does not throttle the send endpoint, and Payload's
  callers decide what a failed send means.
- **Attachment `path`.** Resolving it would read a local file or fetch a URL at
  send time; it is refused explicitly. Read the file yourself and pass `content`.
- **Batch and inbound.** `POST /v1/send/batch` and inbound routes are outside
  what a Payload email adapter is asked to do.
- **Scheduled sending.** The Lettermint API has no send-time field.

## License

Apache-2.0
