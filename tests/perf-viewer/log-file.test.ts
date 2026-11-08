import { describe, expect, it } from "vitest";
import { parsePerfLog, splitCsvLine } from "../../src/perf-viewer/log-file";

const HEADER = "frame,time_ms,scene,frame_ms,update_ms,render_ms,steps,entities,heap_bytes,fps";

function log(...rows: string[]): string {
  return [HEADER, ...rows].join("\n") + "\n";
}

describe("splitCsvLine", () => {
  it("splits on commas and keeps empty fields", () => {
    expect(splitCsvLine("1,,three")).toEqual(["1", "", "three"]);
    expect(splitCsvLine("")).toEqual([""]);
  });

  it("honours quotes, with doubled quotes inside them", () => {
    expect(splitCsvLine('1,"level ""1"", hard",2')).toEqual(["1", 'level "1", hard', "2"]);
  });
});

describe("parsePerfLog", () => {
  it("reads the rows the overlay writes", () => {
    const data = parsePerfLog(
      log("1,1000.000,play,16.667,0.250,1.500,1,12,9000000,0", "2,1016.667,play,20,0.3,1,2,13,,60"),
    );
    expect(data.rows).toEqual([
      {
        frame: 1,
        time: 1000,
        scene: "play",
        frameMs: 16.667,
        updateMs: 0.25,
        renderMs: 1.5,
        steps: 1,
        entities: 12,
        heapBytes: 9_000_000,
        fps: 0,
        inputs: [],
      },
      {
        frame: 2,
        time: 1016.667,
        scene: "play",
        frameMs: 20,
        updateMs: 0.3,
        renderMs: 1,
        steps: 2,
        entities: 13,
        heapBytes: null,
        fps: 60,
        inputs: [],
      },
    ]);
    expect(data.start).toBe(1000);
    expect(data.end).toBe(1016.667);
    expect(data.hasHeap).toBe(true);
  });

  it("notes where the scene changes, starting with the first row", () => {
    const data = parsePerfLog(
      log(
        "1,1000,title,16,0,0,1,1,,0",
        "2,1016,title,16,0,0,1,1,,0",
        "3,1032,play,16,0,0,1,1,,0",
        '4,1048,"a, b",16,0,0,1,1,,0',
      ),
    );
    expect(data.sceneChanges).toEqual([
      { time: 1000, scene: "title" },
      { time: 1032, scene: "play" },
      { time: 1048, scene: "a, b" },
    ]);
    expect(data.hasHeap).toBe(false);
  });

  it("accepts CRLF line endings, blank lines and columns in another order", () => {
    const text =
      "fps,frame,heap_bytes,time_ms,scene,frame_ms,update_ms,render_ms,steps,entities\r\n" +
      "60,1,,1000,play,16,0,0,1,5\r\n\r\n";
    const data = parsePerfLog(text);
    expect(data.rows[0]).toMatchObject({ fps: 60, frame: 1, time: 1000, entities: 5 });
  });

  it("reads the keys pressed in each frame, when the log has the column", () => {
    const text =
      HEADER + ",inputs\n" +
      "1,1000,play,16,0,0,1,1,,0,\n" +
      "2,1016,play,16,0,0,1,1,,0,KeyA\n" +
      '3,1032,play,16,0,0,1,1,,0,"ArrowLeft Space"\n';
    expect(parsePerfLog(text).rows.map((row) => row.inputs)).toEqual([
      [],
      ["KeyA"],
      ["ArrowLeft", "Space"],
    ]);
  });

  it("puts a hand-edited log back in time order", () => {
    const data = parsePerfLog(log("2,2000,a,16,0,0,1,1,,0", "1,1000,a,16,0,0,1,1,,0"));
    expect(data.rows.map((row) => row.time)).toEqual([1000, 2000]);
  });

  it("rejects files that are not performance logs, naming the problem", () => {
    expect(() => parsePerfLog("")).toThrow("The file is empty");
    expect(() => parsePerfLog("a,b,c\n1,2,3\n")).toThrow(
      'Not a performance log: no "frame" column',
    );
    expect(() => parsePerfLog(HEADER.replace("heap_bytes", "heap"))).toThrow('no "heap_bytes"');
    expect(() => parsePerfLog(HEADER + "\n")).toThrow("The log has no frames");
    expect(() => parsePerfLog(log("1,1000,play,fast,0,0,1,1,,0"))).toThrow(
      'Line 2: "frame_ms" is not a number (got "fast")',
    );
    expect(() => parsePerfLog(log("1,1000,play,16,0,0,1"))).toThrow(
      'Line 2: "entities" is not a number (got "")',
    );
  });
});
