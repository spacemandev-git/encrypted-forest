/**
 * Black + purple/white TUI color palette constants.
 */

export const PALETTE = {
  background: "#000000",
  text: "#e0e0e0",
  primary: "#9966ff",
  secondary: "#7744cc",
  dim: "#777777",
  highlight: "#cc88ff",
  warning: "#ff4488",
  success: "#88ffbb",
  border: "#333333",
  panelBg: "rgba(0, 0, 0, 0.95)",
  fog: "#000000",
  explored: "#0a0a0a",
  gridLine: "#1a1a1a",
  gridDot: "#333333",
} as const;

/** Body type colors */
export const BODY_COLORS = {
  planet: { neutral: "#9966ff", owned: "#cc88ff", enemy: "#ff4488" },
  quasar: "#ddaaff",
  spacetimeRip: "#ff3377",
  asteroidBelt: "#ccaa55",
} as const;
