/** One frame of a performance log. Times are in ms, as in the file. */
export interface LogRow {
  frame: number;
  /** When the frame began (ms since the game page loaded). */
  time: number;
  scene: string;
  frameMs: number;
  updateMs: number;
  renderMs: number;
  steps: number;
  entities: number;
  /** Null where the browser did not report it. */
  heapBytes: number | null;
  fps: number;
  /** Keys pressed during the frame (KeyboardEvent.code values). */
  inputs: string[];
}

/** A parsed log. */
export interface PerfLogData {
  /** In time order. Never empty. */
  rows: LogRow[];
  /** Time of the first row. */
  start: number;
  /** Time of the last row. */
  end: number;
  /** Whether any row reports the JS heap. */
  hasHeap: boolean;
  /** Where the scene changed: the first row and every row whose scene differs from the previous. */
  sceneChanges: { time: number; scene: string }[];
}

const REQUIRED_COLUMNS = [
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
] as const;

/** Columns later versions of the log added; older logs simply lack them. */
const OPTIONAL_COLUMNS = ["inputs"] as const;

/** Splits one CSV line into fields, honouring double quotes (with "" as an escaped quote). */
export function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      fields.push(field);
      field = "";
    } else {
      field += char;
    }
  }
  fields.push(field);
  return fields;
}

function number(fields: string[], index: number, column: string, lineNumber: number): number {
  const text = fields[index];
  const value = text === undefined || text.trim() === "" ? NaN : Number(text);
  if (!Number.isFinite(value)) {
    throw new Error(`Line ${lineNumber}: "${column}" is not a number (got "${text ?? ""}")`);
  }
  return value;
}

/** Reads a log written by the engine's performance overlay. Throws with a reason if it cannot. */
export function parsePerfLog(text: string): PerfLogData {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
  if (lines.length === 0) throw new Error("The file is empty");

  const header = splitCsvLine(lines[0]).map((name) => name.trim());
  const columns = new Map<string, number>();
  for (const column of REQUIRED_COLUMNS) {
    const index = header.indexOf(column);
    if (index === -1) throw new Error(`Not a performance log: no "${column}" column`);
    columns.set(column, index);
  }
  for (const column of OPTIONAL_COLUMNS) {
    const index = header.indexOf(column);
    if (index !== -1) columns.set(column, index);
  }
  type Column = (typeof REQUIRED_COLUMNS)[number] | (typeof OPTIONAL_COLUMNS)[number];
  const at = (column: Column) => columns.get(column) ?? -1;
  if (lines.length === 1) throw new Error("The log has no frames");

  const rows: LogRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const fields = splitCsvLine(lines[i]);
    const lineNumber = i + 1;
    const heap = fields[at("heap_bytes")];
    const inputs = at("inputs") === -1 ? "" : (fields[at("inputs")] ?? "");
    rows.push({
      frame: number(fields, at("frame"), "frame", lineNumber),
      time: number(fields, at("time_ms"), "time_ms", lineNumber),
      scene: fields[at("scene")] ?? "",
      frameMs: number(fields, at("frame_ms"), "frame_ms", lineNumber),
      updateMs: number(fields, at("update_ms"), "update_ms", lineNumber),
      renderMs: number(fields, at("render_ms"), "render_ms", lineNumber),
      steps: number(fields, at("steps"), "steps", lineNumber),
      entities: number(fields, at("entities"), "entities", lineNumber),
      heapBytes:
        heap === undefined || heap.trim() === ""
          ? null
          : number(fields, at("heap_bytes"), "heap_bytes", lineNumber),
      fps: number(fields, at("fps"), "fps", lineNumber),
      inputs: inputs.split(" ").filter((code) => code !== ""),
    });
  }
  // Logs are written in order; a hand-edited one may not be.
  if (rows.some((row, i) => i > 0 && row.time < rows[i - 1].time)) {
    rows.sort((a, b) => a.time - b.time);
  }

  const sceneChanges: PerfLogData["sceneChanges"] = [];
  for (const [i, row] of rows.entries()) {
    if (i === 0 || row.scene !== rows[i - 1].scene) {
      sceneChanges.push({ time: row.time, scene: row.scene });
    }
  }
  return {
    rows,
    start: rows[0].time,
    end: rows[rows.length - 1].time,
    hasHeap: rows.some((row) => row.heapBytes !== null),
    sceneChanges,
  };
}
