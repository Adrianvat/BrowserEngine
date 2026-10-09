import { describe, it, expect } from "vitest";
import { Keyboard, Transform, World } from "../../src/engine";
import { Player, Velocity } from "../../src/game/components";
import { movement, playerInput, PLAYER_SPEED } from "../../src/game/systems";

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
