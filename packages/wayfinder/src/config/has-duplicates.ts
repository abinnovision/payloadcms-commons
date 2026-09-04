/**
 * Whether a list of authored keys names the same thing twice.
 *
 * An array field's `validate` receives whatever the admin form holds, so the
 * undefined entries are kept rather than filtered: two rows with no key yet
 * are still two rows claiming the same empty name, and an editor should hear
 * that at the point they save rather than at the point the second one
 * silently wins.
 *
 * @param keys The authored keys, in row order.
 */
export const hasDuplicates = (keys: (string | undefined)[]): boolean =>
	new Set(keys).size !== keys.length;
