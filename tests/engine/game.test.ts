import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Animator } from "../../src/engine/animation/animator";
import { Assets } from "../../src/engine/assets/assets";
import { Game } from "../../src/engine/core/game";
import { FIXED_STEP } from "../../src/engine/core/timestep";
import type { World } from "../../src/engine/ecs/world";
import { Keyboard } from "../../src/engine/input/keyboard";
import { Canvas } from "../../src/engine/render/canvas";
import { Sprite } from "../../src/engine/render/components";
import { Scenes, type SceneContext } from "../../src/engine/scene/scene";
import { component } from "../../src/engine/data/registry";
import { SceneStore } from "../../src/engine/data/scene-store";
import { findByName, Name } from "../../src/engine/ecs/name";
import { MemoryStorage } from "../helpers/memory-storage";

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

/** Adds a scene with this setup under `name` and starts the game with it. */
function startWith(game: Game, setup: (scene: SceneContext) => void, name = "main"): void {
  game.addScene(name, { setup });
  game.start(name);
}

/** A key going down on the window the game listens to. */
function pressKey(code: string): void {
  window.dispatchEvent(Object.assign(new Event("keydown"), { code }));
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
  it("runs scene systems with the fixed step and render systems once per frame", () => {
    const game = makeGame();
    const updateDts: number[] = [];
    let renders = 0;
    startWith(game, (scene) => {
      scene.addSystem((_world, dt) => updateDts.push(dt));
      scene.addRenderSystem(() => renders++);
    });
    tick(20);
    expect(updateDts).toEqual([FIXED_STEP]);
    expect(renders).toBe(1);
  });

  it("render systems never get a negative dt (first frame stamped before start)", () => {
    const game = makeGame();
    const renderDts: number[] = [];
    startWith(game, (scene) => scene.addRenderSystem((_world, dt) => renderDts.push(dt)));
    tick(-5);
    expect(renderDts).toEqual([0]);
  });

  it("stop() from inside a system ends the loop after the current frame", () => {
    const game = makeGame();
    startWith(game, (scene) => scene.addSystem(() => game.stop()));
    tick(20);
    expect(pendingFrames.size).toBe(0);
  });

  it("restarting from inside a system leaves exactly one loop running", () => {
    const game = makeGame();
    let restarted = false;
    let renders = 0;
    startWith(game, (scene) => {
      scene.addSystem(() => {
        if (restarted) return;
        restarted = true;
        game.stop();
        game.start("main");
      });
      scene.addRenderSystem(() => renders++);
    });
    tick(20);
    expect(pendingFrames.size).toBe(1);

    renders = 0;
    tick(16);
    tick(16);
    expect(renders).toBe(2);

    game.stop();
    expect(pendingFrames.size).toBe(0);
  });

  it("restarting with another scene from a system stops the old scene's step there", () => {
    const game = makeGame();
    const log: string[] = [];
    game.addScene("b", { setup: () => log.push("b setup") });
    startWith(game, (scene) => {
      scene.addSystem(() => {
        game.stop();
        game.start("b");
      });
      scene.addSystem((world) => {
        log.push("old system");
        world.getResource(Scenes).switchTo("main");
      });
    });
    tick(20);
    expect(log).toEqual(["b setup"]);
    expect(game.world.getResource(Scenes).current).toBe("b");
  });

  it("wasPressed survives a frame with zero update steps", () => {
    const game = makeGame();
    const seen: boolean[] = [];
    startWith(game, (scene) =>
      scene.addSystem((world) => seen.push(world.getResource(Keyboard).wasPressed("Space"))),
    );
    pressKey("Space");
    tick(5); // less than one step: no update runs
    expect(seen).toEqual([]);
    tick(20);
    tick(20);
    expect(seen).toEqual([true, false]);
  });
});

describe("Game setup", () => {
  it("game.world throws before a scene is running", () => {
    expect(() => makeGame().world).toThrow("No scene is running");
  });

  it("puts the built-in global resources in the scene's world", () => {
    const game = makeGame();
    startWith(game, () => {});
    expect(game.world.getResource(Assets)).toBe(game.assets);
    expect(game.world.getResource(Canvas)).toBe(game.canvas);
    expect(game.world.getResource(Keyboard)).toBeInstanceOf(Keyboard);
    expect(game.world.getResource(Scenes).current).toBe("main");
  });

  it("keeps image smoothing on by default", () => {
    expect(makeGame().canvas.ctx.imageSmoothingEnabled).toBe(true);
  });

  it("pixelArt turns image smoothing off", () => {
    const canvas = new FakeCanvasElement() as unknown as HTMLCanvasElement;
    const game = new Game({ canvas, width: 100, height: 100, pixelArt: true });
    expect(game.canvas.ctx.imageSmoothingEnabled).toBe(false);
  });
});

describe("Scenes", () => {
  it("start runs the scene's setup once, with the world the game then exposes", () => {
    const game = makeGame();
    const worlds: World[] = [];
    startWith(game, (scene) => worlds.push(scene.world));
    expect(worlds).toHaveLength(1);
    expect(game.world).toBe(worlds[0]);
  });

  it("rejects a scene name that is already added", () => {
    const game = makeGame();
    game.addScene("main", { setup() {} });
    expect(() => game.addScene("main", { setup() {} })).toThrow(
      'Scene "main" is already added',
    );
  });

  it("start with an unknown scene throws and does not start the loop", () => {
    const game = makeGame();
    expect(() => game.start("nope")).toThrow('Scene "nope" not found');
    expect(pendingFrames.size).toBe(0);
  });

  it("switchTo throws right away for an unknown scene", () => {
    const game = makeGame();
    startWith(game, () => {});
    expect(() => game.world.getResource(Scenes).switchTo("nope")).toThrow(
      'Scene "nope" not found',
    );
  });

  it("global resources are the same object in every scene", () => {
    class Score {
      value = 0;
    }
    const game = makeGame();
    const score = new Score();
    game.addGlobalResource(score);
    const seen: Score[] = [];
    game.addScene("b", { setup: (scene) => seen.push(scene.world.getResource(Score)) });
    startWith(game, (scene) => {
      seen.push(scene.world.getResource(Score));
      scene.addSystem((world) => world.getResource(Scenes).switchTo("b"));
    });
    tick(20);
    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe(score);
    expect(seen[1]).toBe(score);
  });

  it("addGlobalResource while a scene is running adds it to the current world too", () => {
    class Late {}
    const game = makeGame();
    startWith(game, () => {});
    const late = new Late();
    game.addGlobalResource(late);
    expect(game.world.getResource(Late)).toBe(late);
  });

  it("switches at the end of the step, after the rest of the old scene's systems", () => {
    const game = makeGame();
    const log: string[] = [];
    game.addScene("b", { setup: (scene) => scene.addSystem(() => log.push("b")) });
    startWith(game, (scene) => {
      scene.addSystem((world) => {
        log.push("a1");
        world.getResource(Scenes).switchTo("b");
      });
      scene.addSystem(() => log.push("a2"));
    });
    tick(20);
    expect(log).toEqual(["a1", "a2"]);
    expect(game.world.getResource(Scenes).current).toBe("b");
    tick(17);
    expect(log).toEqual(["a1", "a2", "b"]);
  });

  it("runs the steps left in the frame on the new scene", () => {
    const game = makeGame();
    const log: string[] = [];
    game.addScene("b", { setup: (scene) => scene.addSystem(() => log.push("b")) });
    startWith(game, (scene) =>
      scene.addSystem((world) => {
        log.push("a");
        world.getResource(Scenes).switchTo("b");
      }),
    );
    tick(40); // two fixed steps in one frame
    expect(log).toEqual(["a", "b"]);
  });

  it("renders the new scene in the frame that switched", () => {
    const game = makeGame();
    const renders: string[] = [];
    game.addScene("b", { setup: (scene) => scene.addRenderSystem(() => renders.push("b")) });
    startWith(game, (scene) => {
      scene.addSystem((world) => world.getResource(Scenes).switchTo("b"));
      scene.addRenderSystem(() => renders.push("a"));
    });
    tick(20);
    expect(renders).toEqual(["b"]);
  });

  it("the last switch requested in a step wins", () => {
    const game = makeGame();
    const setups: string[] = [];
    game.addScene("b", { setup: () => setups.push("b") });
    game.addScene("c", { setup: () => setups.push("c") });
    startWith(game, (scene) =>
      scene.addSystem((world) => {
        world.getResource(Scenes).switchTo("b");
        world.getResource(Scenes).switchTo("c");
      }),
    );
    tick(20);
    expect(setups).toEqual(["c"]);
    expect(game.world.getResource(Scenes).current).toBe("c");
  });

  it("switching to the running scene restarts it with a fresh world", () => {
    const game = makeGame();
    const worlds: World[] = [];
    let switched = false;
    startWith(game, (scene) => {
      worlds.push(scene.world);
      scene.addSystem((world) => {
        if (switched) return;
        switched = true;
        world.getResource(Scenes).switchTo("main");
      });
    });
    tick(20);
    expect(worlds).toHaveLength(2);
    expect(worlds[1]).not.toBe(worlds[0]);
    expect(game.world).toBe(worlds[1]);
  });

  it("a key pressed on the switching step is not seen by the new scene", () => {
    const game = makeGame();
    const seen: boolean[] = [];
    game.addScene("b", {
      setup: (scene) =>
        scene.addSystem((world) => seen.push(world.getResource(Keyboard).wasPressed("Enter"))),
    });
    startWith(game, (scene) =>
      scene.addSystem((world) => {
        if (world.getResource(Keyboard).wasPressed("Enter")) {
          world.getResource(Scenes).switchTo("b");
        }
      }),
    );
    pressKey("Enter");
    tick(20);
    tick(17);
    expect(seen).toEqual([false]);
  });
});

describe("Game animation", () => {
  it("animates sprites after the scene's own systems in each fixed step", async () => {
    const game = makeGame();
    const assets = new Assets(async () => ({ width: 64, height: 16 }) as HTMLImageElement);
    await assets.loadImages({
      hero: {
        url: "/hero.png",
        frameWidth: 16,
        frameHeight: 16,
        animations: { idle: { frames: [0], fps: 1 }, walk: { frames: [2, 3], fps: 8 } },
      },
    });
    // No Transform, so the renderer (whose fake context cannot draw images) skips it.
    const sprite = new Sprite("hero");
    const animator = new Animator("idle");
    startWith(game, (scene) => {
      // Replaces this world's Assets with one that loads fake images (game.assets keeps the old one).
      scene.world.setResource(assets);
      const entity = scene.world.spawn();
      scene.world.add(entity, sprite);
      scene.world.add(entity, animator);
      scene.addSystem(() => animator.play("walk"));
    });
    tick(20); // one fixed step
    expect(sprite.frame).toBe(2);
  });
});

class Spin {
  speed = 0;
}

const heroData = {
  version: 1,
  entities: [{ name: "Hero", components: { Transform: { x: 5, y: 6 }, Spin: { speed: 2 } } }],
};

/** A game that knows Spin and saves scenes in a fake storage. */
function makeDataGame() {
  const storage = new MemoryStorage();
  const store = new SceneStore(storage);
  const canvas = new FakeCanvasElement() as unknown as HTMLCanvasElement;
  const game = new Game({
    canvas,
    width: 100,
    height: 100,
    components: [component(Spin, "Spin", { speed: "number" })],
    sceneStore: store,
  });
  return { game, store, storage };
}

describe("Scene data", () => {
  it("knows the built-in components and the game's own", () => {
    const { game } = makeDataGame();
    expect(game.registry.get("Transform")).toBeDefined();
    expect(game.registry.get("Spin")?.type).toBe(Spin);
  });

  it("spawns the scene's default data before its setup runs", () => {
    const { game } = makeDataGame();
    let speed: number | undefined;
    game.addScene(
      "main",
      {
        setup: (scene) => {
          const hero = findByName(scene.world, "Hero");
          speed = hero === undefined ? undefined : scene.world.get(hero, Spin)?.speed;
        },
      },
      heroData,
    );
    game.start("main");
    expect(speed).toBe(2);
  });

  it("uses the saved copy instead of the default", () => {
    const { game, store } = makeDataGame();
    store.save("main", { version: 1, entities: [{ name: "Saved", components: {} }] });
    game.addScene("main", { setup() {} }, heroData);
    game.start("main");
    expect(findByName(game.world, "Saved")).toBeDefined();
    expect(findByName(game.world, "Hero")).toBeUndefined();
  });

  it("start throws, naming the scene, when its saved copy is broken", () => {
    const { game, storage } = makeDataGame();
    storage.setItem("browser-engine:scene:main", "{oops");
    game.addScene("main", { setup() {} }, heroData);
    expect(() => game.start("main")).toThrow('Scene "main": Scene data is not valid JSON');
    expect(pendingFrames.size).toBe(0);
  });

  it("start checks every scene's data, not just the first one's", () => {
    const { game } = makeDataGame();
    game.addScene("main", { setup() {} }, heroData);
    game.addScene("other", { setup() {} }, { version: 2, entities: [] });
    expect(() => game.start("main")).toThrow(
      'Scene "other": Unsupported scene data version: 2',
    );
  });

  it("a saved copy using a component the game no longer has is reported", () => {
    const { game, store } = makeDataGame();
    store.save("main", {
      version: 1,
      entities: [{ name: "Old", components: { Gone: {} } }],
    });
    game.addScene("main", { setup() {} });
    expect(() => game.start("main")).toThrow(
      'Scene "main": Entity 0 ("Old"): unknown component "Gone"',
    );
  });

  it("a scene without data starts with no entities", () => {
    const { game } = makeDataGame();
    game.addScene("main", { setup() {} });
    game.start("main");
    expect(game.world.query(Name)).toEqual([]);
  });

  it("reads the saved copy again each time the scene is entered", () => {
    const { game, store } = makeDataGame();
    let switched = false;
    game.addScene(
      "main",
      {
        setup: (scene) =>
          scene.addSystem((world) => {
            if (switched) return;
            switched = true;
            store.save("main", { version: 1, entities: [{ name: "Saved", components: {} }] });
            world.getResource(Scenes).switchTo("main");
          }),
      },
      heroData,
    );
    game.start("main");
    expect(findByName(game.world, "Hero")).toBeDefined();
    tick(20);
    expect(findByName(game.world, "Saved")).toBeDefined();
  });
});

describe("Errors while running", () => {
  it("stops the loop and hands a system's exception to onError", () => {
    const errors: unknown[] = [];
    const canvas = new FakeCanvasElement() as unknown as HTMLCanvasElement;
    const game = new Game({ canvas, width: 100, height: 100, onError: (error) => errors.push(error) });
    startWith(game, (scene) =>
      scene.addSystem(() => {
        throw new Error("boom");
      }),
    );
    tick(20);
    expect(errors).toHaveLength(1);
    expect((errors[0] as Error).message).toBe("boom");
    expect(pendingFrames.size).toBe(0);
    // Stopped, so start works again.
    game.start("main");
    expect(pendingFrames.size).toBe(1);
  });

  it("without onError, a system's exception still propagates", () => {
    const game = makeGame();
    startWith(game, (scene) =>
      scene.addSystem(() => {
        throw new Error("boom");
      }),
    );
    expect(() => tick(20)).toThrow("boom");
  });
});
