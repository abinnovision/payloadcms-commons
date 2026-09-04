"use client";

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
	createClientFeature,
	TOGGLE_LINK_COMMAND,
} from "@payloadcms/richtext-lexical/client";
import { COMMAND_PRIORITY_HIGH } from "lexical";
import { useEffect } from "react";

import { deriveLinkLabel } from "../pattern/derive-link-label.js";

import type { LinkFieldData } from "../pattern/types.js";

/**
 * Gives a link a top-level `label` derived from its destination whenever it is
 * created or edited.
 *
 * `TOGGLE_LINK_COMMAND` is dispatched both when a link is created from the
 * toolbar and on every drawer submit, so intercepting it at high priority and
 * enriching the payload leaves Payload's own lower-priority handler to create
 * the node with the label already on it.
 *
 * Doing this on the create/edit path rather than as an always-on node
 * transform means documents are never mutated merely by being opened.
 */
const LinkLabelPlugin = () => {
	const [editor] = useLexicalComposerContext();

	useEffect(
		() =>
			editor.registerCommand(
				TOGGLE_LINK_COMMAND,
				(payload) => {
					if (payload?.fields && "link" in payload.fields) {
						const label = deriveLinkLabel(
							payload.fields["link"] as LinkFieldData,
						);

						if (label) {
							payload.fields["label"] = label;
						}
					}

					// Not handled, so Payload's own handler still runs.
					return false;
				},
				COMMAND_PRIORITY_HIGH,
			),
		[editor],
	);

	return null;
};

/** Client feature registering {@link LinkLabelPlugin} on the editor. */
export const LinkLabelFeatureClient = createClientFeature(() => ({
	plugins: [{ Component: LinkLabelPlugin, position: "normal" }],
}));
