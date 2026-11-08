import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Animator } from "../../src/engine/animation/animator";
import { Assets } from "../../src/engine/assets/assets";
import { Game, type GameOptions } from "../../src/engine/core/game";
import { FIXED_STEP } from "../../src/engine/core/timestep";
import type { World } from "../../src/engine/ecs/world";
import { Keyboard } from "../../src/engine/input/keyboard";
import type { PerfLogFile } from "../../src/engine/perf/log";
import { PerfStats } from "../../src/engine/perf/stats";
import { Body, Collider, Velocity } from "../../src/engine/physics/components";
import { Contacts } from "../../src/engine/physics/contacts";
import { Gravity } from "../../src/engine/physics/gravity";
import { CollisionLayers } from "../../src/engine/physics/layers";
import { Transform } from "../../src/engine/render/components";
import { physics } from "../../src/engine/physics/physics";
import { FakeChannel } from "../helpers/fake-channel";
import { Canvas } from "../../src/engine/render/canvas";
import { Sprite } from "../../src/engine/render/components";
import { Scenes, type SceneContext } from "../../src/engine/scene/scene";
import { Systems } from "../../src/engine/scene/systems";
import { component } from "../../src/engine/data/registry";
import { findByName, Name } from "../../src/engine/ecs/name";

// Just enough of the browser for Game to run in Node.
class FakeCanvasElement {
  width = 0;
  height = 0;
  /** The values of every fillText call (the overlay is the only thing drawing text here). */
  readonly texts: unknown[] = [];
  private readonly ctx = {
    fillStyle: "",
    font: "",
    textAlign: "start",
    textBaseline: "alphabetic",
    clearRect() {},
    fillRect() {},
    fillText: (value: unknown) => {
      this.texts.push(value);
    },
    save() {},
    restore() {},
  };
  getContext() {
    return this.ctx;
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

/** A key going down on the window the game listens to. Returns the event. */
function pressKey(code: string): Event {
  const event = Object.assign(new Event("keydown", { cancelable: true }), { code });
  window.dispatchEvent(event);
  return event;
}

beforeEach(() => {
  time = 1000;
  nextFrameId = 1;
  pendingFrames.clear();
  vi.stubGlobal("HTMLCanvasElement", FakeCanvasElement);
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("performance", { now: () => time });
  // Node has a real BroadcastChannel; games here must not open one.
  vi.stubGlobal("BroadcastChannel", FakeChannel);
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

describe("Game gravity", () => {
  it("is off unless the gravity option says otherwise", () => {
    expect(makeGame().gravity).toMatchObject({ x: 0, y: 0 });
    const canvas = new FakeCanvasElement() as unknown as HTMLCanvasElement;
    const game = new Game({ canvas, width: 100, height: 100, gravity: { y: 980 } });
    expect(game.gravity).toMatchObject({ x: 0, y: 980 });
  });

  it("is a global resource the physics system reads in every scene", () => {
    const canvas = new FakeCanvasElement() as unknown as HTMLCanvasElement;
    const game = new Game({ canvas, width: 100, height: 100, gravity: { y: 600 } });
    const velocity = new Velocity();
    startWith(game, (scene) => {
      expect(scene.world.getResource(Gravity)).toBe(game.gravity);
      const entity = scene.world.spawn();
      scene.world.add(entity, velocity);
      scene.world.add(entity, new Body());
      scene.addSystem(physics);
    });
    tick(20); // one fixed step
    expect(velocity.y).toBeCloseTo(600 * FIXED_STEP);
    game.gravity.y = 0;
    tick(17);
    expect(velocity.y).toBeCloseTo(600 * FIXED_STEP);
  });
});

describe("Game collisions", () => {
  it("gives every scene the collision layers from the option, all solid without one", () => {
    expect(makeGame().collisionLayers.interaction("a", "b")).toBe("solid");
    const canvas = new FakeCanvasElement() as unknown as HTMLCanvasElement;
    const game = new Game({
      canvas,
      width: 100,
      height: 100,
      collisionLayers: { player: { touch: ["coin"] } },
    });
    expect(game.collisionLayers.interaction("coin", "player")).toBe("touch");
    startWith(game, (scene) => {
      expect(scene.world.getResource(CollisionLayers)).toBe(game.collisionLayers);
      expect(scene.world.getResource(Contacts)).toBe(game.contacts);
    });
  });

  it("runs a Collider added in the editor, on the default layer, under layer rules", () => {
    const errors: unknown[] = [];
    const canvas = new FakeCanvasElement() as unknown as HTMLCanvasElement;
    const game = new Game({
      canvas,
      width: 100,
      height: 100,
      collisionLayers: { player: { solid: ["world"] } },
      onError: (error) => errors.push(error),
    });
    const velocity = new Velocity(0, 60);
    game.addScene(
      "main",
      {
        setup: (scene) => {
          scene.addSystem(physics);
          // The editor's "+ Add component" gives a Collider its defaults: layer "default".
          const fresh = scene.world.spawn();
          scene.world.add(fresh, new Transform(45, 79.5));
          scene.world.add(fresh, new Collider(10, 10));
          scene.world.add(fresh, velocity);
          scene.world.add(fresh, new Body());
        },
      },
      {
        version: 1,
        entities: [
          {
            name: "Floor",
            components: { Transform: { x: 0, y: 90 }, Collider: { width: 100, height: 10, layer: "world" } },
          },
        ],
      },
    );
    game.start("main");
    tick(20);
    expect(errors).toEqual([]);
    expect(velocity.y).toBe(0); // Landed on the floor: solid, as anything on "default" is.
  });

  it("rejects scene data whose Collider is on a layer the rules never name, before starting", () => {
    const canvas = new FakeCanvasElement() as unknown as HTMLCanvasElement;
    const game = new Game({
      canvas,
      width: 100,
      height: 100,
      collisionLayers: { player: { solid: ["world"] } },
    });
    game.addScene("main", { setup() {} }, {
      version: 1,
      entities: [{ name: "Wall", components: { Transform: {}, Collider: { layer: "wrold" } } }],
    });
    expect(() => game.start("main")).toThrow(
      'Scene "main": Entity 0 ("Wall"): Collider.layer must be one of default, player, world',
    );
  });

  it("fills the Contacts resource each step, and clears it when a scene starts", () => {
    const game = makeGame();
    let player = 0;
    let coin = 0;
    const touches: boolean[] = [];
    game.addScene("next", { setup: () => touches.push(game.contacts.all().length > 0) });
    startWith(game, (scene) => {
      const { world } = scene;
      const velocity = new Velocity(0, 0);
      player = world.spawn();
      world.add(player, new Transform(0, 0));
      world.add(player, new Collider(10, 10));
      world.add(player, velocity);
      world.add(player, new Body());
      coin = world.spawn();
      world.add(coin, new Transform(5, 0));
      world.add(coin, new Collider(10, 10));
      // Keeps walking into the coin, like input would, after being pushed out of it.
      scene.addSystem(() => {
        velocity.x = 100;
      });
      scene.addSystem(physics);
      scene.addSystem(() => touches.push(game.contacts.between(player, coin)));
    });
    tick(20); // one fixed step
    expect(touches).toEqual([true]);
    game.world.getResource(Scenes).switchTo("next");
    tick(17);
    expect(touches).toEqual([true, true, false]);
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

/** A game that knows Spin. */
function makeDataGame() {
  const canvas = new FakeCanvasElement() as unknown as HTMLCanvasElement;
  const game = new Game({
    canvas,
    width: 100,
    height: 100,
    components: [component(Spin, "Spin", { speed: "number" })],
  });
  return { game };
}

describe("System lifecycle", () => {
  it("runs onEnable once the scene is set up, and onDisable when the scene is left", () => {
    const game = makeGame();
    const log: string[] = [];
    const hooks = (name: string) => ({
      name,
      run: () => log.push(`${name} runs`),
      onEnable: (world: World) => log.push(`${name} on (${world.entityCount} entities)`),
      onDisable: (world: World) => log.push(`${name} off (${world.entityCount} entities)`),
    });
    game.addScene("main", {
      setup(scene) {
        scene.addSystem(hooks("a"));
        scene.addSystem(hooks("b"));
        scene.addSystem((world) => {
          if (world.getResource(Scenes).current === "main") world.getResource(Scenes).switchTo("other");
        });
        scene.world.spawn();
        log.push("main set up");
      },
    });
    game.addScene("other", { setup: (scene) => scene.addSystem(hooks("c")) });
    game.start("main");
    expect(log).toEqual(["main set up", "a on (1 entities)", "b on (1 entities)"]);
    log.length = 0;
    tick(20);
    // One step of main: its systems ran, then the switch; the old world's count shows in onDisable.
    expect(log).toEqual(["a runs", "b runs", "b off (1 entities)", "a off (1 entities)", "c on (0 entities)"]);
    log.length = 0;
    game.stop();
    expect(log).toEqual(["c off (0 entities)"]);
    game.stop(); // again: nothing more
    expect(log).toEqual(["c off (0 entities)"]);
  });

  it("lets scripts switch systems off and on through the Systems resource, at once", () => {
    const game = makeGame();
    const log: string[] = [];
    startWith(game, (scene) => {
      scene.addSystem({
        name: "gate",
        run: (world) => {
          log.push("gate");
          world.getResource(Systems).disable("late");
        },
      });
      scene.addSystem({
        name: "late",
        run: () => log.push("late"),
        onEnable: () => log.push("late on"),
        onDisable: () => log.push("late off"),
      });
      scene.addSystem(function named() {
        log.push("named");
      });
    });
    expect(log).toEqual(["late on"]);
    const systems = game.world.getResource(Systems);
    expect(systems.names).toEqual(["render", "gate", "late", "named"]);
    expect(systems.isEnabled("late")).toBe(true);
    log.length = 0;
    tick(20);
    // Disabled earlier in the same step: "late" sits it out, and its onDisable ran right away.
    expect(log).toEqual(["gate", "late off", "named"]);
    expect(systems.isEnabled("late")).toBe(false);
    systems.disable("late"); // already off: nothing happens
    log.length = 0;
    systems.enable("late");
    expect(log).toEqual(["late on"]);
    expect(() => systems.enable("nope")).toThrow('No system "nope" in this scene (the systems are render, gate, late, named)');
  });

  it("keeps a system that starts switched off waiting, onEnable and all, until it is enabled", () => {
    const game = makeGame();
    const log: string[] = [];
    startWith(game, (scene) => {
      scene.addSystem({
        name: "boss",
        startsEnabled: false,
        run: () => log.push("boss"),
        onEnable: () => log.push("boss on"),
        onDisable: () => log.push("boss off"),
      });
    });
    tick(20);
    expect(log).toEqual([]);
    expect(game.world.getResource(Systems).isEnabled("boss")).toBe(false);
    game.world.getResource(Systems).enable("boss");
    tick(20);
    expect(log).toEqual(["boss on", "boss"]);
    game.stop();
    expect(log).toEqual(["boss on", "boss", "boss off"]);
  });

  it("a throwing onEnable fails the start like a broken scene; a throwing onDisable on a failure is only logged", () => {
    const errors: unknown[] = [];
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const canvas = new FakeCanvasElement() as unknown as HTMLCanvasElement;
    const game = new Game({ canvas, width: 100, height: 100, onError: (error) => errors.push(error) });
    game.addScene("main", {
      setup(scene) {
        scene.addSystem({ run: () => {}, onEnable: () => { throw new Error("no room"); } });
      },
    });
    expect(() => game.start("main")).toThrow("no room");

    const other = new Game({ canvas, width: 100, height: 100, onError: (error) => errors.push(error) });
    startWith(other, (scene) => {
      scene.addSystem({ run: () => { throw new Error("boom"); }, onDisable: () => { throw new Error("and again"); } });
    });
    tick(20);
    expect(errors.map((e) => (e as Error).message)).toEqual(["boom"]);
    expect(logged.mock.calls.map((call) => (call[0] as Error).message)).toEqual(["and again"]);
    logged.mockRestore();
  });
});

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

  it("start throws, naming the scene, when its data is broken", () => {
    const { game } = makeDataGame();
    game.addScene("main", { setup() {} }, { version: 1, entities: [{ name: 5 }] });
    expect(() => game.start("main")).toThrow(
      'Scene "main": Entity 0 must have a "name" string and a "components" object',
    );
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

  it("data using a component the game does not have is reported", () => {
    const { game } = makeDataGame();
    game.addScene("main", { setup() {} }, {
      version: 1,
      entities: [{ name: "Old", components: { Gone: {} } }],
    });
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

  it("spawns the data afresh each time the scene is entered", () => {
    const { game } = makeDataGame();
    let switched = false;
    game.addScene(
      "main",
      {
        setup: (scene) =>
          scene.addSystem((world) => {
            if (switched) return;
            switched = true;
            const hero = findByName(world, "Hero")!;
            world.get(hero, Spin)!.speed = 99;
            world.getResource(Scenes).switchTo("main");
          }),
      },
      heroData,
    );
    game.start("main");
    expect(game.world.get(findByName(game.world, "Hero")!, Spin)?.speed).toBe(2);
    tick(20);
    expect(game.world.get(findByName(game.world, "Hero")!, Spin)?.speed).toBe(2);
  });
});

describe("Performance stats", () => {
  it("records each frame's timings in the PerfStats resource", () => {
    const game = makeGame();
    startWith(game, (scene) => {
      scene.world.spawn();
      scene.world.spawn();
      scene.addSystem(() => {
        time += 3; // 3 ms of update work
      });
      scene.addRenderSystem(() => {
        time += 2; // 2 ms of render work
      });
    });
    expect(game.perf.frames).toBe(0);
    tick(20);
    expect(game.world.getResource(PerfStats)).toBe(game.perf);
    expect(game.perf.frames).toBe(1);
    expect(game.perf.frameTime.last).toBe(20);
    expect(game.perf.updateTime.last).toBe(3);
    expect(game.perf.renderTime.last).toBe(2);
    expect(game.perf.steps).toBe(1);
    expect(game.perf.entities).toBe(2);
    expect(game.perf.heapBytes).toBeNull();
  });

  it("notes the keys pressed during each frame, once per press", () => {
    const files: PerfLogFile[] = [];
    const canvas = new FakeCanvasElement() as unknown as HTMLCanvasElement;
    const game = new Game({
      canvas,
      width: 100,
      height: 100,
      perfOverlay: { visible: true, log: { save: (file) => files.push(file) } },
    });
    startWith(game, () => {});
    pressKey("KeyA");
    pressKey("KeyA"); // still held: auto-repeat
    pressKey("Space");
    tick(20);
    pressKey("Enter");
    tick(20);
    game.stop();
    const rows = files[0].contents.split("\n").slice(1, 3);
    expect(rows.map((row) => row.split(",").at(-1))).toEqual(["KeyA Space", "Enter"]);
  });

  it("counts the steps of a long frame and sees entities spawned by systems", () => {
    const game = makeGame();
    startWith(game, (scene) => scene.addSystem((world) => world.spawn()));
    tick(40);
    expect(game.perf.steps).toBe(2);
    expect(game.perf.entities).toBe(2);
  });

  it("starts over when the game is started again", () => {
    const game = makeGame();
    startWith(game, () => {});
    tick(20);
    tick(20);
    game.stop();
    expect(game.perf.frames).toBe(2);
    game.start("main");
    expect(game.perf.frames).toBe(0);
    expect(game.perf.frameTime.length).toBe(0);
  });
});

describe("Performance overlay", () => {
  function makeGameWithCanvas(perfOverlay?: GameOptions["perfOverlay"]) {
    const canvas = new FakeCanvasElement();
    const game = new Game({
      canvas: canvas as unknown as HTMLCanvasElement,
      width: 400,
      height: 300,
      perfOverlay,
    });
    return { game, canvas };
  }

  it("is there by default, hidden, and draws nothing until toggled", () => {
    const { game, canvas } = makeGameWithCanvas();
    expect(game.perfOverlay?.visible).toBe(false);
    startWith(game, () => {});
    tick(20);
    expect(canvas.texts).toEqual([]);
  });

  it("F3 shows it, drawn after the render systems; F3 again hides it", () => {
    const { game, canvas } = makeGameWithCanvas({ log: false });
    const log: string[] = [];
    const fillText = canvas.getContext().fillText;
    canvas.getContext().fillText = (value: unknown) => {
      if (log.at(-1) !== "overlay") log.push("overlay");
      fillText(value);
    };
    startWith(game, (scene) => scene.addRenderSystem(() => log.push("render")));
    const event = pressKey("F3");
    expect(event.defaultPrevented).toBe(true);
    expect(game.perfOverlay?.visible).toBe(true);

    tick(20);
    expect(canvas.texts).toContain("-- fps");
    expect(canvas.texts).toContain("frame");
    // Drawn after the scene's render systems, so it sits on top of the game.
    expect(log).toEqual(["render", "overlay"]);

    pressKey("F3");
    canvas.texts.length = 0;
    tick(20);
    expect(canvas.texts).toEqual([]);
  });

  it("its own drawing does not count as render time", () => {
    const { game, canvas } = makeGameWithCanvas({ visible: true });
    const fillText = canvas.getContext().fillText;
    canvas.getContext().fillText = (value: unknown) => {
      time += 5; // drawing text is slow on this fake canvas
      fillText(value);
    };
    startWith(game, (scene) =>
      scene.addRenderSystem(() => {
        time += 2;
      }),
    );
    tick(20);
    expect(game.perf.renderTime.last).toBe(2);
    expect(canvas.texts.length).toBeGreaterThan(0);
  });

  it("logs every frame to a file while shown, saved once hidden", () => {
    const files: PerfLogFile[] = [];
    const { game } = makeGameWithCanvas({ log: { save: (file) => files.push(file) } });
    startWith(game, (scene) => {
      scene.world.spawn();
      scene.addSystem(() => {
        time += 2;
      });
      scene.addRenderSystem(() => {
        time += 1;
      });
    });
    tick(20); // not shown: not logged
    pressKey("F3");
    tick(20);
    tick(20);
    expect(game.perfOverlay?.log?.length).toBe(2);
    expect(files).toHaveLength(0);

    pressKey("F3");
    tick(20); // hidden: the log is saved
    expect(files).toHaveLength(1);
    // Each frame's work moves the fake clock 3 ms, so frames are 23 ms apart. The F3 that
    // showed the overlay is a key press like any other, in the first logged frame.
    expect(files[0].contents.split("\n")).toEqual([
      "frame,time_ms,scene,frame_ms,update_ms,render_ms,steps,entities,heap_bytes,fps,inputs",
      "2,1043.000,main,23.000,2.000,1.000,1,1,,0,F3",
      "3,1066.000,main,23.000,2.000,1.000,1,1,,0,",
      "",
    ]);
  });

  it("saves the log in progress when the game stops (e.g. on an error)", () => {
    const files: PerfLogFile[] = [];
    const errors: unknown[] = [];
    const canvas = new FakeCanvasElement() as unknown as HTMLCanvasElement;
    const game = new Game({
      canvas,
      width: 100,
      height: 100,
      perfOverlay: { visible: true, log: { save: (file) => files.push(file) } },
      onError: (error) => errors.push(error),
    });
    let frames = 0;
    startWith(game, (scene) =>
      scene.addSystem(() => {
        if (++frames === 3) throw new Error("boom");
      }),
    );
    tick(20);
    tick(20);
    expect(files).toHaveLength(0);
    tick(20);
    expect(errors).toHaveLength(1);
    expect(files).toHaveLength(1);
    expect(files[0].contents.split("\n")).toHaveLength(4); // header + 2 frames + trailing newline
    // Still shown: a restart logs into a new file.
    game.start("main");
    tick(20);
    game.stop();
    expect(files).toHaveLength(2);
  });

  it("takes its options from the game options", () => {
    const { game } = makeGameWithCanvas({ visible: true, layout: "compact", toggleKey: "KeyP" });
    expect(game.perfOverlay?.layout).toBe("compact");
    startWith(game, () => {});
    pressKey("F3");
    expect(game.perfOverlay?.visible).toBe(true);
    pressKey("KeyP");
    expect(game.perfOverlay?.visible).toBe(false);
  });

  it("perfOverlay: false leaves it out, so F3 is just another key", () => {
    const { game, canvas } = makeGameWithCanvas(false);
    expect(game.perfOverlay).toBeNull();
    startWith(game, () => {});
    const event = pressKey("F3");
    expect(event.defaultPrevented).toBe(false);
    tick(20);
    expect(canvas.texts).toEqual([]);
    // The stats are still collected.
    expect(game.perf.frames).toBe(1);
  });

  it("only listens for its hotkeys while the game runs, and keeps its state in between", () => {
    const { game } = makeGameWithCanvas();
    pressKey("F3");
    expect(game.perfOverlay?.visible).toBe(false);
    startWith(game, () => {});
    pressKey("F3");
    expect(game.perfOverlay?.visible).toBe(true);
    game.stop();
    pressKey("F3");
    expect(game.perfOverlay?.visible).toBe(true);
    game.start("main");
    pressKey("F3");
    expect(game.perfOverlay?.visible).toBe(false);
  });

  it("the game's Keyboard still sees the hotkey", () => {
    const { game } = makeGameWithCanvas();
    const seen: boolean[] = [];
    startWith(game, (scene) =>
      scene.addSystem((world) => seen.push(world.getResource(Keyboard).wasPressed("F3"))),
    );
    pressKey("F3");
    tick(20);
    expect(seen).toEqual([true]);
  });
});

describe("Performance broadcast", () => {
  it("announces the game, sends frames to a subscribed viewer, and says bye on stop", () => {
    const channel = new FakeChannel();
    const canvas = new FakeCanvasElement() as unknown as HTMLCanvasElement;
    const game = new Game({ canvas, width: 100, height: 100, perfBroadcast: channel });
    startWith(game, () => {});
    expect(channel.types()).toEqual(["hello"]);
    tick(20);
    expect(channel.types()).toEqual(["hello"]); // nobody listening

    channel.deliver({ type: "subscribe" });
    tick(20);
    const frame = channel.posted.at(-1);
    expect(frame).toMatchObject({ type: "frame", frame: 2, fps: 0 });
    expect(frame?.type === "frame" && frame.sample).toMatchObject({
      scene: "main",
      frame: 20,
      steps: 1,
      entities: 0,
    });
    game.stop();
    expect(channel.types().at(-1)).toBe("bye");
  });

  it("uses a BroadcastChannel by default, and none with perfBroadcast: false", () => {
    const opened: unknown[] = [];
    vi.stubGlobal(
      "BroadcastChannel",
      class extends FakeChannel {
        constructor(name: string) {
          super();
          opened.push(name);
        }
      },
    );
    makeGame();
    expect(opened).toEqual(["browser-engine:perf"]);
    const canvas = new FakeCanvasElement() as unknown as HTMLCanvasElement;
    new Game({ canvas, width: 100, height: 100, perfBroadcast: false });
    expect(opened).toHaveLength(1);
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
