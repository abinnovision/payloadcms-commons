import config from "@payload-config";
import { getPayload } from "payload";

/*
 * Fills a fresh database with enough content to exercise routing. The mapping
 * rows are written last, because they are what makes everything else
 * reachable.
 *
 * Written as top-level await rather than a `main()` call: `payload run` stops
 * once the module finishes evaluating, so a floating promise never resumes.
 */
const payload = await getPayload({ config });

const existing = await payload.find({ collection: "users", limit: 1 });

if (existing.docs.length === 0) {
	await payload.create({
		collection: "users",
		data: { email: "editor@example.com", password: "password" },
	});
}

const section = await payload.create({
	collection: "sections",
	data: { title: "Journal", slug: "journal" },
});

await payload.create({
	collection: "pages",
	data: {
		title: "Home",
		slug: "/",
		body: "The site root.",
		_status: "published",
	},
});

await payload.create({
	collection: "pages",
	data: {
		title: "The team",
		slug: "/about/team",
		body: "A page nested two levels deep, served by the wildcard pattern.",
		_status: "published",
	},
});

await payload.create({
	collection: "articles",
	data: {
		title: "Hello world",
		slug: "hello-world",
		section: section.id,
		body: "An article, addressed through its section.",
		_status: "published",
	},
});

await payload.updateGlobal({
	slug: "collections-mapping",
	data: {
		collections: [
			{ collectionName: "pages", path: "/*slug" },
			{ collectionName: "sections", path: "/topic/:slug" },
			{ collectionName: "articles", path: "/:section/:slug" },
		],
	},
});

console.log("Seeded. Sign in at /admin as editor@example.com / password");
