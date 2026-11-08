import {
  fileStamp,
  formatPerfLogRow,
  PERF_LOG_COLUMNS,
  type FrameSample,
  type PerfChannel,
  type PerfLogFile,
} from "../engine";
import type { LogRow, PerfLogData } from "../perf-viewer/log-file";

/** Frames kept; the oldest go when there are more (about 70 minutes at 60 fps). */
export const MAX_ROWS = 250_000;

/** Without a frame for this long (ms) the feed counts as stalled. */
export const STALL_TIMEOUT = 2000;

export type FeedStatus =
  /** No game has spoken yet. */
  | "waiting"
  /** Frames are coming in. */
  | "live"
  /** A game was there, but no frame has come for a while. */
  | "stalled"
  /** The game said it stopped. */
  | "stopped";

function isFrameSample(value: unknown): value is FrameSample {
  if (typeof value !== "object" || value === null) return false;
  const sample = value as Record<string, unknown>;
  const numbers = ["time", "frame", "update", "render", "steps", "entities"];
  return (
    numbers.every((key) => typeof sample[key] === "number") &&
    typeof sample.scene === "string" &&
    (sample.heapBytes === null || typeof sample.heapBytes === "number") &&
    Array.isArray(sample.inputs) &&
    sample.inputs.every((code) => typeof code === "string")
  );
}

/**
 * Collects the frames a running game broadcasts, as rows the charts can draw.
 * Keeps asking for frames (`subscribe`) so the game knows someone is listening.
 */
export class LiveFeed {
  private readonly rows: LogRow[] = [];
  private sceneChanges: { time: number; scene: string }[] = [];
  private hasHeap = false;
  private heard = false;
  private stopped = false;
  private lastFrameAt = -Infinity;
  private lastScene = "";
  private lastFps = 0;
  private readonly listeners: (() => void)[] = [];

  constructor(
    private readonly channel: PerfChannel,
    private readonly now: () => number = () => performance.now(),
    /** How many frames to keep (MAX_ROWS); tests use a small number to exercise the trimming cheaply. */
    private readonly maxRows = MAX_ROWS,
  ) {
    channel.onmessage = (event) => this.receive(event.data);
  }

  /** Asks the game for frames. Call right away and then about once a second. */
  subscribe(): void {
    this.channel.postMessage({ type: "subscribe" });
  }

  get status(): FeedStatus {
    if (this.stopped) return "stopped";
    if (this.now() - this.lastFrameAt < STALL_TIMEOUT) return "live";
    return this.heard ? "stalled" : "waiting";
  }

  /** The scene of the latest frame. */
  get scene(): string {
    return this.lastScene;
  }

  /** The FPS reading that came with the latest frame. */
  get fps(): number {
    return this.lastFps;
  }

  get length(): number {
    return this.rows.length;
  }

  /** What was collected, in the shape the charts take; null while there is nothing. */
  get data(): PerfLogData | null {
    if (this.rows.length === 0) return null;
    return {
      rows: this.rows,
      start: this.rows[0].time,
      end: this.rows[this.rows.length - 1].time,
      hasHeap: this.hasHeap,
      sceneChanges: this.sceneChanges,
    };
  }

  /** Runs after every message from the game. */
  onChange(listener: () => void): void {
    this.listeners.push(listener);
  }

  /** Forgets the frames collected so far. */
  clear(): void {
    this.rows.length = 0;
    this.sceneChanges = [];
    this.hasHeap = false;
    this.notify();
  }

  /** The collected frames as a log file, in the format the log viewer reads. */
  toFile(): PerfLogFile {
    const lines = [
      PERF_LOG_COLUMNS.join(","),
      ...this.rows.map((row) => formatPerfLogRow(toSample(row), row.frame, row.fps)),
    ];
    return { name: `perf-live-${fileStamp(new Date())}.csv`, contents: `${lines.join("\n")}\n` };
  }

  /** Stops listening and releases the channel. */
  close(): void {
    this.channel.onmessage = null;
    this.channel.close();
  }

  private receive(data: unknown): void {
    if (typeof data !== "object" || data === null) return;
    const message = data as { type?: unknown; frame?: unknown; fps?: unknown; sample?: unknown };
    switch (message.type) {
      case "hello":
        this.heard = true;
        this.stopped = false;
        // Do not wait for the next regular subscribe: frames can start now.
        this.subscribe();
        break;
      case "bye":
        this.stopped = true;
        break;
      case "frame":
        if (
          typeof message.frame !== "number" ||
          typeof message.fps !== "number" ||
          !isFrameSample(message.sample)
        ) {
          return;
        }
        this.addFrame(message.sample, message.frame, message.fps);
        break;
      default:
        return;
    }
    this.notify();
  }

  private addFrame(sample: FrameSample, frame: number, fps: number): void {
    this.heard = true;
    this.stopped = false;
    this.lastFrameAt = this.now();
    this.lastScene = sample.scene;
    this.lastFps = fps;
    const previous = this.rows[this.rows.length - 1];
    if (!previous || previous.scene !== sample.scene) {
      this.sceneChanges.push({ time: sample.time, scene: sample.scene });
    }
    if (sample.heapBytes !== null) this.hasHeap = true;
    this.rows.push({
      frame,
      time: sample.time,
      scene: sample.scene,
      frameMs: sample.frame,
      updateMs: sample.update,
      renderMs: sample.render,
      steps: sample.steps,
      entities: sample.entities,
      heapBytes: sample.heapBytes,
      fps,
      inputs: sample.inputs,
    });
    if (this.rows.length > this.maxRows) this.trim();
  }

  /** Drops the oldest tenth of the rows, keeping the scene markers that still apply. */
  private trim(): void {
    this.rows.splice(0, Math.floor(this.maxRows / 10));
    const start = this.rows[0];
    this.sceneChanges = this.sceneChanges.filter((change) => change.time >= start.time);
    if (this.sceneChanges.length === 0 || this.sceneChanges[0].time !== start.time) {
      this.sceneChanges.unshift({ time: start.time, scene: start.scene });
    }
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}

function toSample(row: LogRow): FrameSample {
  return {
    time: row.time,
    scene: row.scene,
    frame: row.frameMs,
    update: row.updateMs,
    render: row.renderMs,
    steps: row.steps,
    entities: row.entities,
    heapBytes: row.heapBytes,
    inputs: row.inputs,
  };
}
