import { sqlite } from "@flue/runtime/node";

import type { PersistenceAdapter } from "@flue/runtime/adapter";

// Conversations survive a cold start of the dev server, which Payload's threads rely on.
const db: PersistenceAdapter = sqlite("./.data/flue.db");

export default db;
