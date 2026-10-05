import { formatAdminURL } from "payload/shared";

import type { ResolvedEntity } from "../entity.js";
import type { PayloadRequest, RootLivePreviewConfig } from "payload";

export interface DocumentLinks {
	adminUrl: string;
	previewUrl?: string;
}

interface LinkArgs {
	target: ResolvedEntity;
	doc: Record<string, unknown>;
	locale: string | undefined;
}

// The entity's own `livePreview`, else the root one when it lists the slug.
const livePreviewOf = (req: PayloadRequest, target: ResolvedEntity) => {
	if (target.config.admin.livePreview) {
		return target.config.admin.livePreview;
	}

	// Typed as always set, but left undefined when the config has no live preview.
	const root = req.payload.config.admin.livePreview as
		RootLivePreviewConfig | undefined;
	const listed =
		target.kind === "collection" ? root?.collections : root?.globals;

	return listed?.includes(target.slug) ? root : undefined;
};

const previewOf = async (
	req: PayloadRequest,
	args: LinkArgs,
): Promise<string | null | undefined> => {
	const { target, doc, locale } = args;
	const { preview } = target.config.admin;

	if (preview) {
		return await preview(doc, { locale: locale ?? "", req, token: null });
	}

	const url = livePreviewOf(req, target)?.url;

	if (typeof url !== "function") {
		return url;
	}

	const { localization } = req.payload.config;
	const entry = localization
		? localization.locales.find((item) => item.code === locale)
		: undefined;

	return await url({
		...(target.kind === "collection"
			? { collectionConfig: target.config }
			: { globalConfig: target.config }),
		data: doc,
		locale: entry ?? { code: locale ?? "", label: locale ?? "" },
		payload: req.payload,
		req,
	});
};

/**
 * The admin panel URL of a written document, and its preview URL where the
 * entity configures one. Both sit at the origin of `serverURL` when set, else
 * of the MCP request. A preview that fails is left out: the write has landed.
 */
export const documentLinks = async (
	req: PayloadRequest,
	args: LinkArgs,
): Promise<DocumentLinks> => {
	const { target, doc, locale } = args;
	const { config } = req.payload;
	const origin = config.serverURL || new URL(req.url ?? "").origin;
	const path: `/${string}` =
		target.kind === "collection"
			? `/collections/${target.slug}/${String(doc["id"])}`
			: `/globals/${target.slug}`;
	const adminUrl = formatAdminURL({
		adminRoute: config.routes.admin,
		path,
		serverURL: origin,
	});

	const preview = await previewOf(req, args).catch(() => undefined);

	return {
		adminUrl: locale
			? `${adminUrl}?locale=${encodeURIComponent(locale)}`
			: adminUrl,
		...(preview ? { previewUrl: new URL(preview, origin).toString() } : {}),
	};
};
