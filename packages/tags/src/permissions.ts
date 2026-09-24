/**
 * The slice of Payload's admin permissions this package reads: whether the
 * signed-in user may create a document in a given collection. Kept as a local
 * shape rather than importing Payload's own permissions type, which is a
 * generic keyed by the project's collection slugs and would drag the whole
 * runtime type graph across the `.` boundary for a single boolean.
 */
export interface TagsCollectionPermissions {
	/**
	 * `true` in the sanitized permissions the admin's `useAuth()` returns,
	 * `{ permission }` in the unsanitized shape `payload.auth()` returns.
	 */
	create?: true | { permission: boolean } | undefined;
}

export interface TagsPermissions {
	collections?:
		Record<string, TagsCollectionPermissions | undefined> | undefined;
}

/**
 * Whether `TagsField` may offer inline creation: the plugin option has to
 * allow it, and the signed-in user has to be allowed to create a document in
 * the tags collection. Without the second check, an editor without create
 * access would see a Create option that a 403 from the server refuses.
 */
export const canInlineCreate = (
	permissions: TagsPermissions | undefined,
	tagsSlug: string,
	allowInlineCreate: boolean,
): boolean => {
	if (!allowInlineCreate) {
		return false;
	}

	const create = permissions?.collections?.[tagsSlug]?.create;

	return create === true || create?.permission === true;
};
