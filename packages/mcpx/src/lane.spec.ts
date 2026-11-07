import { payloadMajor } from "@internal/test-utils/payload-major";
import * as payloadModule from "payload";
import { describe, expect, it } from "vitest";

describe("payload lane", () => {
	it("loads the Payload major the run targets", () => {
		const isV4 = payloadMajor() === 4;

		expect("createLocalReq" in payloadModule).toBe(!isV4);
		expect("createFolderField" in payloadModule).toBe(isV4);
	});
});
