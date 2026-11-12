"use client";

import {
	toast,
	useConfig,
	useDocumentDrawerContext,
	useDocumentEvents,
	useDocumentForm,
	useDocumentInfo,
	useFormModified,
	useLocale,
	usePathname,
} from "@payloadcms/ui";
import { useContext, useEffect, useRef } from "react";

import { mergePlan } from "./document-merge.js";
import {
	DocumentRegistryContext,
	coalesced,
	documentKey,
	documentUrl,
	fieldPathOf,
	STALE_MESSAGE,
} from "./document.js";
import { contextFromPath } from "./route-context.js";

import type { DirtyField, MergePlan } from "./document-merge.js";
import type { OpenDocument } from "./document.js";

type Doc = Record<string, unknown>;

const conflictMessage = (paths: string[]): string =>
	`Your unsaved edits to ${paths.join(", ")} replace the agent's changes to them.`;

/**
 * Registers the document of the edit view it renders in with the chat, which
 * saves unsaved edits as a draft before a turn and reloads the form after
 * each agent write, keeping the user's unsaved values. Mounted through
 * `beforeDocumentControls`; a document in a drawer, or one the route does
 * not show, is not registered.
 */
export const FlueDocumentBridge: React.FC = () => {
	const registry = useContext(DocumentRegistryContext);
	const { config } = useConfig();
	const pathname = usePathname();
	const locale = useLocale();
	// Outside a drawer the context is empty, despite its type.
	const { drawerSlug } = useDocumentDrawerContext() as Partial<
		ReturnType<typeof useDocumentDrawerContext>
	>;
	const info = useDocumentInfo();
	const form = useDocumentForm();
	const modified = useFormModified();
	const { reportUpdate } = useDocumentEvents();
	const id = info.id === undefined ? undefined : String(info.id);
	const { collectionSlug: collection, globalSlug: global } = info;
	const key = documentKey(collection, id, global);
	const route = contextFromPath(pathname, config.routes.admin);
	const shown =
		drawerSlug === undefined &&
		key !== undefined &&
		key === documentKey(route.collection, route.id, route.global);
	const drafts = Boolean(info.docConfig?.versions?.drafts);
	// The values of the last render, which the registered handle reads when called.
	const latest = useRef({ form, modified, info, reportUpdate, locale });
	const focus = useRef<string>(undefined);

	latest.current = { form, modified, info, reportUpdate, locale };

	/*
	 * The last field focused in this document's form keeps its place while
	 * the user types in the chat. Drawers render outside the form.
	 */
	useEffect(() => {
		focus.current = undefined;

		const onFocus = (event: FocusEvent): void => {
			const target = event.target instanceof Element ? event.target : null;

			// Null before the form mounts, despite its type.
			const formElement = latest.current.form.formRef
				.current as HTMLFormElement | null;

			if (!formElement?.contains(target)) {
				return;
			}

			const path = fieldPathOf(target);

			if (path !== undefined) {
				focus.current = path;
			}
		};

		document.addEventListener("focusin", onFocus);

		return () => {
			document.removeEventListener("focusin", onFocus);
		};
	}, [key]);

	useEffect(() => {
		if (!shown || registry === null) {
			return;
		}

		const url = (): string =>
			documentUrl({
				serverURL: config.serverURL,
				apiRoute: config.routes.api,
				collection,
				id,
				global,
				locale: latest.current.locale?.code,
			});

		// Agent writes not yet shown, and whether the form can no longer follow them.
		let pendingWrites = 0;
		let stale = false;
		// Set once the form shows another document or unmounts.
		let cancelled = false;
		const controller = new AbortController();

		// Whether the form still shows this effect's document.
		const current = (doc?: Doc): boolean => {
			const shownInfo = latest.current.info;

			return (
				!cancelled &&
				shownInfo.collectionSlug === collection &&
				shownInfo.globalSlug === global &&
				(id === undefined ||
					(String(shownInfo.id) === id &&
						(doc === undefined || String(doc["id"]) === id)))
			);
		};

		const read = async (): Promise<Doc | undefined> => {
			const response = await fetch(url(), {
				credentials: "include",
				signal: controller.signal,
			});

			if (!response.ok) {
				throw new Error(`Status ${String(response.status)}`);
			}

			const doc = (await response.json()) as Doc;

			return current(doc) ? doc : undefined;
		};

		const apply = async (
			doc: Doc,
			dirty: DirtyField[],
			writes: number,
		): Promise<void> => {
			const { form: shownForm, info: docInfo } = latest.current;

			await shownForm.reset(doc);

			if (cancelled) {
				return;
			}

			// Without it, Payload takes the next keystroke for a conflicting edit.
			docInfo.setData(doc);

			// The user's unsaved values win over the agent's.
			for (const { path, value } of dirty) {
				shownForm.dispatchFields({ type: "UPDATE", path, value });
			}

			if (dirty.length > 0) {
				shownForm.setModified(true);
			}

			for (let write = 0; write < writes; write += 1) {
				docInfo.incrementVersionCount();
			}

			if (drafts) {
				if (doc["_status"] === "published") {
					docInfo.setUnpublishedVersionCount(0);
					docInfo.setHasPublishedDoc(true);
				} else {
					docInfo.setUnpublishedVersionCount((count) => count + writes);
				}
			}

			// Refreshes the live preview of a server-rendered page.
			latest.current.reportUpdate({
				entitySlug: global ?? collection ?? "",
				...(id === undefined ? {} : { id }),
				operation: "update",
				updatedAt:
					typeof doc["updatedAt"] === "string"
						? doc["updatedAt"]
						: new Date().toISOString(),
				doc: doc as { id: number | string },
			});
		};

		const sync = coalesced(
			async () => {
				const writes = pendingWrites;

				pendingWrites = 0;

				if (stale || !current()) {
					return;
				}

				const doc = await read();

				if (doc === undefined) {
					return;
				}

				const plan: MergePlan = latest.current.modified
					? mergePlan(
							latest.current.form.getFields(),
							latest.current.info.data,
							doc,
						)
					: { kind: "merge", dirty: [], conflicts: [] };

				if (plan.kind === "stale") {
					stale = true;
					toast.warning(STALE_MESSAGE, { duration: Infinity });

					return;
				}

				await apply(doc, plan.dirty, writes);

				if (plan.conflicts.length > 0) {
					toast.info(conflictMessage(plan.conflicts));
				}
			},
			() => {
				if (!cancelled) {
					toast.error(
						"The document could not be reloaded after the agent's change.",
					);
				}
			},
		);

		const handle: OpenDocument = {
			collection,
			id,
			global,
			drafts,
			modified: () => latest.current.modified,
			stale: () => stale,
			focus: () => focus.current,
			saveDraft: async () => {
				const shownState = latest.current;
				const result = await shownState.form.submit({
					action: url(),
					method: global === undefined ? "PATCH" : "POST",
					overrides: { _status: "draft" },
					skipValidation: true,
				});

				if (!result || result.res.status >= 400) {
					throw new Error("The document could not be saved as a draft.");
				}

				shownState.info.setUnpublishedVersionCount((count) => count + 1);
			},
			reload: (writes) => {
				pendingWrites += writes;
				sync();
			},
		};

		const unregister = registry.register(handle);

		return () => {
			cancelled = true;
			controller.abort();
			unregister();
		};
	}, [
		registry,
		shown,
		collection,
		id,
		global,
		drafts,
		config.serverURL,
		config.routes.api,
	]);

	return null;
};
