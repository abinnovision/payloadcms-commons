/**
 * Fields Payload maintains. A client may neither address nor supply them.
 */
const RESERVED_FIELD_NAMES: ReadonlySet<string> = new Set([
	"_status",
	"createdAt",
	"deletedAt",
	"id",
	"updatedAt",
]);

export { RESERVED_FIELD_NAMES };
