import type { DummySeed } from "./types.js";

/**
 * Declares one seed.
 *
 * Identity only: the runner sorts by `dependsOn` and calls `run` once the seeds
 * it depends on have finished.
 *
 * @param seed The seed's id, its ordering edges and its body.
 */
export const defineDummySeed = (seed: DummySeed): DummySeed => seed;
