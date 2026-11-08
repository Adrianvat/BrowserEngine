import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FILES_CHANGED_EVENT, subscribeFilesChanged, type FilesChange, type HotEvents } from "../../src/dev-api/changes";

/** Stands in for import.meta.hot: records listeners and lets a test send events. */
class FakeHot implements HotEvents {
  readonly listeners = new Map<string, ((data: unknown) => void)[]>();
  on(event: string, listener: (data: unknown) => void): void {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
  }
  send(event: string, data: unknown): void {
    for (const listener of this.listeners.get(event) ?? []) listener(data);
  }
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("subscribeFilesChanged", () => {
  it("passes a burst of changes in the folder to the listener once it is over", () => {
    const hot = new FakeHot();
    const heard: FilesChange[][] = [];
    subscribeFilesChanged(hot, "demo", "images", (changes) => heard.push(changes), 100);
    hot.send(FILES_CHANGED_EVENT, { project: "demo", folder: "images", event: "change", file: "slime.png" });
    hot.send(FILES_CHANGED_EVENT, { project: "demo", folder: "scenes", event: "change", file: "play.json" });
    hot.send(FILES_CHANGED_EVENT, { project: "other", folder: "images", event: "change", file: "coin.png" });
    vi.advanceTimersByTime(50);
    hot.send(FILES_CHANGED_EVENT, { project: "demo", folder: "images", event: "add", file: "slime.json" });
    hot.send(FILES_CHANGED_EVENT, { nonsense: true });
    hot.send("other-event", { project: "demo", folder: "images", event: "add", file: "x.png" });
    vi.advanceTimersByTime(99);
    expect(heard).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(heard).toEqual([
      [
        { project: "demo", folder: "images", event: "change", file: "slime.png" },
        { project: "demo", folder: "images", event: "add", file: "slime.json" },
      ],
    ]);
    hot.send(FILES_CHANGED_EVENT, { project: "demo", folder: "images", event: "unlink", file: "slime.png" });
    vi.advanceTimersByTime(100);
    expect(heard).toHaveLength(2);
    expect(heard[1]).toEqual([{ project: "demo", folder: "images", event: "unlink", file: "slime.png" }]);
  });

  it("hears every project's changes when asked for no project in particular", () => {
    const hot = new FakeHot();
    const heard: FilesChange[][] = [];
    subscribeFilesChanged(hot, null, "settings", (changes) => heard.push(changes), 100);
    hot.send(FILES_CHANGED_EVENT, { project: "demo", folder: "settings", event: "change", file: "" });
    hot.send(FILES_CHANGED_EVENT, { project: "new", folder: "settings", event: "add", file: "" });
    vi.advanceTimersByTime(100);
    expect(heard[0].map((change) => change.project)).toEqual(["demo", "new"]);
  });

  it("does nothing without the dev server", () => {
    expect(() => subscribeFilesChanged(undefined, null, "scenes", () => {})).not.toThrow();
  });
});
