/**
 * UI component types for Encrypted Forest.
 */

export interface WindowProps {
  title: string;
  visible?: boolean;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  minWidth?: number;
  minHeight?: number;
  resizable?: boolean;
  minimizable?: boolean;
  closable?: boolean;
  zIndex?: number;
  onclose?: () => void;
  onfocus?: () => void;
}

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
