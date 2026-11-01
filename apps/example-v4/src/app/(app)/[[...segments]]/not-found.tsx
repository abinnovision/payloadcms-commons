/**
 * The page a reader sees most while experimenting with patterns.
 *
 * Rendered inside the site's own layout, so it carries the same document shell
 * and the same `lang` as every other page. Without a not-found of its own Next
 * falls back to a bare error document that has neither.
 */
const NotFound = () => (
	<main style={{ padding: "2rem" }}>
		<h1>Not found</h1>
		<p>
			No collection mapping claims this path, or the document behind it is not
			published. Check <strong>Settings → Collections Mapping</strong>.
		</p>
	</main>
);

export default NotFound;
