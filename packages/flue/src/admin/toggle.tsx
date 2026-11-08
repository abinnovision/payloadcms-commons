"use client";

import { Button, SpinnerIcon } from "@payloadcms/ui";
import React from "react";

import { PANEL_ID } from "./layout.js";
import { useFlue } from "./provider.js";

/**
 * Opens and closes the agent chat from the admin header, as Ctrl or Cmd
 * plus J does. Renders nothing until the user has an agent to chat with or
 * may read agent runs.
 */
export const FlueToggle: React.FC = () => {
	const flue = useFlue();

	if (!flue || (flue.agents.length === 0 && !flue.runs)) {
		return null;
	}

	return (
		<Button
			aria-controls={PANEL_ID}
			aria-expanded={flue.open}
			aria-label={flue.running ? "Agents (working)" : "Agents"}
			buttonStyle="pill"
			icon={flue.running ? <SpinnerIcon size="sm" /> : undefined}
			iconPosition="left"
			margin={false}
			onClick={flue.toggle}
			selected={flue.open}
			tooltip="Ctrl or Cmd + J"
		>
			Agents
		</Button>
	);
};
