const Page = () => (
	<main style={{ fontFamily: "system-ui, sans-serif", padding: "2rem" }}>
		<h1>montage example</h1>
		<p>
			Admin panel: <a href="/admin">/admin</a>
		</p>
		<p>
			Create a page in the admin, then visit <code>/&lt;slug&gt;</code> to
			render it through montage.
		</p>
	</main>
);
export default Page;
