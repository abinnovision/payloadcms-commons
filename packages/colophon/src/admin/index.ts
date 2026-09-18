/**
 * Deliberately without a `"use client"` directive, unlike the admin barrels of
 * the other packages here. The component reads `process.env` in the running
 * process, which only a server component can do.
 */
export * from "./colophon.js";
