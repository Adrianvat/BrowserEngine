import { describe, expect, it } from "vitest";
import type { FrameSample, PerfMessage } from "../../src/engine";
import { LiveFeed, MAX_ROWS, STALL_TIMEOUT } from "../../src/live-perf/feed";
import { parsePerfLog } from "../../src/perf-viewer/log-file";
import { FakeChannel } from "../helpers/fake-channel";

function sample(overrides: Partial<FrameSample> = {}): FrameSample {
  return {
    time: 1000,
    scene: "play",
    frame: 16.5,
    update: 0.25,
    render: 1,
    steps: 1,
    entities: 5,
    heapBytes: null,
    inputs: [],
    ...overrides,
  };
}

function frame(n: number, overrides: Partial<FrameSample> = {}, fps = 60): PerfMessage {
  return { type: "frame", frame: n, fps, sample: sample({ time: 1000 + n * 16, ...overrides }) };
}

function setup(maxRows = MAX_ROWS) {
  let time = 0;
  const channel = new FakeChannel();
  const feed = new LiveFeed(channel, () => time, maxRows);
  const changes: number[] = [];
  feed.onChange(() => changes.push(feed.length));
  return { channel, feed, changes, advance: (ms: number) => (time += ms) };
}

describe("LiveFeed", () => {
  it("asks the game for frames", () => {
    const { channel, feed } = setup();
    feed.subscribe();
    expect(channel.posted).toEqual([{ type: "subscribe" }]);
  });

  it("is waiting until a game speaks, then follows what it says", () => {
    const { channel, feed, advance } = setup();
    expect(feed.status).toBe("waiting");
    expect(feed.data).toBeNull();

    channel.deliver({ type: "hello" });
    expect(feed.status).toBe("stalled"); // heard, but no frame yet
    // A hello is answered with a subscribe right away, so frames start at once.
    expect(channel.posted).toEqual([{ type: "subscribe" }]);

    channel.deliver(frame(1));
    expect(feed.status).toBe("live");
    expect(feed.scene).toBe("play");
    expect(feed.fps).toBe(60);
    advance(STALL_TIMEOUT - 1);
    expect(feed.status).toBe("live");
    advance(1);
    expect(feed.status).toBe("stalled");

    channel.deliver({ type: "bye" });
    expect(feed.status).toBe("stopped");
    channel.deliver(frame(2));
    expect(feed.status).toBe("live"); // it came back
  });

  it("turns frames into rows and notes scene changes and the heap", () => {
    const { channel, feed, changes } = setup();
    channel.deliver(frame(1, { scene: "title" }));
    channel.deliver(frame(2, { scene: "title" }));
    channel.deliver(frame(3, { scene: "play", heapBytes: 5_000_000 }, 59));
    const data = feed.data;
    expect(data?.rows).toEqual([
      {
        frame: 1, time: 1016, scene: "title", frameMs: 16.5, updateMs: 0.25, renderMs: 1,
        steps: 1, entities: 5, heapBytes: null, fps: 60, inputs: [],
      },
      expect.objectContaining({ frame: 2, time: 1032, scene: "title" }),
      expect.objectContaining({ frame: 3, time: 1048, scene: "play", heapBytes: 5_000_000 }),
    ]);
    expect(data?.start).toBe(1016);
    expect(data?.end).toBe(1048);
    expect(data?.hasHeap).toBe(true);
    expect(data?.sceneChanges).toEqual([
      { time: 1016, scene: "title" },
      { time: 1048, scene: "play" },
    ]);
    expect(changes).toEqual([1, 2, 3]);
  });

  it("ignores malformed messages", () => {
    const { channel, feed, changes } = setup();
    channel.deliver(null);
    channel.deliver("frame");
    channel.deliver({ type: "frame" });
    channel.deliver({ type: "frame", frame: 1, fps: 60, sample: { time: "now" } });
    channel.deliver({ type: "frame", frame: "1", fps: 60, sample: sample() });
    channel.deliver({ type: "frame", frame: 1, fps: 60, sample: { ...sample(), inputs: "KeyA" } });
    channel.deliver({ type: "frame", frame: 1, fps: 60, sample: { ...sample(), inputs: [1] } });
    channel.deliver({ type: "subscribe" }); // a viewer's own kind of message
    expect(feed.length).toBe(0);
    expect(feed.status).toBe("waiting");
    expect(changes).toEqual([]);
  });

  it("clear forgets the frames but not the game", () => {
    const { channel, feed } = setup();
    channel.deliver(frame(1));
    feed.clear();
    expect(feed.length).toBe(0);
    expect(feed.data).toBeNull();
    expect(feed.status).toBe("live");
    channel.deliver(frame(2, { scene: "play" }));
    expect(feed.data?.sceneChanges).toEqual([{ time: 1032, scene: "play" }]);
    expect(feed.data?.hasHeap).toBe(false);
  });

  it("keeps the newest frames once there are more than it holds, with a scene marker at the new start", () => {
    // A small limit: the trimming is the same as with MAX_ROWS, without pushing 250 000
    // frames through (which takes seconds on a slow or busy machine).
    const limit = 30;
    const { channel, feed } = setup(limit);
    const sceneOf = (n: number) => (n < 3 ? "a" : n < 22 ? "b" : "c");
    for (let n = 1; n <= limit; n++) channel.deliver(frame(n, { scene: sceneOf(n) }));
    expect(feed.length).toBe(limit);
    expect(feed.data?.sceneChanges.map((change) => change.scene)).toEqual(["a", "b", "c"]);

    // One more drops the oldest tenth: "b" began before the new start, so it gets a marker there.
    channel.deliver(frame(limit + 1, { scene: "c" }));
    let data = feed.data!;
    expect(feed.length).toBe(limit - limit / 10 + 1);
    expect(data.rows[0].frame).toBe(limit / 10 + 1);
    expect(data.start).toBe(data.rows[0].time);
    expect(data.sceneChanges).toEqual([
      { time: data.start, scene: "b" },
      { time: 1000 + 22 * 16, scene: "c" },
    ]);

    // Six more trims put the start exactly on the frame "c" began with: that change is
    // kept as it is, and no second marker is added for it.
    for (let n = limit + 2; n <= limit + 1 + 6 * (limit / 10); n++) channel.deliver(frame(n, { scene: "c" }));
    data = feed.data!;
    expect(data.rows[0].frame).toBe(22);
    expect(data.sceneChanges).toEqual([{ time: 1000 + 22 * 16, scene: "c" }]);
  });

  it("holds about 70 minutes of frames at 60 fps", () => {
    expect(MAX_ROWS / 60 / 60).toBeCloseTo(69.4, 1);
  });

  it("writes a file the log viewer reads back unchanged", () => {
    const { channel, feed } = setup();
    channel.deliver(frame(1, { scene: "a, b", heapBytes: 1024, inputs: ["KeyA", "Space"] }));
    channel.deliver(frame(2, { scene: "a, b" }, 59));
    const file = feed.toFile();
    expect(file.name).toMatch(/^perf-live-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.csv$/);
    expect(file.contents.split("\n")[1]).toBe(
      '1,1016.000,"a, b",16.500,0.250,1.000,1,5,1024,60,KeyA Space',
    );
    expect(parsePerfLog(file.contents).rows).toEqual(feed.data?.rows);
  });

  it("close releases the channel", () => {
    const { channel, feed } = setup();
    feed.close();
    expect(channel.closed).toBe(true);
    expect(channel.onmessage).toBeNull();
  });
});
