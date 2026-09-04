import { createBlockContext } from "@abinnovision/payloadcms-montage";
import config from "@payload-config";
import { draftMode } from "next/headers";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getPayload } from "payload";

import { blocks } from "../../../blocks/registry";
import { createRenderer } from "../../../montage";

interface Params {
	params: Promise<{ slug: string }>;
}

const renderer = createRenderer(blocks);

const Page = async ({ params }: Params) => {
	const { slug } = await params;
	const payload = await getPayload({ config });
	const { isEnabled: isPreview } = await draftMode();

	const result = await payload.find({
		collection: "pages",
		where: { slug: { equals: slug } },
		limit: 1,
		depth: 0,
		draft: isPreview,
	});
	const page = result.docs[0];
	if (!page) {
		notFound();
	}

	const ctx = createBlockContext({ Link, Image, isPreview });
	const root = { blockType: "pages-root", id: page.id, layout: page.layout };

	await renderer.resolveBlockData({ root, ctx });

	return (
		<main style={{ fontFamily: "system-ui, sans-serif", padding: "2rem" }}>
			<h1>{page.title}</h1>
			{page.layout.map((block) => (
				<renderer.Block key={block.id} block={block} ctx={ctx} />
			))}
		</main>
	);
};

export default Page;
