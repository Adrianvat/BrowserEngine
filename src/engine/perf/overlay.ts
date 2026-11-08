import type { Canvas } from "../render/canvas";
import { drawPerfOverlay, type OverlayCorner, type OverlayLayout } from "./draw";
import { formatHotkey, matchesHotkey, parseHotkey, type Hotkey, type KeyLike } from "./hotkey";
import { downloadPerfLog, PerfLog, type PerfLogFile } from "./log";
import type { FrameSample, PerfStats } from "./stats";

export interface PerfLogOptions {
  /** Gets each finished log. By default the browser downloads it as a CSV file. */
  save?: (file: PerfLogFile) => void;
}

/**
 * Hotkeys are written like "F3", "Shift+F3" or "Ctrl+Alt+KeyP": modifiers joined by "+",
 * then a KeyboardEvent.code name (a physical key, like the Keyboard resource uses).
 * A hotkey press is consumed, so the browser's own binding for it does not run.
 */
export interface PerfOverlayOptions {
  /** Shows or hides the overlay. Default "F3". */
  toggleKey?: string;
  /** Switches between the compact and full layouts. Default "Shift+F3". */
  layoutKey?: string;
  /** Moves the overlay to the next corner, clockwise. Default "Ctrl+F3". */
  cornerKey?: string;
  /** Start with the overlay showing. Default false. */
  visible?: boolean;
  /** Default "full". */
  layout?: OverlayLayout;
  /** Default "top-left". */
  corner?: OverlayCorner;
  /**
   * Log every frame's figures to a file while the overlay is shown. The file is saved
   * when the overlay is hidden or the game stops. Default true; `false` turns it off.
   */
  log?: boolean | PerfLogOptions;
}

export const DEFAULT_TOGGLE_KEY = "F3";
export const DEFAULT_LAYOUT_KEY = "Shift+F3";
export const DEFAULT_CORNER_KEY = "Ctrl+F3";

const LAYOUTS: readonly OverlayLayout[] = ["full", "compact"];
const CORNERS: readonly OverlayCorner[] = ["top-left", "top-right", "bottom-right", "bottom-left"];

function next<T>(items: readonly T[], current: T): T {
  return items[(items.indexOf(current) + 1) % items.length];
}

/**
 * The in-game performance panel: FPS, frame / update / render times with graphs, fixed
 * steps per frame, entity count and (on Chromium) JS heap. Hidden until its hotkey is
 * pressed; the game draws it on its canvas after the render systems. While it is shown,
 * every frame is also written to a log that is saved as a file once it is hidden.
 */
export class PerfOverlay {
  visible: boolean;
  layout: OverlayLayout;
  corner: OverlayCorner;
  readonly toggleKey: Hotkey;
  readonly layoutKey: Hotkey;
  readonly cornerKey: Hotkey;
  /** The frame log, or null when created with `log: false`. */
  readonly log: PerfLog | null;
  private readonly saveLog: (file: PerfLogFile) => void;
  private target: EventTarget | null = null;

  private readonly onKeyDown = (event: Event): void => {
    if (this.handleKey(event as KeyboardEvent)) event.preventDefault();
  };

  constructor(options: PerfOverlayOptions = {}) {
    this.toggleKey = parseHotkey(options.toggleKey ?? DEFAULT_TOGGLE_KEY);
    this.layoutKey = parseHotkey(options.layoutKey ?? DEFAULT_LAYOUT_KEY);
    this.cornerKey = parseHotkey(options.cornerKey ?? DEFAULT_CORNER_KEY);
    const keys = [this.toggleKey, this.layoutKey, this.cornerKey].map(formatHotkey);
    if (new Set(keys).size !== keys.length) {
      throw new Error(`Performance overlay hotkeys must differ, got ${keys.join(", ")}`);
    }
    this.visible = options.visible ?? false;
    this.layout = options.layout ?? "full";
    this.corner = options.corner ?? "top-left";
    const log = options.log ?? true;
    this.log = log === false ? null : new PerfLog();
    this.saveLog = (log === true || log === false ? undefined : log.save) ?? downloadPerfLog;
  }

  toggle(): void {
    this.visible = !this.visible;
  }

  cycleLayout(): void {
    this.layout = next(LAYOUTS, this.layout);
  }

  cycleCorner(): void {
    this.corner = next(CORNERS, this.corner);
  }

  /** Applies the key if it is one of the hotkeys; true when it was. */
  handleKey(event: KeyLike): boolean {
    if (matchesHotkey(this.toggleKey, event)) {
      this.toggle();
    } else if (matchesHotkey(this.layoutKey, event)) {
      this.cycleLayout();
    } else if (matchesHotkey(this.cornerKey, event)) {
      this.cycleCorner();
    } else {
      return false;
    }
    return true;
  }

  /** Draws the panel on the canvas when visible. Called by the game loop after rendering. */
  draw(canvas: Canvas, stats: PerfStats): void {
    if (!this.visible) return;
    drawPerfOverlay(canvas, stats, this.layout, this.corner);
  }

  /**
   * Logs the frame while the overlay is shown; once it is hidden, saves the log that was
   * in progress. Called by the game loop every frame, after the stats were updated.
   */
  logFrame(sample: FrameSample, stats: PerfStats): void {
    if (!this.log) return;
    if (this.visible) this.log.record(sample, stats);
    else this.flushLog();
  }

  /** Saves the log in progress, if any, and starts afresh. Called when the game stops. */
  flushLog(): void {
    const file = this.log?.finish();
    if (file) this.saveLog(file);
  }

  /** Starts listening for the hotkeys (keydown events) on the target. */
  attach(target: EventTarget): void {
    this.detach();
    this.target = target;
    target.addEventListener("keydown", this.onKeyDown);
  }

  detach(): void {
    if (!this.target) return;
    this.target.removeEventListener("keydown", this.onKeyDown);
    this.target = null;
  }
}
