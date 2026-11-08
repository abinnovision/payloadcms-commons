import { readFileSync } from "node:fs";

/** A recording in `test/fixtures`, as text. */
export const fixture = (name: string): string =>
	readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8");

/** A JSON recording in `test/fixtures`, parsed as the type the caller names. */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
export const fixtureJson = <T>(name: string): T =>
	JSON.parse(fixture(name)) as T;
