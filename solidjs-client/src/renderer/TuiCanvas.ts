/**
 * Core canvas renderer — game loop, grid, wireframes, fog.
 */

import type { PlanetEntry } from "@encrypted-forest/solidjs-sdk";
import { PALETTE } from "./palette.js";
import { CELL_WIDTH, CELL_HEIGHT } from "./font.js";
import { createCamera, worldToScreen, type Camera } from "./camera.js";
import { renderGrid } from "./grid.js";
import { renderPlanets, type PlanetRenderState } from "./planets.js";
import { renderFog } from "./fog.js";
import {
  createInputState,
  attachInputHandlers,
  processKeyboardPan,
  type InputState,
} from "./input.js";

export interface TargetingInfo {
  gridX: number;
  gridY: number;
  maxDistance: number;
}

export interface TuiCanvasOptions {
  canvas: HTMLCanvasElement;
  getPlanets: () => ReadonlyMap<string, PlanetEntry>;
  getExploredCoords: () => ReadonlySet<string>;
  getMapDiameter: () => number;
  getPlayerId: () => bigint | null;
  getSelectedHash: () => string | null;
  getTargetingInfo?: () => TargetingInfo | null;
  onCellClick?: (gridX: number, gridY: number) => void;
}

export class TuiCanvas {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private camera: Camera;
  private input: InputState;
  private opts: TuiCanvasOptions;
  private animFrame: number = 0;
  private startTime: number = 0;
  private planetStates: Map<string, PlanetRenderState> = new Map();
  private detachInput: (() => void) | null = null;

  constructor(opts: TuiCanvasOptions) {
    this.canvas = opts.canvas;
    this.ctx = opts.canvas.getContext("2d")!;
    this.camera = createCamera();
    this.input = createInputState();
    this.opts = opts;

    // Set up click handler
    if (opts.onCellClick) {
      this.input.onClick = (wx, wy) => {
        const gx = Math.round(wx / CELL_WIDTH);
        const gy = Math.round(wy / CELL_HEIGHT);
        opts.onCellClick!(gx, gy);
      };
    }
  }

  start(): void {
    this.resize();
    this.detachInput = attachInputHandlers(this.canvas, this.camera, this.input);
    this.startTime = performance.now();
    this.loop();

    window.addEventListener("resize", this.handleResize);
  }

  stop(): void {
    cancelAnimationFrame(this.animFrame);
    this.detachInput?.();
    window.removeEventListener("resize", this.handleResize);
  }

  getCamera(): Camera {
    return this.camera;
  }

  getHoveredCell(): { x: number; y: number } | null {
    return this.input.hoveredCell;
  }

  /** Center the camera on a grid cell and zoom to max */
  centerOn(gridX: number, gridY: number): void {
    this.camera.x = gridX * CELL_WIDTH;
    this.camera.y = gridY * CELL_HEIGHT;
    this.camera.zoom = 10;
  }

  private handleResize = () => {
    this.resize();
  };

  private resize(): void {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = window.innerWidth * dpr;
    this.canvas.height = window.innerHeight * dpr;
    this.canvas.style.width = `${window.innerWidth}px`;
    this.canvas.style.height = `${window.innerHeight}px`;
    this.ctx.scale(dpr, dpr);
  }

  private loop = () => {
    this.update();
    this.render();
    this.animFrame = requestAnimationFrame(this.loop);
  };

  private update(): void {
    processKeyboardPan(this.camera, this.input);
  }

  private render(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;

    // Clear
    this.ctx.fillStyle = PALETTE.background;
    this.ctx.fillRect(0, 0, w, h);

    const mapDiameter = this.opts.getMapDiameter();
    const exploredCoords = this.opts.getExploredCoords();
    const planets = this.opts.getPlanets();
    const playerId = this.opts.getPlayerId();
    const selectedHash = this.opts.getSelectedHash();
    const time = (performance.now() - this.startTime) / 1000;

    // Build set of planet coordinates for grid dot rendering
    const planetCoords = new Set<string>();
    for (const entry of planets.values()) {
      planetCoords.add(`${entry.discovery.x},${entry.discovery.y}`);
    }

    // Render layers
    renderGrid(this.ctx, this.camera, w, h, exploredCoords, mapDiameter, planetCoords);
    renderPlanets(
      this.ctx,
      this.camera,
      w, h,
      planets,
      playerId,
      selectedHash,
      time,
      this.planetStates
    );
    renderFog(this.ctx, this.camera, w, h, exploredCoords, mapDiameter);

    // Range circle for targeting mode
    if (this.opts.getTargetingInfo) {
      const targeting = this.opts.getTargetingInfo();
      if (targeting) {
        this.renderRangeCircle(w, h, targeting, time);
      }
    }

    // Selection highlight on hovered cell
    if (this.input.hoveredCell) {
      this.renderHoverCell(w, h);
    }
  }

  private renderRangeCircle(w: number, h: number, targeting: TargetingInfo, time: number): void {
    const [sx, sy] = worldToScreen(
      this.camera,
      targeting.gridX * CELL_WIDTH,
      targeting.gridY * CELL_HEIGHT,
      w, h
    );
    // Use average of cell dimensions as conversion factor
    const avgCellPx = (CELL_WIDTH + CELL_HEIGHT) / 2;
    const radiusPx = targeting.maxDistance * avgCellPx * this.camera.zoom;

    // Pulsing opacity
    const pulse = 0.45 + 0.15 * Math.sin(time * 3);

    this.ctx.save();
    this.ctx.strokeStyle = `rgba(255, 50, 50, ${pulse})`;
    this.ctx.lineWidth = 1.5;
    this.ctx.setLineDash([6, 4]);
    this.ctx.beginPath();
    this.ctx.arc(sx, sy, radiusPx, 0, Math.PI * 2);
    this.ctx.stroke();
    this.ctx.restore();
  }

  private renderHoverCell(w: number, h: number): void {
    const cell = this.input.hoveredCell!;
    const [sx, sy] = worldToScreen(
      this.camera,
      cell.x * CELL_WIDTH,
      cell.y * CELL_HEIGHT,
      w, h
    );
    const cellW = CELL_WIDTH * this.camera.zoom;
    const cellH = CELL_HEIGHT * this.camera.zoom;

    this.ctx.save();
    this.ctx.strokeStyle = PALETTE.primary;
    this.ctx.lineWidth = 1;
    this.ctx.globalAlpha = 0.5;
    this.ctx.strokeRect(sx - cellW / 2, sy - cellH / 2, cellW, cellH);
    this.ctx.restore();
  }
}
