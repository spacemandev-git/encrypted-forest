/**
 * UI component types for Encrypted Forest.
 */

/**
 * Props for the Window component.
 */
export interface WindowProps {
  /** Window title displayed in the title bar */
  title: string;
  /** Whether the window is visible */
  visible?: boolean;
  /** Initial X position in pixels */
  x?: number;
  /** Initial Y position in pixels */
  y?: number;
  /** Window width in pixels */
  width?: number;
  /** Window height in pixels */
  height?: number;
  /** Minimum width */
  minWidth?: number;
  /** Minimum height */
  minHeight?: number;
  /** Whether the window can be resized */
  resizable?: boolean;
  /** Whether the window can be minimized */
  minimizable?: boolean;
  /** Whether the window can be closed */
  closable?: boolean;
  /** Z-index for stacking order */
  zIndex?: number;
}

/**
 * Window state tracked by the window manager.
 */
export interface WindowState {
  id: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  minimized: boolean;
  visible: boolean;
  zIndex: number;
}
