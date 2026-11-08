import { createServer } from "node:http";

import { fixture } from "../../builders/fixtures.js";

import type { IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";

export interface RecordedRequest {
	method: string;
	path: string;
	headers: IncomingHttpHeaders;
	body: string;
}

/** Which recorded history `view=history` answers with. */
export type HistoryMode = "found" | "running" | "unknown";

export interface FakeSidecar {
	url: string;
	/** Every request received, in order. */
	requests: RecordedRequest[];
	/** The abort requests received, in order. */
	aborts: () => RecordedRequest[];
	/** The message posts received, in order. */
	sends: () => RecordedRequest[];
	/** The requests whose connection closed before the answer ended. */
	dropped: () => RecordedRequest[];
	/** `found` replays flue-history.json, the default. */
	history: HistoryMode;
	/**
	 * Keeps a live `view=updates` read open: an SSE read after the replay, a
	 * long poll without answering at all, as Flue does while no data arrives.
	 */
	hold: boolean;
	/** Answers every request with 503. */
	refuse: boolean;
	/** Answers every message post with this status, as Flue refuses at admission. */
	sendStatus: number | undefined;
	/** Closes the connection of message posts unanswered, as when the answer times out. */
	drop: boolean;
	/** Holds the answers to message posts until it settles. */
	sendGate: Promise<unknown> | undefined;
	/** Holds the answers to aborts until it settles. */
	abortGate: Promise<unknown> | undefined;
	/** The status aborts get; 404 answers as for a conversation Flue has not seen. */
	abortStatus: number;
	/** Refuses `view=updates` with this status and a body naming the conversation. */
	updatesStatus: number | undefined;
	/** The page a `view=updates` read without `live=sse` gets instead of the recording. */
	updatesPage: string | undefined;
	/** The id of the next admitted message; `sub_<n>` when unset. */
	submissionId: string | undefined;
	/** Restores the defaults above; recorded requests stay. */
	reset: () => void;
	close: () => Promise<void>;
}

export const UPDATES_SSE = fixture("flue-updates.sse");
export const HISTORY_JSON = fixture("flue-history.json");
const HISTORY_RUNNING_JSON = fixture("flue-history-running.json");
const HISTORY_UNKNOWN = JSON.parse(fixture("flue-history-unknown.json")) as {
	status: number;
	body: unknown;
};
const STALE_UID = JSON.parse(fixture("flue-send-stale-uid.json")) as {
	status: number;
	body: unknown;
};

/** The bytes an attachment read gets, by the kind its id names. */
export const ATTACHMENT_BYTES = {
	image: Buffer.from("89504e470d0a1a0a", "hex"),
	document: Buffer.from("%PDF-1.7\n"),
	svg: Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"),
};

const ATTACHMENT_TYPES = {
	image: "image/png",
	document: "application/pdf",
	svg: "image/svg+xml",
};

// An attachment route, its id of the form Flue's store mints.
const ATTACHMENT_PATH =
	/^\/agents\/[^/]+\/[^/]+\/attachments\/att_(image|document|svg)_/;

const recordedEvents = UPDATES_SSE.split("\n\n")
	.filter((block) => block !== "")
	.map((block) => {
		const [, event = "", data = ""] =
			/^event: (\w+)\ndata:(.*)$/s.exec(block) ?? [];

		return { event, data };
	});

/** The recording as Flue answers a read without `live=sse`: one JSON array of its chunks. */
export const UPDATES_JSON = JSON.stringify(
	recordedEvents
		.filter(({ event }) => event === "data")
		.flatMap(({ data }) => JSON.parse(data) as unknown[]),
);

/** The offset after the recording, from its last control event. */
export const UPDATES_NEXT_OFFSET = (
	JSON.parse(
		recordedEvents.findLast(({ event }) => event === "control")?.data ?? "{}",
	) as { streamNextOffset: string }
).streamNextOffset;

const isAbort = (request: RecordedRequest): boolean =>
	request.method === "POST" && request.path.endsWith("/abort");

const isSend = (request: RecordedRequest): boolean =>
	request.method === "POST" && !isAbort(request);

/**
 * A stand-in for the Flue sidecar on a free local port, answering with the
 * T0 recordings. It records every request and admits every message with
 * 202, echoing the conversation's incarnation `uid`, except a message whose
 * `uid` names no incarnation it holds, which gets flue-send-stale-uid.json.
 * It answers every abort with 200, an attachment whose id starts with
 * `att_image_` or `att_document_` with fixed bytes and Flue's headers, and
 * replays flue-updates.sse for `live=sse` and its chunks as one JSON page
 * for any other updates read, a long poll included. The fields above change
 * these answers per test.
 */
export const startSidecar = async (): Promise<FakeSidecar> => {
	const requests: RecordedRequest[] = [];
	const dropped: RecordedRequest[] = [];
	// The incarnation of each conversation, by path.
	const instances = new Map<string, string>();
	let submissions = 0;

	const sidecar: Omit<FakeSidecar, "close" | "url"> = {
		requests,
		aborts: () => requests.filter(isAbort),
		sends: () => requests.filter(isSend),
		dropped: () => [...dropped],
		history: "found",
		hold: false,
		refuse: false,
		sendStatus: undefined,
		drop: false,
		sendGate: undefined,
		abortGate: undefined,
		abortStatus: 200,
		updatesStatus: undefined,
		updatesPage: undefined,
		submissionId: undefined,
		reset: () => {
			Object.assign(sidecar, {
				history: "found",
				hold: false,
				refuse: false,
				sendStatus: undefined,
				drop: false,
				sendGate: undefined,
				abortGate: undefined,
				abortStatus: 200,
				updatesStatus: undefined,
				updatesPage: undefined,
				submissionId: undefined,
			});
		},
	};

	const server = createServer((req, res) => {
		const chunks: Buffer[] = [];

		req.on("data", (chunk: Buffer) => chunks.push(chunk));
		req.on("end", () => {
			const request: RecordedRequest = {
				method: req.method ?? "GET",
				path: req.url ?? "/",
				headers: req.headers,
				body: Buffer.concat(chunks).toString("utf8"),
			};
			const { pathname, searchParams } = new URL(
				request.path,
				"http://sidecar",
			);
			const view = searchParams.get("view");
			const live = searchParams.get("live");
			const send = (
				status: number,
				body: string,
				headers: Record<string, string> = {},
			) => {
				res.writeHead(status, {
					"content-type": "application/json",
					...headers,
				});
				res.end(body);
			};

			requests.push(request);
			res.on("close", () => {
				if (!res.writableFinished) {
					dropped.push(request);
				}
			});

			if (sidecar.refuse) {
				send(503, JSON.stringify({ error: { type: "unavailable" } }));
			} else if (isAbort(request)) {
				void Promise.resolve(sidecar.abortGate).then(() => {
					send(
						sidecar.abortStatus,
						JSON.stringify(
							sidecar.abortStatus === 200
								? { aborted: true }
								: { error: { type: "stream_not_found" } },
						),
					);
				});
			} else if (request.method === "POST") {
				const { uid } = JSON.parse(request.body) as { uid?: unknown };
				const instance = instances.get(pathname);

				void Promise.resolve(sidecar.sendGate).then(() => {
					if (sidecar.drop) {
						res.destroy();
					} else if (sidecar.sendStatus !== undefined) {
						send(
							sidecar.sendStatus,
							JSON.stringify({ error: { type: "invalid_request" } }),
						);
					} else if (typeof uid === "string" && uid !== instance) {
						send(STALE_UID.status, JSON.stringify(STALE_UID.body));
					} else {
						submissions += 1;

						const minted = instance ?? `inst_${String(submissions)}`;

						instances.set(pathname, minted);
						send(
							202,
							JSON.stringify({
								streamUrl: `${request.path}?view=updates`,
								offset: "0000000000000000_0000000000000000",
								submissionId:
									sidecar.submissionId ?? `sub_${String(submissions)}`,
								uid: minted,
							}),
						);
					}
				});
			} else if (
				request.method === "GET" &&
				pathname.includes("/attachments/")
			) {
				const kind = ATTACHMENT_PATH.exec(pathname)?.[1] as
					keyof typeof ATTACHMENT_BYTES | undefined;

				if (kind === undefined) {
					send(
						404,
						JSON.stringify({ error: { type: "attachment_not_found" } }),
					);
				} else {
					// The headers Flue's attachment route answers with; the SVG comes unsandboxed.
					res.writeHead(200, {
						"content-type": ATTACHMENT_TYPES[kind],
						"content-length": String(ATTACHMENT_BYTES[kind].byteLength),
						"content-disposition": "inline",
						"cache-control": "private, max-age=31536000, immutable",
						...(kind === "svg" ? {} : { "content-security-policy": "sandbox" }),
					});
					res.end(ATTACHMENT_BYTES[kind]);
				}
			} else if (view === "history" && sidecar.history === "unknown") {
				send(HISTORY_UNKNOWN.status, JSON.stringify(HISTORY_UNKNOWN.body));
			} else if (view === "history") {
				const body =
					sidecar.history === "running" ? HISTORY_RUNNING_JSON : HISTORY_JSON;

				send(200, body, {
					"cache-control": "no-store",
					"stream-next-offset": (JSON.parse(body) as { offset: string }).offset,
					"stream-up-to-date": "true",
				});
			} else if (view === "updates" && sidecar.updatesStatus !== undefined) {
				send(
					sidecar.updatesStatus,
					JSON.stringify({ error: { message: `stream ${pathname}` } }),
				);
			} else if (view === "updates" && live === "long-poll" && sidecar.hold) {
				// Answered by nothing; the connection stays open until it is dropped.
			} else if (view === "updates" && live !== "sse") {
				send(200, sidecar.updatesPage ?? UPDATES_JSON, {
					"cache-control": "no-store",
					// Not Flue's type, so a test sees the endpoint answer with its own.
					"content-type": "text/plain",
					"stream-next-offset": UPDATES_NEXT_OFFSET,
					"stream-up-to-date": "true",
				});
			} else if (view === "updates") {
				res.writeHead(200, { "content-type": "text/event-stream" });
				res.write(UPDATES_SSE);

				if (!sidecar.hold) {
					res.end();
				}
			} else {
				send(404, JSON.stringify({ error: { type: "stream_not_found" } }));
			}
		});
	});

	await new Promise<void>((resolve) => {
		server.listen(0, "127.0.0.1", resolve);
	});

	const { port } = server.address() as AddressInfo;

	return Object.assign(sidecar, {
		url: `http://127.0.0.1:${String(port)}`,
		close: () =>
			new Promise<void>((resolve, reject) => {
				server.closeAllConnections();
				server.close((error) => {
					if (error) {
						reject(error);
					} else {
						resolve();
					}
				});
			}),
	});
};
