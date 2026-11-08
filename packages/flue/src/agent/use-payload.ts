import {
	useDataWriter,
	useDelivery,
	useInitialData,
	useMcpConnection,
	useResponseFinish,
	useResponseStart,
} from "@flue/runtime";

import { contextOf } from "./context.js";
import { exchangeSession } from "./exchange.js";
import {
	addResponseFile,
	filePartSchema,
	finishResponseFiles,
	startResponseFiles,
	uploadDocument,
} from "./upload.js";
import { FILE_PART } from "../protocol/events.js";
import { INITIAL_DATA_KEY } from "../protocol/exchange.js";

import type { ExchangeSession, ExchangeSessionArgs } from "./exchange.js";
import type { PayloadUploadArgs } from "./upload.js";
import type { ChatContext } from "../protocol/context.js";
import type { PayloadUpload } from "../protocol/events.js";
import type {
	ExchangeResponse,
	FlueInitialData,
} from "../protocol/exchange.js";

export interface UsePayloadOptions {
	/** The slug the agent is mounted under in the sidecar, as named in the plugin's `agents`. */
	agent: string;
	/** The Payload server URL. Defaults to the `PAYLOAD_URL` environment variable. */
	payloadUrl?: string;
	/** The shared sidecar secret. Defaults to the `FLUE_SIDECAR_SECRET` environment variable. */
	secret?: string;
	/** The mcpx endpoint below `payloadUrl`. Defaults to `MCPX_PATH`, else `/api/mcpx`. */
	mcpPath?: string;
	/** The plugin's endpoints below `payloadUrl`. Defaults to `/api/flue`. */
	fluePath?: string;
}

/** Who the run acts as, as the key exchange reports it. */
export type PayloadIdentity = Pick<
	ExchangeResponse,
	"kind" | "thread" | "user"
>;

export interface PayloadRun {
	/**
	 * Resolves who the run acts as. It exchanges the handle on first use, so
	 * call it from a tool's `run`: agent functions cannot await.
	 */
	identity: () => Promise<PayloadIdentity>;
	/** The context of the turn in front of the model, if Payload sent it. */
	context: () => ChatContext | undefined;
	/**
	 * Creates a document with a file in an upload collection as the run's
	 * user, and lists it in the response's `data-payload-file` part. The
	 * locale defaults to the turn's. Call it from a tool's `run`.
	 */
	upload: (args: PayloadUploadArgs) => Promise<PayloadUpload>;
}

type InitialData =
	Readonly<Record<string, Partial<FlueInitialData> | undefined>> | undefined;

const missing = (what: string): Error =>
	new Error(`[payloadcms-flue] usePayload needs ${what}.`);

const SESSIONS_MAX = 256;

/*
 * The sessions by connection, so a later run of the agent function reuses
 * its exchange. The least recently used goes first. The keys hold handles,
 * so they are never logged.
 */
const sessions = new Map<string, ExchangeSession>();

const cachedSession = (args: ExchangeSessionArgs): ExchangeSession => {
	const key = JSON.stringify([
		args.payloadUrl,
		args.fluePath,
		args.mcpPath,
		args.agent,
		args.handle,
	]);
	const session = sessions.get(key) ?? exchangeSession(args);

	sessions.delete(key);
	sessions.set(key, session);

	if (sessions.size > SESSIONS_MAX) {
		const oldest = sessions.keys().next().value;

		if (oldest !== undefined) {
			sessions.delete(oldest);
		}
	}

	return session;
};

/**
 * Connects the agent to Payload's mcpx endpoint as the user Payload started
 * the conversation for. The mcpx key is exchanged lazily, when the
 * connection first authenticates, and is held in memory only.
 */
export const usePayload = (options: UsePayloadOptions): PayloadRun => {
	const handle = useInitialData<InitialData>()?.[INITIAL_DATA_KEY]?.handle;
	const delivery = useDelivery();
	const payloadUrl = options.payloadUrl ?? process.env["PAYLOAD_URL"];
	const secret = options.secret ?? process.env["FLUE_SIDECAR_SECRET"];

	if (!payloadUrl) {
		throw missing("payloadUrl or the PAYLOAD_URL environment variable");
	}

	if (!secret) {
		throw missing("secret or the FLUE_SIDECAR_SECRET environment variable");
	}

	if (!handle) {
		throw missing(
			"a conversation created by Payload, whose initial data carries the exchange handle",
		);
	}

	const mcpPath = options.mcpPath ?? process.env["MCPX_PATH"] ?? "/api/mcpx";
	const session = cachedSession({
		payloadUrl,
		secret,
		handle,
		agent: options.agent,
		mcpPath,
		fluePath: options.fluePath ?? "/api/flue",
	});
	const writeFiles = useDataWriter(FILE_PART, { schema: filePartSchema });
	const context = (): ChatContext | undefined => contextOf(delivery);

	useResponseStart(() => {
		startResponseFiles(handle);
	});
	useResponseFinish(() => {
		finishResponseFiles(handle);
	});

	useMcpConnection({
		name: "payload",
		url: session.url,
		auth: session.auth,
		fetch: session.fetch,
	});

	return {
		identity: async () => {
			const { kind, thread, user } = await session.exchange();

			return { kind, thread, user };
		},
		context,
		upload: async (args) => {
			const file = await uploadDocument(
				{ session, payloadUrl, mcpPath, locale: context()?.locale },
				args,
			);

			writeFiles(addResponseFile(handle, file));

			return file;
		},
	};
};
