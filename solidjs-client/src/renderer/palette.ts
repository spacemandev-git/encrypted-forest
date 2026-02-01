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
  explored: "#0d0d14",
  gridLine: "#222233",
  gridDot: "#444466",
} as const;

/** Ownership colors — same for all body types */
export const BODY_COLORS = {
  neutral: "#888899",   // grey — unowned
  owned: "#4488ff",     // blue — owned by current wallet
  enemy: "#ff4455",     // red — owned by another wallet
} as const;
