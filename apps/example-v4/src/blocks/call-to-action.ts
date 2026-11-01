import { linkField } from "@abinnovision/payloadcms-wayfinder/config";

import { linkTargets } from "../links";

import type { Block } from "payload";

/**
 * The block that makes the wayfinder/montage seam visible: an editor picks a
 * target here, and the href is computed from the same mapping the catch-all
 * route resolves URLs with. Changing a collection's pattern moves the link.
 */
export const callToActionBlock: Block = {
	slug: "call-to-action-module",
	interfaceName: "CallToActionModuleBlock",
	fields: [
		{ name: "heading", type: "text", required: true },
		linkField({ ...linkTargets, required: false }),
	],
};
