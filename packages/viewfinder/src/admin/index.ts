"use client";

/**
 * The admin surface is one component. The DOM-id conventions it depends on
 * stay internal: they are Payload's, not viewfinder's, and exporting them
 * would turn an implementation detail into a contract.
 */
export { ViewfinderFormBridge } from "./bridge.js";
