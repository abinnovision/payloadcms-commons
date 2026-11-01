import { defineBlockComponent } from "../montage";

/**
 * Registered like any other block. Montage's Lexical converters dispatch the
 * embedded node into the same registry, so there is no second component for
 * the rich text case.
 */
export const CalloutModule = defineBlockComponent("callout", {
	component: ({ block }) => (
		<aside
			style={{
				borderLeft: `4px solid ${block.tone === "warning" ? "#c60" : "#06c"}`,
				padding: "0.5rem 1rem",
			}}
		>
			{block.body}
		</aside>
	),
});
