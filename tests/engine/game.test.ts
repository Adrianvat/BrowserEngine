import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Game } from "../../src/engine/core/game";
import { FIXED_STEP } from "../../src/engine/core/timestep";
import { Keyboard } from "../../src/engine/input/keyboard";

// Just enough of the browser for Game to run in Node.
class FakeCanvasElement {
  width = 0;
  height = 0;
  getContext() {
    return { fillStyle: "", clearRect() {}, fillRect() {} };
  }
}

let time = 0;
let nextFrameId = 1;
const pendingFrames = new Map<number, FrameRequestCallback>();

/** Advances the fake clock and runs every frame callback that was scheduled. */
function tick(ms: number): void {
  time += ms;
  const due = [...pendingFrames.values()];
  pendingFrames.clear();
  for (const callback of due) callback(time);
}

function makeGame(): Game {
  const canvas = new FakeCanvasElement() as unknown as HTMLCanvasElement;
  return new Game({ canvas, width: 100, height: 100 });
}

beforeEach(() => {
  time = 1000;
  nextFrameId = 1;
  pendingFrames.clear();
  vi.stubGlobal("HTMLCanvasElement", FakeCanvasElement);
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("performance", { now: () => time });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    const id = nextFrameId++;
    pendingFrames.set(id, callback);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    pendingFrames.delete(id);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Game loop", () => {
  it("runs update systems with the fixed step and render systems once per frame", () => {
    const game = makeGame();
    const updateDts: number[] = [];
    let renders = 0;
    game.addSystem((_world, dt) => updateDts.push(dt));
    game.addRenderSystem(() => renders++);
    game.start();
    tick(20);
    expect(updateDts).toEqual([FIXED_STEP]);
    expect(renders).toBe(1);
  });

  it("render systems never get a negative dt (first frame stamped before start)", () => {
    const game = makeGame();
    const renderDts: number[] = [];
    game.addRenderSystem((_world, dt) => renderDts.push(dt));
    game.start();
    tick(-5);
    expect(renderDts).toEqual([0]);
  });

  it("stop() from inside a system ends the loop after the current frame", () => {
    const game = makeGame();
    game.addSystem(() => game.stop());
    game.start();
    tick(20);
    expect(pendingFrames.size).toBe(0);
  });

  it("restarting from inside a system leaves exactly one loop running", () => {
    const game = makeGame();
    let restarted = false;
    let renders = 0;
    game.addSystem(() => {
      if (restarted) return;
      restarted = true;
      game.stop();
      game.start();
    });
    game.addRenderSystem(() => renders++);
    game.start();
    tick(20);
    expect(pendingFrames.size).toBe(1);

    renders = 0;
    tick(16);
    tick(16);
    expect(renders).toBe(2);

    game.stop();
    expect(pendingFrames.size).toBe(0);
  });

  it("wasPressed survives a frame with zero update steps", () => {
    const game = makeGame();
    const seen: boolean[] = [];
    game.addSystem((world) => seen.push(world.getResource(Keyboard).wasPressed("Space")));
    game.start();
    window.dispatchEvent(Object.assign(new Event("keydown"), { code: "Space" }));
    tick(5); // less than one step: no update runs
    expect(seen).toEqual([]);
    tick(20);
    tick(20);
    expect(seen).toEqual([true, false]);
  });
});
