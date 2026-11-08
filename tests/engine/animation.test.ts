import { describe, it, expect } from "vitest";
import { animate } from "../../src/engine/animation/animate";
import { Animator } from "../../src/engine/animation/animator";
import { Assets } from "../../src/engine/assets/assets";
import { FIXED_STEP } from "../../src/engine/core/timestep";
import { World } from "../../src/engine/ecs/world";
import { Sprite } from "../../src/engine/render/components";

/** A world with an 8-frame "hero" sheet and a 4-frame "ghost" sheet. */
async function setup() {
  const world = new World();
  const assets = new Assets(async (url) =>
    (url === "/hero.png" ? { width: 64, height: 32 } : { width: 64, height: 16 }) as HTMLImageElement,
  );
  await assets.loadImages({
    hero: {
      url: "/hero.png",
      frameWidth: 16,
      frameHeight: 16,
      animations: {
        idle: { frames: [0, 1], fps: 2 },
        walk: { frames: [2, 3, 4], fps: 4 },
        attack: { frames: [5, 6, 7], fps: 4, loop: false },
        tenth: { frames: [0, 1, 2, 3, 4, 5, 6, 7], fps: 10 },
      },
    },
    ghost: {
      url: "/ghost.png",
      frameWidth: 16,
      frameHeight: 16,
      animations: { walk: { frames: [3], fps: 1 } },
    },
  });
  world.setResource(assets);

  const sprite = new Sprite("hero");
  const animator = new Animator("walk");
  const entity = world.spawn();
  world.add(entity, sprite);
  world.add(entity, animator);

  /** Runs animate `count` times with the given dt; returns sprite.frame after each. */
  const run = (count: number, dt: number) => {
    const frames: number[] = [];
    for (let i = 0; i < count; i++) {
      animate(world, dt);
      frames.push(sprite.frame);
    }
    return frames;
  };
  return { world, sprite, animator, run };
}

describe("Animator", () => {
  it("starts at the beginning of its clip", () => {
    const animator = new Animator("walk");
    expect([animator.clip, animator.time, animator.finished]).toEqual(["walk", 0, false]);
  });

  it("play switches clips and starts the new one from the beginning", () => {
    const animator = new Animator("attack");
    animator.time = 1.5;
    animator.finished = true;
    animator.play("idle");
    expect([animator.clip, animator.time, animator.finished]).toEqual(["idle", 0, false]);
  });

  it("play does nothing when the clip is already playing", () => {
    const animator = new Animator("walk");
    animator.time = 0.3;
    animator.play("walk");
    expect(animator.time).toBe(0.3);
  });

  it("restart plays the current clip again from the beginning", () => {
    const animator = new Animator("attack");
    animator.time = 2;
    animator.finished = true;
    animator.restart();
    expect([animator.clip, animator.time, animator.finished]).toEqual(["attack", 0, false]);
  });
});

describe("animate", () => {
  it("shows the clip's frames at its fps, starting with the first", async () => {
    const { run } = await setup();
    // walk = [2, 3, 4] at 4 fps: each frame lasts 0.25 s.
    expect(run(4, 0.125)).toEqual([2, 3, 3, 4]);
  });

  it("loops back to the first frame and keeps time within one cycle", async () => {
    const { animator, run } = await setup();
    expect(run(4, 0.25)).toEqual([3, 4, 2, 3]);
    expect(animator.time).toBeCloseTo(0.25);
    expect(animator.finished).toBe(false);
  });

  it("handles a step longer than a whole cycle", async () => {
    const { animator, run } = await setup();
    // 2 s at 4 fps = position 8 = two whole cycles of 3, plus 2.
    expect(run(1, 2)).toEqual([4]);
    expect(animator.time).toBeCloseTo(0.5);
  });

  it("holds the last frame of a one-shot clip and sets finished", async () => {
    const { animator, run } = await setup();
    animator.play("attack");
    expect(run(2, 0.25)).toEqual([6, 7]);
    expect(animator.finished).toBe(false);
    expect(run(2, 0.25)).toEqual([7, 7]);
    expect(animator.finished).toBe(true);
  });

  it("shows the first frame while time is still negative (a delayed start)", async () => {
    const { animator, run } = await setup();
    animator.time = -0.5;
    expect(run(2, 0.125)).toEqual([2, 2]);
    expect(animator.time).toBeCloseTo(-0.25);
  });

  it("lands exactly on frame boundaries at the 60 Hz step", async () => {
    const { animator, run } = await setup();
    animator.play("tenth");
    // At 10 fps each frame lasts exactly 6 fixed steps.
    const frames = run(12, FIXED_STEP);
    expect(frames.slice(0, 5)).toEqual([0, 0, 0, 0, 0]);
    expect(frames.slice(5, 11)).toEqual([1, 1, 1, 1, 1, 1]);
    expect(frames[11]).toBe(2);
  });

  it("uses the clip of the sprite's current image", async () => {
    const { sprite, run } = await setup();
    sprite.image = "ghost";
    expect(run(1, 0.1)).toEqual([3]);
  });

  it("throws when the clip is not declared on the sprite's image", async () => {
    const { world, animator } = await setup();
    animator.play("jump");
    expect(() => animate(world, FIXED_STEP)).toThrow('Animation "jump" not found for image "hero"');
  });

  it("ignores an Animator without a Sprite", () => {
    const world = new World(); // no Assets resource either
    const animator = new Animator("walk");
    world.add(world.spawn(), animator);
    animate(world, FIXED_STEP);
    expect(animator.time).toBe(0);
  });
});
