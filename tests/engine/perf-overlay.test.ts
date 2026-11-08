import { describe, expect, it, vi } from "vitest";
import { COLORS, FRAME_BUDGET_MS, GRAPH_MAX_MS } from "../../src/engine/perf/draw";
import { formatHotkey } from "../../src/engine/perf/hotkey";
import type { PerfLogFile } from "../../src/engine/perf/log";
import { PerfOverlay } from "../../src/engine/perf/overlay";
import { PerfStats, type FrameSample } from "../../src/engine/perf/stats";
import { recordingCanvas, type Call, type TextDraw } from "../helpers/recording-canvas";

function keyEvent(code: string, modifiers: Partial<KeyboardEvent> = {}): Event {
  return Object.assign(new Event("keydown", { cancelable: true }), { code, ...modifiers });
}

function sample(overrides: Partial<FrameSample> = {}): FrameSample {
  return {
    time: 1000,
    scene: "main",
    frame: 16,
    update: 1,
    render: 2,
    steps: 1,
    entities: 5,
    heapBytes: null,
    inputs: [],
    ...overrides,
  };
}

/** Stats with an FPS reading of `fps` and the given frame times as the newest samples. */
function statsWith(fps: number, frames: number[] = []): PerfStats {
  const stats = new PerfStats();
  // Frames at a steady rate until the first half-second window closes and gives the reading.
  while (stats.fps === 0) stats.record(sample({ frame: 1000 / fps }));
  for (const frame of frames) stats.record(sample({ frame }));
  return stats;
}

function textValues(texts: TextDraw[]): unknown[] {
  return texts.map((text) => text.value);
}

function findText(texts: TextDraw[], value: string): TextDraw {
  const found = texts.find((text) => text.value === value);
  if (!found) {
    throw new Error(`No text "${value}" was drawn; drawn: ${textValues(texts).join(", ")}`);
  }
  return found;
}

function rects(calls: Call[]): Call[] {
  return calls.filter((call) => call[0] === "fillRect");
}

describe("PerfOverlay state", () => {
  it("starts hidden, full, top-left, with F3-based hotkeys", () => {
    const overlay = new PerfOverlay();
    expect(overlay.visible).toBe(false);
    expect(overlay.layout).toBe("full");
    expect(overlay.corner).toBe("top-left");
    expect(formatHotkey(overlay.toggleKey)).toBe("F3");
    expect(formatHotkey(overlay.layoutKey)).toBe("Shift+F3");
    expect(formatHotkey(overlay.cornerKey)).toBe("Ctrl+F3");
  });

  it("takes its start state and hotkeys from the options", () => {
    const overlay = new PerfOverlay({
      visible: true,
      layout: "compact",
      corner: "bottom-right",
      toggleKey: "Backquote",
      layoutKey: "Shift+Backquote",
      cornerKey: "Alt+Backquote",
    });
    expect(overlay.visible).toBe(true);
    expect(overlay.layout).toBe("compact");
    expect(overlay.corner).toBe("bottom-right");
    expect(formatHotkey(overlay.toggleKey)).toBe("Backquote");
    expect(formatHotkey(overlay.layoutKey)).toBe("Shift+Backquote");
    expect(formatHotkey(overlay.cornerKey)).toBe("Alt+Backquote");
  });

  it("rejects hotkeys that clash or cannot be parsed", () => {
    expect(() => new PerfOverlay({ layoutKey: "F3" })).toThrow(
      "Performance overlay hotkeys must differ, got F3, F3, Ctrl+F3",
    );
    expect(() => new PerfOverlay({ toggleKey: "Hyper+F3" })).toThrow('unknown modifier "Hyper"');
  });

  it("toggle shows and hides", () => {
    const overlay = new PerfOverlay();
    overlay.toggle();
    expect(overlay.visible).toBe(true);
    overlay.toggle();
    expect(overlay.visible).toBe(false);
  });

  it("cycles the layouts and the corners clockwise", () => {
    const overlay = new PerfOverlay();
    overlay.cycleLayout();
    expect(overlay.layout).toBe("compact");
    overlay.cycleLayout();
    expect(overlay.layout).toBe("full");

    const corners: string[] = [];
    for (let i = 0; i < 4; i++) {
      overlay.cycleCorner();
      corners.push(overlay.corner);
    }
    expect(corners).toEqual(["top-right", "bottom-right", "bottom-left", "top-left"]);
  });
});

describe("PerfOverlay hotkeys", () => {
  it("handleKey applies the matching hotkey and says whether one matched", () => {
    const overlay = new PerfOverlay();
    expect(overlay.handleKey({ code: "F3" })).toBe(true);
    expect(overlay.visible).toBe(true);
    expect(overlay.handleKey({ code: "F3", shiftKey: true })).toBe(true);
    expect(overlay.layout).toBe("compact");
    expect(overlay.handleKey({ code: "F3", ctrlKey: true })).toBe(true);
    expect(overlay.corner).toBe("top-right");
  });

  it("ignores other keys and the hotkey with extra modifiers", () => {
    const overlay = new PerfOverlay();
    expect(overlay.handleKey({ code: "F4" })).toBe(false);
    expect(overlay.handleKey({ code: "F3", altKey: true })).toBe(false);
    expect(overlay.handleKey({ code: "F3", shiftKey: true, ctrlKey: true })).toBe(false);
    expect(overlay.visible).toBe(false);
    expect(overlay.layout).toBe("full");
    expect(overlay.corner).toBe("top-left");
  });

  it("listens for keydown on the attached target and consumes its hotkeys", () => {
    const target = new EventTarget();
    const overlay = new PerfOverlay();
    overlay.attach(target);

    const toggle = keyEvent("F3");
    target.dispatchEvent(toggle);
    expect(overlay.visible).toBe(true);
    expect(toggle.defaultPrevented).toBe(true);

    const other = keyEvent("Space");
    target.dispatchEvent(other);
    expect(other.defaultPrevented).toBe(false);
  });

  it("detach stops listening; attaching elsewhere moves the listener", () => {
    const first = new EventTarget();
    const second = new EventTarget();
    const overlay = new PerfOverlay();
    overlay.attach(first);
    overlay.detach();
    first.dispatchEvent(keyEvent("F3"));
    expect(overlay.visible).toBe(false);
    expect(() => overlay.detach()).not.toThrow();

    overlay.attach(first);
    overlay.attach(second);
    first.dispatchEvent(keyEvent("F3"));
    expect(overlay.visible).toBe(false);
    second.dispatchEvent(keyEvent("F3"));
    expect(overlay.visible).toBe(true);
  });
});

describe("PerfOverlay logging", () => {
  /** An overlay whose finished logs are collected instead of downloaded. */
  function loggingOverlay(visible = false) {
    const files: PerfLogFile[] = [];
    const overlay = new PerfOverlay({ visible, log: { save: (file) => files.push(file) } });
    return { overlay, files };
  }

  it("logs by default, unless asked not to", () => {
    expect(new PerfOverlay().log).not.toBeNull();
    expect(new PerfOverlay({ log: true }).log).not.toBeNull();
    expect(new PerfOverlay({ log: {} }).log).not.toBeNull();
    expect(new PerfOverlay({ log: false }).log).toBeNull();
  });

  it("records frames only while shown", () => {
    const { overlay } = loggingOverlay();
    const stats = new PerfStats();
    overlay.logFrame(sample(), stats);
    expect(overlay.log?.recording).toBe(false);

    overlay.toggle();
    overlay.logFrame(sample(), stats);
    overlay.logFrame(sample(), stats);
    expect(overlay.log?.recording).toBe(true);
    expect(overlay.log?.length).toBe(2);
  });

  it("saves the log on the first frame after being hidden, then starts a new one", () => {
    const { overlay, files } = loggingOverlay(true);
    const stats = new PerfStats();
    overlay.logFrame(sample({ scene: "first" }), stats);
    overlay.toggle();
    expect(files).toHaveLength(0);
    overlay.logFrame(sample(), stats);
    expect(files).toHaveLength(1);
    expect(files[0].name).toMatch(/^perf-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.csv$/);
    expect(files[0].contents.split("\n")).toHaveLength(3);
    expect(files[0].contents).toContain(",first,");

    // Hidden frames neither log nor save again.
    overlay.logFrame(sample(), stats);
    expect(files).toHaveLength(1);
    expect(overlay.log?.recording).toBe(false);

    overlay.toggle();
    overlay.logFrame(sample({ scene: "second" }), stats);
    overlay.toggle();
    overlay.logFrame(sample(), stats);
    expect(files).toHaveLength(2);
    expect(files[1].contents).toContain(",second,");
    expect(files[1].contents).not.toContain(",first,");
  });

  it("flushLog saves what was logged so far and ends the log", () => {
    const { overlay, files } = loggingOverlay(true);
    overlay.flushLog();
    expect(files).toHaveLength(0); // nothing logged yet
    overlay.logFrame(sample(), new PerfStats());
    overlay.flushLog();
    expect(files).toHaveLength(1);
    expect(overlay.log?.recording).toBe(false);
    overlay.flushLog();
    expect(files).toHaveLength(1);
  });

  it("does nothing with log: false", () => {
    const overlay = new PerfOverlay({ visible: true, log: false });
    expect(() => {
      overlay.logFrame(sample(), new PerfStats());
      overlay.toggle();
      overlay.logFrame(sample(), new PerfStats());
      overlay.flushLog();
    }).not.toThrow();
  });
});

describe("PerfOverlay drawing", () => {
  it("draws nothing while hidden", () => {
    const { canvas, calls } = recordingCanvas(400, 300);
    new PerfOverlay().draw(canvas, new PerfStats());
    expect(calls).toEqual([]);
  });

  it("compact: one line with the FPS and the frame time, in the top-left corner", () => {
    const { canvas, calls, texts } = recordingCanvas(400, 300);
    const overlay = new PerfOverlay({ visible: true, layout: "compact" });
    overlay.draw(canvas, statsWith(60, [16.25]));

    expect(calls[0]).toEqual(["save"]);
    expect(calls[1]).toEqual(["fillRect", COLORS.background, 8, 8, 128, 26]);
    expect(calls.at(-1)).toEqual(["restore"]);
    expect(textValues(texts)).toEqual(["60 fps", "16.3 ms"]);

    const fps = findText(texts, "60 fps");
    expect(fps).toMatchObject({ x: 14, y: 15, textAlign: "left", textBaseline: "top" });
    expect(fps.font).toBe("11px monospace");
    expect(fps.fillStyle).toBe(COLORS.fpsGood);
    expect(findText(texts, "16.3 ms")).toMatchObject({ x: 130, textAlign: "right" });
  });

  it("colors the FPS by how good it is, and shows -- before the first reading", () => {
    const fpsColor = (stats: PerfStats) => {
      const { canvas, texts } = recordingCanvas();
      new PerfOverlay({ visible: true, layout: "compact" }).draw(canvas, stats);
      return [texts[0].value, texts[0].fillStyle];
    };
    expect(fpsColor(new PerfStats())).toEqual(["-- fps", COLORS.dim]);
    expect(fpsColor(statsWith(55))).toEqual(["55 fps", COLORS.fpsGood]);
    expect(fpsColor(statsWith(50))).toEqual(["50 fps", COLORS.fpsOk]);
    expect(fpsColor(statsWith(30))).toEqual(["30 fps", COLORS.fpsOk]);
    expect(fpsColor(statsWith(20))).toEqual(["20 fps", COLORS.fpsBad]);
  });

  it("full: every figure in rows, with now / avg / max columns for the timed ones", () => {
    const { canvas, calls, texts } = recordingCanvas(400, 300);
    const stats = new PerfStats();
    stats.record(sample({ frame: 10, update: 1, render: 2, steps: 2, entities: 7 }));
    stats.record(sample({ frame: 20, update: 3, render: 4, steps: 1, entities: 9 }));
    new PerfOverlay({ visible: true }).draw(canvas, stats);

    expect(calls[1]).toEqual(["fillRect", COLORS.background, 8, 8, 192, 212]);
    expect(textValues(texts)).toEqual([
      "-- fps", "20.0 ms",
      "now", "avg", "max",
      "frame", "20.0", "15.0", "20.0",
      "update", "3.0", "2.0", "3.0",
      "render", "4.0", "3.0", "4.0",
      "steps", "1",
      "entities", "9",
    ]);
    // Labels on the left, the columns right-aligned at a fixed spacing.
    expect(findText(texts, "frame")).toMatchObject({ x: 14, y: 43, textAlign: "left" });
    expect(findText(texts, "now")).toMatchObject({ x: 110, y: 29, fillStyle: COLORS.dim });
    expect(findText(texts, "15.0")).toMatchObject({ x: 152, y: 43, textAlign: "right" });
    expect(findText(texts, "3.0")).toMatchObject({ x: 110, y: 91 });
    expect(findText(texts, "update")).toMatchObject({ y: 91 });
    expect(findText(texts, "render")).toMatchObject({ y: 139 });
    expect(findText(texts, "steps")).toMatchObject({ y: 187 });
    expect(findText(texts, "9")).toMatchObject({ x: 194, y: 201, textAlign: "right" });
  });

  it("full: adds a heap row when the browser reports memory", () => {
    const { canvas, calls, texts } = recordingCanvas(400, 300);
    const stats = new PerfStats();
    stats.record(sample({ heapBytes: 12.5 * 1024 * 1024 }));
    new PerfOverlay({ visible: true }).draw(canvas, stats);
    expect(calls[1]).toEqual(["fillRect", COLORS.background, 8, 8, 192, 226]);
    expect(findText(texts, "heap")).toMatchObject({ y: 215 });
    expect(findText(texts, "12.5 MB")).toMatchObject({ x: 194, y: 215, textAlign: "right" });
  });

  it("full: draws one bar per sample, newest at the right, red when over one 60 Hz frame", () => {
    const { canvas, calls } = recordingCanvas(400, 300);
    const stats = new PerfStats();
    for (const frame of [10, 20, 50]) stats.record(sample({ frame, update: 0, render: 0 }));
    new PerfOverlay({ visible: true }).draw(canvas, stats);

    // The frame graph sits under its row: y 56 to 86, x 14 to 194. Bars are 1 px wide.
    const bars = rects(calls).filter((call) => call[4] === 1);
    expect(bars).toEqual([
      ["fillRect", COLORS.frame, 191, 80, 1, 6],
      ["fillRect", COLORS.overBudget, 192, 74, 1, 12],
      ["fillRect", COLORS.overBudget, 193, 56, 1, 30],
    ]);
    // Scaled to the tallest sample (50 ms), so the one-frame line is at 10 of 30 px.
    const graphRects = rects(calls).filter((call) => call[2] === 14 && call[4] === 180);
    expect(graphRects).toContainEqual(["fillRect", COLORS.graphBackground, 14, 56, 180, 30]);
    expect(graphRects).toContainEqual(["fillRect", COLORS.budgetLine, 14, 76, 180, 1]);
    // The update and render graphs got no bars (all zero) but keep their line at half height.
    expect(graphRects).toContainEqual(["fillRect", COLORS.budgetLine, 14, 119, 180, 1]);
    expect(graphRects).toContainEqual(["fillRect", COLORS.budgetLine, 14, 167, 180, 1]);
  });

  it("full: two 60 Hz frames fill a graph when nothing is slower", () => {
    const { canvas, calls } = recordingCanvas(400, 300);
    const stats = new PerfStats();
    stats.record(sample({ frame: 2 * FRAME_BUDGET_MS, update: FRAME_BUDGET_MS / 2, render: 0 }));
    new PerfOverlay({ visible: true }).draw(canvas, stats);
    const bars = rects(calls).filter((call) => call[4] === 1 && call[2] === 193);
    expect(bars).toEqual([
      ["fillRect", COLORS.overBudget, 193, 56, 1, 30],
      ["fillRect", COLORS.update, 193, 126, 1, 8],
    ]);
  });

  it("full: clips a hitch at four 60 Hz frames instead of flattening the graph", () => {
    const { canvas, calls } = recordingCanvas(400, 300);
    const stats = new PerfStats();
    stats.record(sample({ frame: 1000, update: 0, render: 0 }));
    stats.record(sample({ frame: FRAME_BUDGET_MS, update: 0, render: 0 }));
    new PerfOverlay({ visible: true }).draw(canvas, stats);
    const bars = rects(calls).filter((call) => call[4] === 1);
    const oneFrame = Math.ceil((30 * FRAME_BUDGET_MS) / GRAPH_MAX_MS);
    expect(oneFrame).toBeGreaterThan(1); // a quarter of the graph, not a single pixel
    expect(bars).toEqual([
      ["fillRect", COLORS.overBudget, 192, 56, 1, 30],
      ["fillRect", COLORS.frame, 193, 86 - oneFrame, 1, oneFrame],
    ]);
    expect(GRAPH_MAX_MS).toBe(4 * FRAME_BUDGET_MS);
  });

  it("places the panel in each corner, inside an 8 px margin", () => {
    const origin = (corner: "top-left" | "top-right" | "bottom-left" | "bottom-right") => {
      const { canvas, calls } = recordingCanvas(400, 300);
      new PerfOverlay({ visible: true, layout: "compact", corner }).draw(canvas, new PerfStats());
      return calls[1].slice(2, 4);
    };
    expect(origin("top-left")).toEqual([8, 8]);
    expect(origin("top-right")).toEqual([400 - 128 - 8, 8]);
    expect(origin("bottom-right")).toEqual([400 - 128 - 8, 300 - 26 - 8]);
    expect(origin("bottom-left")).toEqual([8, 300 - 26 - 8]);
  });

  it("leaves the context's state as it found it", () => {
    const { canvas } = recordingCanvas(400, 300);
    const save = vi.spyOn(canvas.ctx, "save");
    const restore = vi.spyOn(canvas.ctx, "restore");
    new PerfOverlay({ visible: true }).draw(canvas, new PerfStats());
    expect(save).toHaveBeenCalledTimes(1);
    expect(restore).toHaveBeenCalledTimes(1);
  });
});
