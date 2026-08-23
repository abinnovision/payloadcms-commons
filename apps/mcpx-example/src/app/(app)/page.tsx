const Page = () => (
	<main style={{ fontFamily: "system-ui, sans-serif", padding: "2rem" }}>
		<h1>mcpx example</h1>
		<p>
			Admin panel: <a href="/admin">/admin</a>
		</p>
		<p>
			MCP endpoint: <code>POST /api/mcpx</code> with{" "}
			<code>Authorization: Bearer &lt;api key&gt;</code>
		</p>
	</main>
);
export default Page;
