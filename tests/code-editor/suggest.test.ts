import { describe, it, expect } from "vitest";
import * as engine from "../../src/engine";
import { ComponentRegistry, type Script } from "../../src/engine";
import { Suggester, type SuggestRequest } from "../../src/code-editor/suggest";

const scripts: Script[] = [
  { kind: "component", name: "Player", code: "export default class Player {}\n" },
  {
    kind: "system",
    name: "playerInput",
    code: [
      `import { Keyboard, Velocity } from "engine";`,
      `import Player from "components/Player";`,
      `export const PLAYER_SPEED = 300;`,
      `export default function playerInput(world) {`,
      `  const keyboard = world.getResource(Keyboard);`,
      `  for (const [, , velocity] of world.query(Player, Velocity)) velocity.x = PLAYER_SPEED;`,
      `}`,
    ].join("\n"),
  },
];

const fields: Record<string, string[]> = {};
for (const definition of new ComponentRegistry().all()) fields[definition.name] = Object.keys(definition.fields);
const suggester = new Suggester(engine, fields);

/** Suggests at "|" in the text, for the given script. */
function at(marked: string, options: Partial<SuggestRequest> = {}) {
  const caret = marked.indexOf("|");
  const text = marked.slice(0, caret) + marked.slice(caret + 1);
  return suggester.suggest({ text, caret, scripts, currentPath: "systems/kick", ...options });
}
const texts = (marked: string, options: Partial<SuggestRequest> = {}) =>
  at(marked, options)?.items.map((item) => item.text) ?? [];

describe("Suggester", () => {
  it("offers keywords, engine exports and project names for a word, best matches first", () => {
    const items = at("const x = Ke|")!.items;
    expect(items[0]).toEqual({ text: "Keyboard", kind: "engine" });
    expect(texts("ret|")).toContain("return");
    expect(at("ret|")!.items.find((i) => i.text === "return")?.kind).toBe("keyword");
    expect(texts("PLAYER|")[0]).toBe("PLAYER_SPEED");
    expect(texts("playerIn|")).toEqual(["playerInput"]);
    expect(at("playerIn|")!.items[0].kind).toBe("name");
    expect(at("Ke|")).toMatchObject({ from: 0, to: 2 });
  });

  it("prefers names from the open script, then other scripts, then the engine, then keywords", () => {
    const text = "const forward = 1;\nfo|";
    const others = [...scripts, { kind: "system", name: "x", code: "let format = 1;" } as Script];
    const items = texts(text, { scripts: others });
    expect(items.slice(0, 3)).toEqual(["forward", "format", "formatSceneData"]);
    expect(items).toContain("for");
    expect(items.indexOf("formatSceneData")).toBeLessThan(items.indexOf("for"));
  });

  it("puts case-sensitive matches before case-insensitive ones, shorter first", () => {
    const items = texts("const keyboard = 1; const Key = 2; ke|");
    expect(items.indexOf("keyboard")).toBeLessThan(items.indexOf("Key"));
    expect(items.indexOf("Key")).toBeLessThan(items.indexOf("Keyboard"));
  });

  it("does not suggest the word itself", () => {
    expect(texts("const velocity = 1; velocity|")).not.toContain("velocity");
  });

  it("waits for two letters unless asked explicitly, and caps the list", () => {
    expect(at("K|")).toBeNull();
    expect(at("K|", { explicit: true })?.items.map((i) => i.text)).toContain("Keyboard");
    expect(at("|", { explicit: true })?.items).toHaveLength(10);
    expect(at("|", { explicit: true, limit: 3 })?.items).toHaveLength(3);
    expect(at("|")).toBeNull();
  });

  it("stays quiet inside comments, numbers, regular expressions and ordinary strings", () => {
    expect(at("// let me ret|")).toBeNull();
    expect(at("/* ret| */")).toBeNull();
    expect(at("x = 1e|")).toBeNull();
    expect(at("x = /ret|/")).toBeNull();
    expect(at("x = /ret|")).toBeNull(); // still being typed
    expect(at(`x = "ret|"`)).toBeNull();
    expect(at("x = `ret|`")).toBeNull();
  });

  it("after a dot, offers the receiver's members first, then every known member", () => {
    const items = at("world.qu|")!.items;
    expect(items[0]).toEqual({ text: "query", kind: "member" });
    const all = at("world.|")!.items.map((i) => i.text);
    expect(all.slice(0, 5).every((name) => ["add", "get", "has", "spawn", "query", "remove", "despawn", "isAlive", "entityCount", "getResource", "setResource", "hasResource"].includes(name))).toBe(true);
    // Component fields (built-in and from scripts) and members used in scripts are known too.
    expect(texts("velocity.|")).toContain("x");
    expect(texts("sprite.fl|").slice(0, 2)).toEqual(["flipX", "flipY"]);
    expect(texts("keyboard.is|")[0]).toBe("isDown");
    expect(texts("Math.fl|")[0]).toBe("floor");
    expect(texts("thing.getRes|")).toEqual(["getResource"]);
    expect(texts("a?.b.ge|")).toContain("get");
  });

  it("does not take the dot of a number for member access", () => {
    expect(at("x = 1.|")).toBeNull();
    expect(at("x = 1.5|")).toBeNull();
  });

  it("suggests what an import can name, inside its string", () => {
    expect(texts(`import { Keyboard } from "|`)).toEqual([
      "engine",
      "components/Player",
      "systems/playerInput",
    ]);
    expect(texts(`import Player from "comp|`)).toEqual(["components/Player"]);
    expect(at(`import Player from "comp|`)).toMatchObject({ from: 20, to: 24 });
    expect(texts(`import "sys|`)).toEqual(["systems/playerInput"]);
    expect(texts(`export { x } from 'e|`)).toEqual(["engine"]);
    // Not its own path, and nothing once the string is closed.
    expect(texts(`import x from "|`, { currentPath: "systems/playerInput" })).not.toContain("systems/playerInput");
    expect(at(`import x from "engine"|`)).toBeNull();
  });

  it("ignores names that are not identifiers and private helpers of the engine", () => {
    const items = at("|", { explicit: true, limit: 1000 })!.items.map((i) => i.text);
    expect(items.every((name) => /^[\p{L}_$][\p{L}\p{N}_$]*$/u.test(name))).toBe(true);
    expect(texts("world.|")).not.toContain("constructor");
  });
});
