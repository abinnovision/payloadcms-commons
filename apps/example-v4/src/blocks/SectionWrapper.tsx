import { defineInlineBlockComponent } from "../montage";

/**
 * Rebuild of `packages/montage/docs/recipes.md`'s section wrapper: collapses
 * to nothing if none of its modules can render, which is why
 * `RecentPostsModule` declares a resolver (`canRender` needs the data ahead
 * of render to decide this).
 */
interface SectionWrapperBlock {
	blockType: "section-wrapper";
	id?: string | null;
	identifier?: string | null;
	modules: { id?: string | null; blockType: string }[];
}

export const SectionWrapper = defineInlineBlockComponent<SectionWrapperBlock>()(
	"section-wrapper",
	{
		component: ({ block, ctx, renderer }) => {
			const visible = block.modules.filter((m) =>
				renderer.canRender({ block: m, ctx }),
			);
			if (visible.length === 0) {
				return null;
			}

			return (
				<div id={block.identifier ?? undefined}>
					{visible.map((m) => (
						<renderer.Block key={m.id} block={m} ctx={ctx} />
					))}
				</div>
			);
		},
	},
);
