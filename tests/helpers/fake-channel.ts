import type { PerfChannel, PerfMessage } from "../../src/engine/perf/broadcast";

/** A channel that records what was posted and lets a test deliver messages. */
export class FakeChannel implements PerfChannel {
  readonly posted: PerfMessage[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  closed = false;

  postMessage(message: PerfMessage): void {
    this.posted.push(message);
  }
  close(): void {
    this.closed = true;
  }
  /** A message arriving from the other side. */
  deliver(data: unknown): void {
    this.onmessage?.({ data });
  }
  types(): string[] {
    return this.posted.map((message) => message.type);
  }
}
