import type { PayloadRequest, Where } from "payload";

/**
 * The threads `req.user` created, or `false` outside the mcpx user
 * collection. The collection is compared as well as the id, because ids
 * repeat across auth collections.
 */
export const ownerWhere = (
	req: PayloadRequest,
	userCollection: string,
): false | Where => {
	const { user } = req;

	if (user?.collection !== userCollection) {
		return false;
	}

	return {
		and: [
			{ "createdBy.relationTo": { equals: userCollection } },
			{ "createdBy.value": { equals: user.id } },
		],
	};
};
