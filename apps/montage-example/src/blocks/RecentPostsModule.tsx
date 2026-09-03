import config from "@payload-config";
import { getPayload } from "payload";

import { defineBlockComponent } from "../montage";

/**
 * Demonstrates a real data resolver: `resolve` fetches related documents
 * ahead of render, and `canRender` reads the result so the block (and, via
 * `SectionWrapper`, its parent) can collapse to nothing when there is no
 * data. See `packages/montage/docs/rendering.md#async-components-versus-resolve`.
 */
export const RecentPostsModule = defineBlockComponent("recent-posts-module", {
	resolve: async ({ block }) => {
		const payload = await getPayload({ config });
		const result = await payload.find({
			collection: "posts",
			limit: block.limit,
			depth: 0,
			sort: "-createdAt",
		});
		return { posts: result.docs };
	},
	canRender: ({ data }) => data.posts.length > 0,
	component: ({ data, ctx }) => (
		<section>
			<h2>Recent posts</h2>
			<ul>
				{data.posts.map((post) => (
					<li key={post.id}>
						<ctx.Link href={`/${post.slug}`}>{post.title}</ctx.Link>
						{post.excerpt ? <p>{post.excerpt}</p> : null}
					</li>
				))}
			</ul>
		</section>
	),
});
