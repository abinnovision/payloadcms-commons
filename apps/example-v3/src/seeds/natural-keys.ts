import type { DummyNaturalKeys } from "@abinnovision/payloadcms-dummy";

/**
 * The fields that identify a seeded document across runs.
 *
 * `pages`, `sections` and `users` are absent: their key is derived from the
 * unique field the collection already declares. The three here have no unique
 * field, so they have to be named.
 *
 * `posts` is keyed on a localized field, so the lookup runs in the default
 * locale. That is the locale the seed writes first, which is what makes it work.
 */
export const naturalKeys: DummyNaturalKeys = {
	articles: "slug",
	posts: "title",
	tags: "name",
};
