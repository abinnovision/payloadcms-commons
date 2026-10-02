/**
 * A schema lookup the client got wrong, such as a path no field answers to.
 * The message is written for the client and names what to send instead.
 */
export class SchemaError extends Error {}

SchemaError.prototype.name = "SchemaError";
