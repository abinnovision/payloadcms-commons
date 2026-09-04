/**
 * Both windows are untrusted from the other's point of view: the preview is a
 * consumer page and the admin is a separate origin. Every message therefore
 * carries a source tag and a version, and is validated structurally on
 * arrival rather than cast.
 */
export const VIEWFINDER_SOURCE = "viewfinder";

/**
 * Bumped only on a breaking envelope change. A mismatched version is dropped
 * silently, so a stale frontend deployment cannot drive a newer admin.
 */
export const VIEWFINDER_PROTOCOL_VERSION = 1;

/**
 * What one message points at. `field` is relative to the block, which is what
 * lets the same address survive the block moving to a different index.
 */
export interface BlockAddress {
	id: string;
	blockType?: string;
	field?: string;
}

interface Envelope<TType extends string> {
	source: typeof VIEWFINDER_SOURCE;
	version: typeof VIEWFINDER_PROTOCOL_VERSION;
	type: TType;
}

interface AddressedEnvelope<TType extends string> extends Envelope<TType> {
	address: BlockAddress;
}

/** Sent by the rendered page, in the iframe, up to the admin. */
export type PreviewMessage =
	| AddressedEnvelope<"hover">
	| AddressedEnvelope<"select">
	| Envelope<"leave">
	| Envelope<"ready">;

/** Sent by the admin down into the preview iframe. */
export type AdminMessage =
	| AddressedEnvelope<"highlight">
	| AddressedEnvelope<"scrollTo">
	| Envelope<"clear">;

const PREVIEW_TYPES = new Set(["hover", "select", "leave", "ready"]);
const ADMIN_TYPES = new Set(["highlight", "scrollTo", "clear"]);
const ADDRESSED_TYPES = new Set(["hover", "select", "highlight", "scrollTo"]);

const isAddress = (value: unknown): value is BlockAddress => {
	if (typeof value !== "object" || value === null) {
		return false;
	}

	const candidate = value as Record<string, unknown>;

	return (
		typeof candidate["id"] === "string" &&
		candidate["id"].length > 0 &&
		(candidate["blockType"] === undefined ||
			typeof candidate["blockType"] === "string") &&
		(candidate["field"] === undefined || typeof candidate["field"] === "string")
	);
};

const isEnvelope = (
	value: unknown,
	types: ReadonlySet<string>,
): value is Envelope<string> => {
	if (typeof value !== "object" || value === null) {
		return false;
	}

	const candidate = value as Record<string, unknown>;
	if (
		candidate["source"] !== VIEWFINDER_SOURCE ||
		candidate["version"] !== VIEWFINDER_PROTOCOL_VERSION ||
		typeof candidate["type"] !== "string" ||
		!types.has(candidate["type"])
	) {
		return false;
	}

	return (
		!ADDRESSED_TYPES.has(candidate["type"]) || isAddress(candidate["address"])
	);
};

/** Narrows the untrusted `event.data` of a `message` event from the iframe. */
export const isPreviewMessage = (value: unknown): value is PreviewMessage =>
	isEnvelope(value, PREVIEW_TYPES);

/** Narrows the untrusted `event.data` of a `message` event from the admin. */
export const isAdminMessage = (value: unknown): value is AdminMessage =>
	isEnvelope(value, ADMIN_TYPES);

const bare = <TType extends string>(type: TType): Envelope<TType> => ({
	source: VIEWFINDER_SOURCE,
	version: VIEWFINDER_PROTOCOL_VERSION,
	type,
});

const addressed = <TType extends string>(
	type: TType,
	address: BlockAddress,
): AddressedEnvelope<TType> => ({ ...bare(type), address });

export const previewMessage = {
	ready: (): PreviewMessage => bare("ready"),
	leave: (): PreviewMessage => bare("leave"),
	hover: (address: BlockAddress): PreviewMessage => addressed("hover", address),
	select: (address: BlockAddress): PreviewMessage =>
		addressed("select", address),
} as const;

export const adminMessage = {
	clear: (): AdminMessage => bare("clear"),
	highlight: (address: BlockAddress): AdminMessage =>
		addressed("highlight", address),
	scrollTo: (address: BlockAddress): AdminMessage =>
		addressed("scrollTo", address),
} as const;
