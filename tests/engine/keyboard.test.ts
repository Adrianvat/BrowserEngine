import { describe, it, expect } from "vitest";
import { Keyboard } from "../../src/engine/input/keyboard";

function keyEvent(type: "keydown" | "keyup", code: string): Event {
  return Object.assign(new Event(type), { code });
}

describe("Keyboard state", () => {
  it("isDown is true while held", () => {
    const kb = new Keyboard();
    kb.handleKeyDown("KeyA");
    expect(kb.isDown("KeyA")).toBe(true);
    expect(kb.isDown("KeyB")).toBe(false);
    kb.handleKeyUp("KeyA");
    expect(kb.isDown("KeyA")).toBe(false);
  });

  it("wasPressed lasts until endStep; isDown survives endStep", () => {
    const kb = new Keyboard();
    kb.handleKeyDown("Space");
    expect(kb.wasPressed("Space")).toBe(true);
    kb.endStep();
    expect(kb.wasPressed("Space")).toBe(false);
    expect(kb.isDown("Space")).toBe(true);
  });

  it("a tap shorter than one step is still seen", () => {
    const kb = new Keyboard();
    kb.handleKeyDown("Space");
    kb.handleKeyUp("Space");
    expect(kb.wasPressed("Space")).toBe(true);
    expect(kb.isDown("Space")).toBe(false);
  });

  it("auto-repeat does not re-trigger wasPressed", () => {
    const kb = new Keyboard();
    kb.handleKeyDown("Space");
    kb.endStep();
    kb.handleKeyDown("Space"); // OS repeat while still held
    expect(kb.wasPressed("Space")).toBe(false);
    kb.handleKeyUp("Space");
    kb.handleKeyDown("Space"); // a real second press
    expect(kb.wasPressed("Space")).toBe(true);
  });

  it("clear resets everything", () => {
    const kb = new Keyboard();
    kb.handleKeyDown("KeyA");
    kb.clear();
    expect(kb.isDown("KeyA")).toBe(false);
    expect(kb.wasPressed("KeyA")).toBe(false);
  });
});

describe("Keyboard events", () => {
  it("reacts to keydown/keyup events on the attached target", () => {
    const target = new EventTarget();
    const kb = new Keyboard();
    kb.attach(target);
    target.dispatchEvent(keyEvent("keydown", "ArrowLeft"));
    expect(kb.isDown("ArrowLeft")).toBe(true);
    target.dispatchEvent(keyEvent("keyup", "ArrowLeft"));
    expect(kb.isDown("ArrowLeft")).toBe(false);
  });

  it("blur releases all keys (no stuck keys after alt-tab)", () => {
    const target = new EventTarget();
    const kb = new Keyboard();
    kb.attach(target);
    target.dispatchEvent(keyEvent("keydown", "KeyW"));
    target.dispatchEvent(new Event("blur"));
    expect(kb.isDown("KeyW")).toBe(false);
  });

  it("detach stops listening and clears state", () => {
    const target = new EventTarget();
    const kb = new Keyboard();
    kb.attach(target);
    target.dispatchEvent(keyEvent("keydown", "KeyW"));
    kb.detach();
    expect(kb.isDown("KeyW")).toBe(false);
    target.dispatchEvent(keyEvent("keydown", "KeyS"));
    expect(kb.isDown("KeyS")).toBe(false);
    expect(() => kb.detach()).not.toThrow();
  });

  it("attaching to a new target stops listening to the old one", () => {
    const first = new EventTarget();
    const second = new EventTarget();
    const kb = new Keyboard();
    kb.attach(first);
    kb.attach(second);
    first.dispatchEvent(keyEvent("keydown", "KeyA"));
    expect(kb.isDown("KeyA")).toBe(false);
    second.dispatchEvent(keyEvent("keydown", "KeyA"));
    expect(kb.isDown("KeyA")).toBe(true);
  });
});
