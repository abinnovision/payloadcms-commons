import config from "@payload-config";
import { getPayload } from "payload";

import { defineBlockComponent } from "../montage";

/**
 * Demonstrates a real data resolver: `resolve` fetches related documents
 * ahead of render, and `canRender` reads the result so the block (and, via
 * `SectionWrapper`, its parent) can collapse to nothing when there is no
 * data. See `packages/montage/docs/rendering.md#async-components-versus-resolve`.
 *
 * Montage takes no `io` and does not fetch on a consumer's behalf, which is
 * why the resolver calls `getPayload` itself.
 */
export const RecentPostsModule = defineBlockComponent("recent-posts-module", {
	resolve: async ({ block, ctx }) => {
		const payload = await getPayload({ config });
		const result = await payload.find({
			collection: "posts",
			limit: block.limit,
			locale: ctx.locale,
			depth: 0,
			sort: "-createdAt",
			/*
			 * Both halves are needed, and for the same reason the catch-all
			 * route hands `draft` to wayfinder rather than writing a filter.
			 * `draft` decides whether the newest version is readable at all,
			 * and `_status` is what keeps a never-published post out of the
			 * public list — `find` returns the newest version either way. An
			 * editor inside preview sees drafts; a visitor does not.
			 */
			draft: ctx.isPreview,
			...(ctx.isPreview ? {} : { where: { _status: { equals: "published" } } }),
		});

		return { posts: result.docs };
	},
	canRender: ({ data }) => data.posts.length > 0,
	component: ({ data }) => (
		<section>
			<h2>Recent posts</h2>
			<ul>
				{data.posts.map((post) => (
					<li key={post.id}>
						{post.title}
						{post.excerpt ? <p>{post.excerpt}</p> : null}
					</li>
				))}
			</ul>
		</section>
	),
});
