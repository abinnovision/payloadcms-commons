import { runHatchetWorker } from "@abinnovision/payloadcms-hatchet/worker";
import config from "@payload-config";

/*
 * Executes the jobs Hatchet triggers until SIGTERM or SIGINT. Needs
 * `HATCHET_CLIENT_TOKEN`, and the same token in the app, whose config then
 * enables the hatchet plugin. `payload run` exits once this resolves.
 */
await runHatchetWorker({ config, queues: ["default"], slots: 1 });
