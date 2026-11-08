import { Series } from "./series";

/** How many frames of history the time series keep (3 s at 60 fps). */
export const HISTORY = 180;

/** The FPS reading is refreshed whenever this much time has passed, in ms. */
export const FPS_WINDOW = 500;

/** What the game loop measured during one frame. Times are in milliseconds. */
export interface FrameSample {
  /** When the frame began, as requestAnimationFrame stamps it (ms since the page loaded). */
  time: number;
  /** The scene that was rendered. */
  scene: string;
  /** Time since the previous frame began (what FPS is made of). */
  frame: number;
  /** Time spent in this frame's fixed update steps (systems, animation, scene switches). */
  update: number;
  /** Time spent in this frame's render systems. */
  render: number;
  /** How many fixed update steps ran this frame. */
  steps: number;
  /** Entities alive in the running scene at the end of the frame. */
  entities: number;
  /** Used JS heap in bytes, or null when the browser does not report it. */
  heapBytes: number | null;
  /** Keys pressed during the frame (KeyboardEvent.code values), in order. */
  inputs: string[];
}

/**
 * Performance figures for the running game, refreshed once per frame by the game loop.
 * A global resource, so systems can read it too (e.g. to show the FPS in a Text).
 */
export class PerfStats {
  /** Frames per second, averaged over the last half second. 0 until the first reading. */
  fps = 0;
  /** Time between frames, in ms. */
  readonly frameTime = new Series(HISTORY);
  /** Time spent in fixed update steps per frame, in ms. */
  readonly updateTime = new Series(HISTORY);
  /** Time spent in render systems per frame, in ms. */
  readonly renderTime = new Series(HISTORY);
  /** Fixed update steps run in the last frame. */
  steps = 0;
  /** Entities alive in the running scene. */
  entities = 0;
  /** Used JS heap in bytes, or null when the browser does not report it. */
  heapBytes: number | null = null;
  /** Frames recorded since the game started. */
  frames = 0;

  private windowFrames = 0;
  private windowTime = 0;

  /** Called by the game loop at the end of each frame. */
  record(sample: FrameSample): void {
    this.frames++;
    this.frameTime.push(sample.frame);
    this.updateTime.push(sample.update);
    this.renderTime.push(sample.render);
    this.steps = sample.steps;
    this.entities = sample.entities;
    this.heapBytes = sample.heapBytes;

    this.windowFrames++;
    this.windowTime += sample.frame;
    if (this.windowTime >= FPS_WINDOW) {
      this.fps = Math.round((this.windowFrames * 1000) / this.windowTime);
      this.windowFrames = 0;
      this.windowTime = 0;
    }
  }

  /** Forgets everything recorded so far. */
  reset(): void {
    this.fps = 0;
    this.frameTime.clear();
    this.updateTime.clear();
    this.renderTime.clear();
    this.steps = 0;
    this.entities = 0;
    this.heapBytes = null;
    this.frames = 0;
    this.windowFrames = 0;
    this.windowTime = 0;
  }
}

/** Used JS heap in bytes. Only Chromium browsers report it (performance.memory); null elsewhere. */
export function readHeapBytes(): number | null {
  const memory = (performance as { memory?: { usedJSHeapSize?: unknown } }).memory;
  const used = memory?.usedJSHeapSize;
  return typeof used === "number" ? used : null;
}
