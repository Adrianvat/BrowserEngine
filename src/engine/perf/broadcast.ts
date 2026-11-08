import type { FrameSample } from "./stats";

/** The BroadcastChannel name the game and the live performance page meet on. */
export const PERF_CHANNEL = "browser-engine:perf";

/** A viewer that has not asked for frames for this long (ms) is gone, so sending stops. */
export const SUBSCRIBE_TIMEOUT = 3000;

/** What the game and a viewer send each other. */
export type PerfMessage =
  /** Viewer to game: send me frames. Repeated regularly while the viewer is open. */
  | { type: "subscribe" }
  /** Game to viewer: a game is running (sent when it starts and in answer to subscribe). */
  | { type: "hello" }
  /** Game to viewer: one frame, with the frame number and FPS reading that go with it. */
  | { type: "frame"; frame: number; fps: number; sample: FrameSample }
  /** Game to viewer: the game stopped. */
  | { type: "bye" };

/** The part of BroadcastChannel that is used, so tests can stand in for it. */
export interface PerfChannel {
  postMessage(message: PerfMessage): void;
  onmessage: ((event: { data: unknown }) => void) | null;
  close(): void;
}

/** Opens the real channel. */
export function openPerfChannel(name = PERF_CHANNEL): PerfChannel {
  return new BroadcastChannel(name) as unknown as PerfChannel;
}

/**
 * Sends the game's frames to live performance pages in other tabs, while one is listening.
 * Nothing is sent (beyond hello and bye) until a viewer subscribes, so it costs nothing
 * when no page is open.
 */
export class PerfBroadcast {
  private lastSubscribe = -Infinity;
  private open = false;

  constructor(
    private readonly channel: PerfChannel,
    private readonly now: () => number = () => performance.now(),
  ) {
    channel.onmessage = (event) => this.receive(event.data);
  }

  /** True while a viewer asked for frames recently. */
  get listening(): boolean {
    return this.now() - this.lastSubscribe < SUBSCRIBE_TIMEOUT;
  }

  /** Announces the game. Called when it starts. */
  start(): void {
    this.open = true;
    this.channel.postMessage({ type: "hello" });
  }

  /** Sends the frame, if a viewer is listening. Called by the game loop every frame. */
  frame(sample: FrameSample, stats: { frames: number; fps: number }): void {
    if (!this.open || !this.listening) return;
    this.channel.postMessage({ type: "frame", frame: stats.frames, fps: stats.fps, sample });
  }

  /** Tells viewers the game stopped. */
  stop(): void {
    if (!this.open) return;
    this.open = false;
    this.channel.postMessage({ type: "bye" });
  }

  /** Stops and releases the channel. */
  close(): void {
    this.stop();
    this.channel.onmessage = null;
    this.channel.close();
  }

  private receive(data: unknown): void {
    if (!isSubscribe(data)) return;
    this.lastSubscribe = this.now();
    // A viewer that opened after the game started learns it is there.
    if (this.open) this.channel.postMessage({ type: "hello" });
  }
}

function isSubscribe(data: unknown): boolean {
  if (typeof data !== "object" || data === null) return false;
  return (data as { type?: unknown }).type === "subscribe";
}
