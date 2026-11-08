import { beforeAll, describe, it, expect } from "vitest";
import {
  Animator,
  Body,
  Collider,
  Contacts,
  Keyboard,
  Rect,
  Sprite,
  Velocity,
  World,
  type ComponentType,
  type System,
} from "../../src/engine";
import { componentClass, loadedSystem, system } from "../helpers/demo-project";

let Player: ComponentType<object>;
let popToys: System;
let kick: System;
let playerInput: System;
let playerAppearance: System;
let KICK_IMPULSE: number;
let PLAYER_SPEED: number;

beforeAll(async () => {
  Player = await componentClass("Player");
  popToys = await system("popToys");
  playerAppearance = await system("playerAppearance");
  const kickScript = await loadedSystem("kick");
  kick = kickScript.system;
  KICK_IMPULSE = kickScript.exports.KICK_IMPULSE as number;
  const inputScript = await loadedSystem("playerInput");
  playerInput = inputScript.system;
  PLAYER_SPEED = inputScript.exports.PLAYER_SPEED as number;
});

describe("popToys", () => {
  function setup() {
    const world = new World();
    const contacts = new Contacts();
    world.setResource(contacts);
    const player = world.spawn();
    world.add(player, new Player());
    const spawn = (layer: string) => {
      const entity = world.spawn();
      world.add(entity, new Rect());
      world.add(entity, new Collider(10, 10, { layer }));
      return entity;
    };
    return { world, contacts, player, spawn };
  }

  it("removes the rects the player touched, whichever side they were on", () => {
    const { world, contacts, player, spawn } = setup();
    const touched = spawn("toy");
    const above = spawn("toy");
    const apart = spawn("toy");
    contacts.add(player, touched, 1, 0);
    contacts.add(above, player, 0, 1);
    popToys(world, 0);
    expect([touched, above, apart].map((rect) => world.isAlive(rect))).toEqual([false, false, true]);
    expect(world.isAlive(player)).toBe(true);
  });

  it("leaves the floor and walls alone, rects or not", () => {
    const { world, contacts, player, spawn } = setup();
    const floor = spawn("world");
    contacts.add(player, floor, 0, 1);
    popToys(world, 0);
    expect(world.isAlive(floor)).toBe(true);
  });

  it("ignores touches between rects and other things", () => {
    const { world, contacts, spawn } = setup();
    const a = spawn("toy");
    const b = spawn("toy");
    contacts.add(a, b, 1, 0);
    popToys(world, 0);
    expect([world.isAlive(a), world.isAlive(b)]).toEqual([true, true]);
  });
});

describe("kick", () => {
  function setup() {
    const world = new World();
    const keyboard = new Keyboard();
    world.setResource(keyboard);
    const body = new Body({ mass: 2 });
    const toy = world.spawn();
    world.add(toy, new Collider(10, 10, { layer: "toy" }));
    world.add(toy, body);
    return { world, keyboard, body };
  }

  it("gives every toy's body the same upward impulse when Space is pressed", () => {
    const { world, keyboard, body } = setup();
    const light = new Body({ mass: 0.5 });
    const small = world.spawn();
    world.add(small, new Collider(10, 10, { shape: "circle", layer: "toy" }));
    world.add(small, light);
    keyboard.handleKeyDown("Space");
    kick(world, 0);
    expect(KICK_IMPULSE).toBeGreaterThan(0);
    expect([body.impulseX, body.impulseY]).toEqual([0, -KICK_IMPULSE]);
    expect([light.impulseX, light.impulseY]).toEqual([0, -KICK_IMPULSE]);
  });

  it("leaves bodies on other layers (the player) alone", () => {
    const { world, keyboard } = setup();
    const hero = new Body();
    const player = world.spawn();
    world.add(player, new Collider(10, 10, { layer: "player" }));
    world.add(player, hero);
    keyboard.handleKeyDown("Space");
    kick(world, 0);
    expect([hero.impulseX, hero.impulseY]).toEqual([0, 0]);
  });

  it("does nothing while Space is not pressed", () => {
    const { world, body } = setup();
    kick(world, 0);
    expect([body.impulseX, body.impulseY]).toEqual([0, 0]);
  });
});

describe("playerInput", () => {
  function setup() {
    const world = new World();
    const keyboard = new Keyboard();
    world.setResource(keyboard);
    const velocity = new Velocity();
    const player = world.spawn();
    world.add(player, new Player());
    world.add(player, velocity);
    return { world, keyboard, velocity };
  }

  it("moves the player with the arrow keys at PLAYER_SPEED", () => {
    const { world, keyboard, velocity } = setup();
    keyboard.handleKeyDown("ArrowRight");
    playerInput(world, 0);
    expect([velocity.x, velocity.y]).toEqual([PLAYER_SPEED, 0]);
    keyboard.handleKeyUp("ArrowRight");
    keyboard.handleKeyDown("ArrowUp");
    playerInput(world, 0);
    expect([velocity.x, velocity.y]).toEqual([0, -PLAYER_SPEED]);
  });

  it("accepts WASD too and stops when nothing is held", () => {
    const { world, keyboard, velocity } = setup();
    keyboard.handleKeyDown("KeyA");
    playerInput(world, 0);
    expect(velocity.x).toBe(-PLAYER_SPEED);
    keyboard.handleKeyUp("KeyA");
    playerInput(world, 0);
    expect([velocity.x, velocity.y]).toEqual([0, 0]);
  });

  it("cancels opposite keys out", () => {
    const { world, keyboard, velocity } = setup();
    keyboard.handleKeyDown("ArrowLeft");
    keyboard.handleKeyDown("KeyD");
    playerInput(world, 0);
    expect(velocity.x).toBe(0);
  });

  it("leaves entities that are not the player alone", () => {
    const { world, keyboard } = setup();
    const other = new Velocity();
    const entity = world.spawn();
    world.add(entity, other);
    keyboard.handleKeyDown("ArrowRight");
    playerInput(world, 0);
    expect(other.x).toBe(0);
  });
});

describe("playerAppearance", () => {
  function setup() {
    const world = new World();
    const velocity = new Velocity();
    const sprite = new Sprite("hero");
    const animator = new Animator("idle");
    const player = world.spawn();
    world.add(player, new Player());
    world.add(player, velocity);
    world.add(player, sprite);
    world.add(player, animator);
    return { world, velocity, sprite, animator };
  }

  it("plays walk while moving and idle when still", () => {
    const { world, velocity, animator } = setup();
    velocity.y = 10;
    playerAppearance(world, 0);
    expect(animator.clip).toBe("walk");
    velocity.y = 0;
    playerAppearance(world, 0);
    expect(animator.clip).toBe("idle");
  });

  it("keeps the walk going while the player keeps moving", () => {
    const { world, velocity, animator } = setup();
    velocity.x = 10;
    playerAppearance(world, 0);
    animator.time = 0.3;
    playerAppearance(world, 0);
    expect(animator.time).toBe(0.3);
  });

  it("faces the way it moves horizontally and keeps facing otherwise", () => {
    const { world, velocity, sprite } = setup();
    velocity.x = -10;
    playerAppearance(world, 0);
    expect(sprite.flipX).toBe(true);

    velocity.x = 0;
    playerAppearance(world, 0);
    expect(sprite.flipX).toBe(true);

    velocity.y = 10;
    playerAppearance(world, 0);
    expect(sprite.flipX).toBe(true);

    velocity.x = 10;
    playerAppearance(world, 0);
    expect(sprite.flipX).toBe(false);
  });
});
