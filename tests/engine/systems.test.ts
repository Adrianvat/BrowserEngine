import { describe, expect, it } from "vitest";
import { Systems, World } from "../../src/engine";

function setup() {
  const world = new World();
  const systems = new Systems(world);
  const log: string[] = [];
  const add = (name: string, phase: "update" | "render" = "update", startsEnabled?: boolean) =>
    systems.add(
      {
        name,
        startsEnabled,
        run: () => log.push(`${name} runs`),
        onEnable: (w) => log.push(`${name} on${w === world ? "" : " (wrong world)"}`),
        onDisable: () => log.push(`${name} off`),
      },
      phase,
    );
  return { world, systems, log, add };
}

describe("Systems", () => {
  it("lists what was added, by phase, named after a bare function when there is no name", () => {
    const { systems } = setup();
    function draw() {}
    systems.add(() => {}, "update");
    systems.add(draw, "render");
    systems.add({ name: "named", run: () => {} }, "update");
    expect(systems.names).toEqual(["", "draw", "named"]);
    expect(systems.entries("update").map((s) => s.name)).toEqual(["", "named"]);
    expect(systems.entries("render").map((s) => s.name)).toEqual(["draw"]);
    expect(systems.has("draw")).toBe(true);
    expect(systems.has("nope")).toBe(false);
  });

  it("runs the hooks only once the scene is up: onEnable in order at start, onDisable last first at stop", () => {
    const { systems, log, add } = setup();
    add("a");
    add("b");
    add("c", "update", false);
    expect(log).toEqual([]);
    systems.start();
    expect(log).toEqual(["a on", "b on"]);
    systems.start(); // again: nothing
    systems.stop();
    expect(log).toEqual(["a on", "b on", "b off", "a off"]);
    systems.stop();
    expect(log).toHaveLength(4);
  });

  it("enable and disable flip the switch and run the hook, only when something changes", () => {
    const { systems, log, add } = setup();
    add("a");
    add("b", "update", false);
    systems.disable("a"); // before the scene is up: no hook
    systems.enable("b");
    expect(log).toEqual([]);
    expect(systems.isEnabled("a")).toBe(false);
    expect(systems.isEnabled("b")).toBe(true);
    systems.start();
    expect(log).toEqual(["b on"]);
    systems.enable("a");
    systems.enable("a");
    systems.disable("b");
    systems.disable("b");
    expect(log).toEqual(["b on", "a on", "b off"]);
    expect(() => systems.enable("nope")).toThrow('No system "nope" in this scene (the systems are a, b)');
    expect(() => systems.isEnabled("nope")).toThrow();
  });

  it("treats systems sharing a name together, and starts one added while the scene runs at once", () => {
    const { systems, log, add } = setup();
    add("twin");
    add("twin");
    systems.start();
    systems.disable("twin");
    expect(systems.entries("update").map((s) => s.enabled)).toEqual([false, false]);
    expect(systems.isEnabled("twin")).toBe(false);
    add("late");
    expect(log).toEqual(["twin on", "twin on", "twin off", "twin off", "late on"]);
  });
});
