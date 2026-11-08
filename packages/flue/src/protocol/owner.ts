/** A polymorphic relationship value as Payload stores `createdBy`. */
export interface RelationValue {
	relationTo: string;
	/** An id, or the populated document. */
	value: unknown;
}

/** The user an ownership check compares: `req.user` or the admin's user. */
export interface OwnerCandidate {
	id: number | string;
	collection?: string;
}

/** Whether `value` has the shape of a document id. */
export const isId = (value: unknown): value is number | string =>
	typeof value === "string" || typeof value === "number";

const idOf = (value: unknown): number | string | undefined => {
	if (isId(value)) {
		return value;
	}

	if (typeof value === "object" && value !== null && "id" in value) {
		return isId(value.id) ? value.id : undefined;
	}

	return undefined;
};

/**
 * Whether `user`, a member of `userCollection`, created the row. The
 * collection is compared as well as the id, because ids repeat across auth
 * collections.
 */
export const isOwner = (
	createdBy: null | RelationValue | undefined,
	user: null | OwnerCandidate | undefined,
	userCollection: string,
): boolean => {
	if (
		!createdBy ||
		!user ||
		user.collection !== userCollection ||
		createdBy.relationTo !== userCollection
	) {
		return false;
	}

	const id = idOf(createdBy.value);

	return id !== undefined && String(id) === String(user.id);
};
