/**
 * No `"use client"` directive here: the login component is a server component
 * that reads cookies through Payload's server adapter. The logout button and
 * the redirect it renders carry their own directive.
 */
export * from "./login.js";
export * from "./logout-button.js";
