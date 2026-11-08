import { afterEach, describe, expect, it, vi } from "vitest";
import {
  downloadPerfLog,
  downloadTextFile,
  fileStamp,
  PERF_LOG_COLUMNS,
  PerfLog,
} from "../../src/engine/perf/log";
import { PerfStats, type FrameSample } from "../../src/engine/perf/stats";

function sample(overrides: Partial<FrameSample> = {}): FrameSample {
  return {
    time: 1234.5678,
    scene: "play",
    frame: 16.6667,
    update: 0.25,
    render: 1.5,
    steps: 1,
    entities: 12,
    heapBytes: 9_000_000,
    inputs: [],
    ...overrides,
  };
}

const HEADER =
  "frame,time_ms,scene,frame_ms,update_ms,render_ms,steps,entities,heap_bytes,fps,inputs";

/** A log whose files are stamped with a fixed local time. */
function makeLog(): PerfLog {
  return new PerfLog(() => new Date(2026, 9, 22, 10, 31, 14));
}

describe("PerfLog", () => {
  it("starts empty and not recording", () => {
    const log = makeLog();
    expect(log.recording).toBe(false);
    expect(log.length).toBe(0);
    expect(log.finish()).toBeNull();
  });

  it("records one CSV line per frame under a header, with the frame number and FPS", () => {
    const log = makeLog();
    const stats = new PerfStats();
    stats.record(sample());
    log.record(sample(), stats);
    expect(log.recording).toBe(true);
    expect(log.length).toBe(1);

    const second = sample({ frame: 20, heapBytes: null, steps: 2, entities: 13 });
    second.inputs = ["KeyA", "Space"];
    stats.record(second);
    stats.fps = 60;
    log.record(second, stats);

    const file = log.finish();
    expect(file?.name).toBe("perf-2026-10-22T10-31-14.csv");
    expect(file?.contents).toBe(
      [
        HEADER,
        "1,1234.568,play,16.667,0.250,1.500,1,12,9000000,0,",
        "2,1234.568,play,20.000,0.250,1.500,2,13,,60,KeyA Space",
        "",
      ].join("\n"),
    );
    expect(PERF_LOG_COLUMNS.join(",")).toBe(HEADER);
  });

  it("quotes a scene name that would break the CSV", () => {
    const log = makeLog();
    log.record(sample({ scene: 'level "1", hard' }), new PerfStats());
    expect(log.finish()?.contents.split("\n")[1]).toContain(',"level ""1"", hard",');
  });

  it("finish ends the log; the next record starts a fresh one", () => {
    const log = makeLog();
    log.record(sample(), new PerfStats());
    expect(log.finish()?.contents.split("\n")).toHaveLength(3);
    expect(log.recording).toBe(false);
    expect(log.length).toBe(0);
    expect(log.finish()).toBeNull();

    log.record(sample(), new PerfStats());
    log.record(sample(), new PerfStats());
    expect(log.finish()?.contents.split("\n")).toHaveLength(4);
  });

  it("names the file after the local time the log began", () => {
    const dates = [new Date(2026, 0, 5, 8, 7, 9), new Date(2030, 11, 31, 23, 59, 0)];
    const log = new PerfLog(() => dates.shift() ?? new Date(0));
    log.record(sample(), new PerfStats());
    log.record(sample(), new PerfStats());
    expect(log.finish()?.name).toBe("perf-2026-01-05T08-07-09.csv");
    log.record(sample(), new PerfStats());
    expect(log.finish()?.name).toBe("perf-2030-12-31T23-59-00.csv");
    expect(fileStamp(new Date(2026, 9, 22, 10, 31, 14))).toBe("2026-10-22T10-31-14");
  });
});

describe("downloadTextFile", () => {
  interface FakeLink {
    href: string;
    download: string;
    click: () => void;
    remove: () => void;
  }

  /** Fakes the bits of the DOM a download needs and records what happened. */
  function fakeBrowser() {
    const events: string[] = [];
    const blobs: { parts: unknown[]; type: string }[] = [];
    const link: FakeLink = {
      href: "",
      download: "",
      click: () => events.push("click"),
      remove: () => events.push("remove"),
    };
    vi.stubGlobal(
      "Blob",
      class {
        constructor(parts: unknown[], options: { type: string }) {
          blobs.push({ parts, type: options.type });
        }
      },
    );
    vi.stubGlobal("URL", {
      createObjectURL: () => "blob:fake",
      revokeObjectURL: (url: string) => events.push(`revoke ${url}`),
    });
    vi.stubGlobal("document", {
      createElement: (tag: string) => {
        events.push(`create ${tag}`);
        return link;
      },
      body: { append: () => events.push("append") },
    });
    return { events, blobs, link };
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("clicks a temporary download link for a blob of the text", () => {
    vi.useFakeTimers();
    const { events, blobs, link } = fakeBrowser();
    downloadTextFile("notes.txt", "hello", "text/plain");
    expect(blobs).toEqual([{ parts: ["hello"], type: "text/plain" }]);
    expect(link.href).toBe("blob:fake");
    expect(link.download).toBe("notes.txt");
    expect(events).toEqual(["create a", "append", "click", "remove"]);
    // The blob URL is released a moment later, once the browser has picked it up.
    vi.advanceTimersByTime(1000);
    expect(events.at(-1)).toBe("revoke blob:fake");
  });

  it("downloadPerfLog saves the log as CSV", () => {
    const { blobs, link } = fakeBrowser();
    downloadPerfLog({ name: "perf.csv", contents: "a,b\n" });
    expect(blobs).toEqual([{ parts: ["a,b\n"], type: "text/csv" }]);
    expect(link.download).toBe("perf.csv");
  });
});
