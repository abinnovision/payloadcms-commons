/** The panel's element id, which the toggle controls. */
export const PANEL_ID = "flue-panel";

/** The panel's width bounds and default, in pixels. */
export const PANEL_WIDTH = { min: 320, max: 720, initial: 420 } as const;

/** The width kept within {@link PANEL_WIDTH}. */
export const clampWidth = (width: number): number =>
	Math.round(Math.min(PANEL_WIDTH.max, Math.max(PANEL_WIDTH.min, width)));
