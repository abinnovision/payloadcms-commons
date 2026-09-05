/**
 * Why a routing call produced nothing.
 *
 * Every failure here returns `null` so the happy path stays a plain value
 * rather than a wrapper type. That leaves no way to tell "this collection has
 * no mapping" from "this relationship was never populated", which is exactly
 * the distinction someone staring at a missing link needs. These reasons carry
 * it out of band.
 */
export type DiagnosticReason =
	| "no-mapping"
	| "no-locale-pattern"
	| "unpopulated-reference"
	| "missing-param"
	| "no-document"
	| "unknown-variant";

export interface Diagnostic<TReason extends DiagnosticReason> {
	reason: TReason;
	collection?: string;
	locale?: string;
	path?: string;
	param?: string;
	variant?: string;
}

/**
 * Reports why a call returned nothing.
 *
 * Fires once per failed call, so a page whose footer holds forty links to a
 * misconfigured collection reports forty times. Deduplicating is the caller's
 * job — the package cannot know which of them are worth surfacing.
 */
export type OnDiagnostic<TReason extends DiagnosticReason> = (
	diagnostic: Diagnostic<TReason>,
) => void;

/** Reasons {@link buildHref} and {@link buildPath} can report. */
export type BuildDiagnosticReason =
	"no-mapping" | "no-locale-pattern" | "missing-param";

/** Reasons link resolution can report. */
export type ResolveLinkDiagnosticReason =
	BuildDiagnosticReason | "unpopulated-reference" | "unknown-variant";

/** Reasons path resolution can report. */
export type ResolvePathDiagnosticReason = "no-mapping" | "no-document";
