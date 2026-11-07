/*
 * Payload 3 theme variables with their Payload 4 equivalents as fallbacks, so
 * one stylesheet serves both majors. Payload 4 defines no spacing unit, hence
 * the literal `base`.
 */
export const T = {
	base: "var(--base, 1.25rem)",
	radius: "var(--style-radius-s, var(--radius-chip))",
	bgSubtle: "var(--theme-elevation-50, var(--color-bg-secondary))",
	bgHover: "var(--theme-elevation-100, var(--color-bg-secondary-hover))",
	borderControl: "var(--theme-elevation-150, var(--color-border-control))",
	border: "var(--theme-border-color, var(--color-border))",
	textTertiary: "var(--theme-elevation-400, var(--color-text-tertiary))",
	textSecondary: "var(--theme-elevation-500, var(--color-text-secondary))",
	text: "var(--theme-elevation-800, var(--color-text))",
	inputBg: "var(--theme-input-bg, var(--color-bg))",
	danger: "var(--theme-error-500, var(--color-text-danger))",
	mono: "var(--font-mono, var(--font-family-mono))",
} as const;
