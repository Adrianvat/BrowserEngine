import { describe, expect, it } from "vitest";
import { PERF_CHANNEL, PerfBroadcast, SUBSCRIBE_TIMEOUT } from "../../src/engine/perf/broadcast";
import type { FrameSample } from "../../src/engine/perf/stats";
import { FakeChannel } from "../helpers/fake-channel";

const sample: FrameSample = {
  time: 1000,
  scene: "play",
  frame: 16,
  update: 1,
  render: 2,
  steps: 1,
  entities: 5,
  heapBytes: null,
  inputs: [],
};

function setup() {
  let time = 0;
  const channel = new FakeChannel();
  const broadcast = new PerfBroadcast(channel, () => time);
  return { channel, broadcast, advance: (ms: number) => (time += ms) };
}

describe("PerfBroadcast", () => {
  it("meets viewers on a fixed channel name", () => {
    expect(PERF_CHANNEL).toBe("browser-engine:perf");
  });

  it("says hello when the game starts and bye when it stops, once each", () => {
    const { channel, broadcast } = setup();
    broadcast.start();
    broadcast.stop();
    broadcast.stop();
    expect(channel.types()).toEqual(["hello", "bye"]);
  });

  it("sends no frames until a viewer subscribes", () => {
    const { channel, broadcast } = setup();
    broadcast.start();
    broadcast.frame(sample, { frames: 1, fps: 60 });
    expect(broadcast.listening).toBe(false);
    expect(channel.types()).toEqual(["hello"]);

    channel.deliver({ type: "subscribe" });
    broadcast.frame(sample, { frames: 2, fps: 60 });
    expect(broadcast.listening).toBe(true);
    expect(channel.posted.at(-1)).toEqual({ type: "frame", frame: 2, fps: 60, sample });
  });

  it("answers a subscribe with hello while running, so a late viewer knows", () => {
    const { channel, broadcast } = setup();
    channel.deliver({ type: "subscribe" });
    expect(channel.types()).toEqual([]); // not started: nothing to announce
    broadcast.start();
    channel.deliver({ type: "subscribe" });
    expect(channel.types()).toEqual(["hello", "hello"]);
  });

  it("stops sending once the viewer has been quiet for the timeout", () => {
    const { channel, broadcast, advance } = setup();
    broadcast.start();
    channel.deliver({ type: "subscribe" });
    advance(SUBSCRIBE_TIMEOUT - 1);
    broadcast.frame(sample, { frames: 1, fps: 60 });
    expect(channel.types().filter((type) => type === "frame")).toHaveLength(1);
    advance(1);
    broadcast.frame(sample, { frames: 2, fps: 60 });
    expect(channel.types().filter((type) => type === "frame")).toHaveLength(1);
    expect(broadcast.listening).toBe(false);
    // Another subscribe picks it up again.
    channel.deliver({ type: "subscribe" });
    broadcast.frame(sample, { frames: 3, fps: 60 });
    expect(channel.types().filter((type) => type === "frame")).toHaveLength(2);
  });

  it("sends no frames after stop, even with a viewer listening", () => {
    const { channel, broadcast } = setup();
    broadcast.start();
    channel.deliver({ type: "subscribe" });
    broadcast.stop();
    broadcast.frame(sample, { frames: 1, fps: 60 });
    expect(channel.types()).toEqual(["hello", "hello", "bye"]);
  });

  it("ignores messages that are not a subscribe", () => {
    const { channel, broadcast } = setup();
    broadcast.start();
    channel.deliver(null);
    channel.deliver("subscribe");
    channel.deliver({ type: "frame" });
    channel.deliver({ type: "hello" });
    expect(broadcast.listening).toBe(false);
    expect(channel.types()).toEqual(["hello"]);
  });

  it("close says bye and releases the channel", () => {
    const { channel, broadcast } = setup();
    broadcast.start();
    broadcast.close();
    expect(channel.types()).toEqual(["hello", "bye"]);
    expect(channel.closed).toBe(true);
    expect(channel.onmessage).toBeNull();
  });
});
