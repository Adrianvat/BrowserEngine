import { describe, it, expect } from "vitest";
import { Animator, Assets, Keyboard, Sprite, Transform, World } from "../../src/engine";
import { Player, Velocity } from "../../src/game/components";
import {
  clampPlayer,
  movement,
  playerAppearance,
  playerInput,
  PLAYER_SPEED,
} from "../../src/game/systems";
import { recordingCanvas } from "../helpers/recording-canvas";

describe("movement", () => {
  it("moves Transform by Velocity * dt", () => {
    const world = new World();
    const e = world.spawn();
    world.add(e, new Transform(0, 0));
    world.add(e, new Velocity(10, -20));
    movement(world, 0.5);
    const t = world.get(e, Transform)!;
    expect(t.x).toBe(5);
    expect(t.y).toBe(-10);
  });
});

describe("playerInput", () => {
  function setup() {
    const world = new World();
    const keyboard = new Keyboard();
    world.setResource(keyboard);
    const player = world.spawn();
    world.add(player, new Player());
    world.add(player, new Velocity());
    const other = world.spawn();
    world.add(other, new Velocity(1, 1));
    return { world, keyboard, player, other };
  }

  it("sets player velocity from arrow keys and WASD", () => {
    const { world, keyboard, player } = setup();
    keyboard.handleKeyDown("ArrowRight");
    keyboard.handleKeyDown("KeyW");
    playerInput(world);
    const v = world.get(player, Velocity)!;
    expect(v.x).toBe(PLAYER_SPEED);
    expect(v.y).toBe(-PLAYER_SPEED);
  });

  it("stops the player when no keys are held, and leaves non-players alone", () => {
    const { world, player, other } = setup();
    world.get(player, Velocity)!.x = 123;
    playerInput(world);
    expect(world.get(player, Velocity)).toEqual(new Velocity(0, 0));
    expect(world.get(other, Velocity)).toEqual(new Velocity(1, 1));
  });
});

describe("playerAppearance", () => {
  function setup() {
    const world = new World();
    const player = world.spawn();
    const velocity = new Velocity();
    const sprite = new Sprite("hero");
    const animator = new Animator("idle");
    world.add(player, new Player());
    world.add(player, velocity);
    world.add(player, sprite);
    world.add(player, animator);
    return { world, velocity, sprite, animator };
  }

  it("plays walk while moving and idle when still", () => {
    const { world, velocity, animator } = setup();
    velocity.y = 10;
    playerAppearance(world);
    expect(animator.clip).toBe("walk");
    velocity.y = 0;
    playerAppearance(world);
    expect(animator.clip).toBe("idle");
  });

  it("keeps the walk going while the player keeps moving", () => {
    const { world, velocity, animator } = setup();
    velocity.x = 10;
    playerAppearance(world);
    animator.time = 0.3;
    playerAppearance(world);
    expect(animator.time).toBe(0.3);
  });

  it("faces the way it moves horizontally and keeps facing otherwise", () => {
    const { world, velocity, sprite } = setup();
    velocity.x = -10;
    playerAppearance(world);
    expect(sprite.flipX).toBe(true);

    velocity.x = 0;
    playerAppearance(world);
    expect(sprite.flipX).toBe(true);

    velocity.y = 10;
    playerAppearance(world);
    expect(sprite.flipX).toBe(true);

    velocity.x = 10;
    playerAppearance(world);
    expect(sprite.flipX).toBe(false);
  });
});

describe("clampPlayer", () => {
  async function setup(sprite: Sprite, x: number, y: number) {
    const world = new World();
    world.setResource(recordingCanvas(100, 100).canvas);
    const assets = new Assets(async () => ({ width: 32, height: 16 }) as HTMLImageElement);
    await assets.loadImages({ hero: { url: "/hero.svg", frameWidth: 16, frameHeight: 16 } });
    world.setResource(assets);
    const player = world.spawn();
    const transform = new Transform(x, y);
    world.add(player, new Player());
    world.add(player, transform);
    world.add(player, sprite);
    return { world, transform };
  }

  it("keeps the player inside the canvas using the sprite's explicit size", async () => {
    const { world, transform } = await setup(new Sprite("hero", { width: 32, height: 32 }), 90, -5);
    clampPlayer(world);
    expect([transform.x, transform.y]).toEqual([68, 0]);
  });

  it("uses the frame's own size when the sprite has no explicit size", async () => {
    const { world, transform } = await setup(new Sprite("hero"), 95, 95);
    clampPlayer(world);
    expect([transform.x, transform.y]).toEqual([84, 84]);
  });
});
