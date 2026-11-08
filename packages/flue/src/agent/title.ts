import { useDataWriter } from "@flue/runtime";
import * as v from "valibot";

import { TITLE_PART } from "../protocol/events.js";

/** A thread title: non-empty, at most 120 characters. */
export const titleSchema = v.pipe(v.string(), v.nonEmpty(), v.maxLength(120));

/**
 * Returns a writer that sets the thread's title in the admin chat panel.
 * Like every Flue data writer it works only while the agent responds, such as
 * from a tool's `run`, and throws during render.
 */
export const useThreadTitle = (): ((title: string) => void) =>
	useDataWriter(TITLE_PART, { schema: titleSchema });
