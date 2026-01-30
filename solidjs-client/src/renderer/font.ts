/**
 * Monospace font metrics for TUI canvas rendering.
 */

export const FONT_FAMILY = '"IBM Plex Mono", monospace';

/** Cell dimensions in pixels */
export const CELL_WIDTH = 12;
export const CELL_HEIGHT = 20;

/** Font size for grid glyphs */
export const GLYPH_FONT_SIZE = 14;

/** Font size for labels */
export const LABEL_FONT_SIZE = 11;

/** Font size for planet ship counts */
export const SHIP_COUNT_FONT_SIZE = 10;

/** Get a CSS font string */
export function font(size: number, weight: number = 400): string {
  return `${weight} ${size}px ${FONT_FAMILY}`;
}
