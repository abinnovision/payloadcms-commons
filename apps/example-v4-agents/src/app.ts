import { reportSettlements } from "@abinnovision/payloadcms-flue/agent";
import { createAgentRouter } from "@flue/runtime/routing";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { createHash, timingSafeEqual } from "node:crypto";

import { Editor } from "./agents/editor.js";
import { Reviewer } from "./agents/reviewer.js";
import { Summarizer } from "./agents/summarizer.js";

const secret = process.env["FLUE_SIDECAR_SECRET"];

// The same minimum the plugin holds Payload's side to.
if (!secret || secret.length < 32) {
	throw new Error("FLUE_SIDECAR_SECRET must be set to at least 32 characters.");
}

// Equal-length digests let timingSafeEqual compare tokens of any length.
const digest = (value: string): Buffer =>
	createHash("sha256").update(value).digest();
const expected = digest(secret);

// Tells Payload when a submission settles, so threads nobody watches leave running.
reportSettlements();

const app = new Hono();

// Payload sends the shared secret as a bearer token on every request.
app.use("/agents/*", async (c, next) => {
	const token = /^Bearer (.+)$/i.exec(c.req.header("authorization") ?? "")?.[1];

	if (token === undefined || !timingSafeEqual(digest(token), expected)) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	await next();
});

app.route("/agents/editor", createAgentRouter(Editor));
app.route("/agents/reviewer", createAgentRouter(Reviewer));
app.route("/agents/summarizer", createAgentRouter(Summarizer));

export default app;
