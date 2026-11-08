import type { FrameSample } from "./stats";

/** A finished log, ready to be saved. */
export interface PerfLogFile {
  /** E.g. "perf-2026-10-22T10-31-14.csv" (local time when the log began). */
  name: string;
  /** CSV text: a header line, then one line per frame. */
  contents: string;
}

/** The log's columns, in order. Times are in ms; `heap_bytes` is empty where not reported. */
export const PERF_LOG_COLUMNS = [
  "frame",
  "time_ms",
  "scene",
  "frame_ms",
  "update_ms",
  "render_ms",
  "steps",
  "entities",
  "heap_bytes",
  "fps",
  "inputs",
] as const;

/** Quotes a CSV field when it needs it (commas, quotes or line breaks). */
function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** Local time, safe in a file name: "2026-10-22T10-31-14". */
export function fileStamp(date: Date): string {
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const time = `${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
  return `${day}T${time}`;
}

/** One frame as a CSV line, in the order of PERF_LOG_COLUMNS. */
export function formatPerfLogRow(sample: FrameSample, frames: number, fps: number): string {
  const row: (string | number)[] = [
    frames,
    sample.time.toFixed(3),
    csvField(sample.scene),
    sample.frame.toFixed(3),
    sample.update.toFixed(3),
    sample.render.toFixed(3),
    sample.steps,
    sample.entities,
    sample.heapBytes ?? "",
    fps,
    csvField(sample.inputs.join(" ")),
  ];
  return row.join(",");
}

/**
 * Collects one CSV line per frame. Recording starts with the first `record` and ends with
 * `finish`, which hands back the file; the next `record` then starts a new log.
 */
export class PerfLog {
  private rows: string[] = [];
  private startedAt: Date | null = null;

  constructor(private readonly now: () => Date = () => new Date()) {}

  /** True between the first `record` and `finish`. */
  get recording(): boolean {
    return this.startedAt !== null;
  }

  /** How many frames the log in progress holds. */
  get length(): number {
    return this.rows.length;
  }

  /** Adds the frame. `stats` supplies the frame number and the FPS reading. */
  record(sample: FrameSample, stats: { frames: number; fps: number }): void {
    if (!this.startedAt) this.startedAt = this.now();
    this.rows.push(formatPerfLogRow(sample, stats.frames, stats.fps));
  }

  /** Ends the log and returns it as a file, or null when nothing was recorded. */
  finish(): PerfLogFile | null {
    const startedAt = this.startedAt;
    if (!startedAt) return null;
    const lines = [PERF_LOG_COLUMNS.join(","), ...this.rows];
    this.rows = [];
    this.startedAt = null;
    return { name: `perf-${fileStamp(startedAt)}.csv`, contents: `${lines.join("\n")}\n` };
  }
}

/** Saves text as a file through the browser: it lands in the downloads folder. */
export function downloadTextFile(name: string, contents: string, type = "text/plain"): void {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  // Firefox only follows clicks on links that are in the document.
  document.body.append(link);
  link.click();
  link.remove();
  // Not right away: some browsers start the download after click() returns.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The default way to save a log: a CSV download. */
export function downloadPerfLog(file: PerfLogFile): void {
  downloadTextFile(file.name, file.contents, "text/csv");
}
