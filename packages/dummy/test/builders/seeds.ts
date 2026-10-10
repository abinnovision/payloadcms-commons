import { defineDummySeed } from "../../src/define-seed.js";

import type { DummySeed } from "../../src/types.js";

/** A seed that records the order it ran in, without writing anything. */
export const tracer = (
	id: string,
	order: string[],
	dependsOn?: readonly string[],
): DummySeed =>
	defineDummySeed({
		id,
		...(dependsOn === undefined ? {} : { dependsOn }),
		run: async () => {
			order.push(id);

			await Promise.resolve();
		},
	});

/** Four seeds where two independent ones both feed a join. */
export const diamond = (order: string[]): readonly DummySeed[] => [
	tracer("join", order, ["left", "right"]),
	tracer("left", order, ["root"]),
	tracer("right", order, ["root"]),
	tracer("root", order),
];
