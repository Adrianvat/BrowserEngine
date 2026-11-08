import { describe, it, expect } from "vitest";
import { ScriptLibrary } from "../../src/code-editor/library";
import type { Script } from "../../src/engine";
import { FakeScriptFiles } from "../helpers/fake-script-files";

const onDisk: Script[] = [
  { kind: "system", name: "input", code: "export default () => 'input';" },
  { kind: "system", name: "physics", code: "export default () => 'physics';" },
  { kind: "system", name: "pickup", code: "export default () => 'pickup';" },
  { kind: "component", name: "Coin", code: "export default class Coin {}" },
  { kind: "component", name: "Player", code: "export default class Player {}" },
];

async function setup(files = new FakeScriptFiles(onDisk), fallback?: () => Promise<Script[]>) {
  const library = new ScriptLibrary({
    files,
    fallback,
    reservedComponentNames: ["Transform", "Sprite"],
  });
  const statuses: unknown[] = [];
  library.onChange(() => statuses.push(library.status));
  await library.load();
  return { library, files, statuses };
}

const names = (scripts: readonly Script[]) => scripts.map((script) => script.name);

describe("loading", () => {
  it("reads the files once and shows them", async () => {
    const { library, files } = await setup();
    expect(library.scripts).toEqual(onDisk);
    expect(library.scripts[0]).not.toBe(onDisk[0]);
    expect(library.status).toBe("saved");
    expect(library.readOnly).toBe(false);
    expect(library.loadError).toBeNull();
    expect(files.calls).toEqual(["load"]);
    expect(names(library.ofKind("system"))).toEqual(["input", "physics", "pickup"]);
    expect(names(library.ofKind("component"))).toEqual(["Coin", "Player"]);
  });

  it("falls back to the bundled scripts, read-only, when the files can't be reached", async () => {
    const files = new FakeScriptFiles(onDisk);
    files.reachable = false;
    const { library } = await setup(files, async () => onDisk.slice(0, 2));
    expect(library.readOnly).toBe(true);
    expect(library.status).toBe("readOnly");
    expect(names(library.scripts)).toEqual(["input", "physics"]);
    expect(library.loadError).toBeNull();
    const blocked = "The scripts can't be changed here: start the dev server";
    expect(() => library.setCode("system", "input", "y")).toThrow(blocked);
    expect(() => library.add("system", "z", "")).toThrow(blocked);
    expect(() => library.remove("system", "input")).toThrow(blocked);
    expect(() => library.move("system", "input", 1)).toThrow(blocked);
    await library.reload();
    expect(library.readOnly).toBe(true);
  });

  it("reports when neither the files nor a fallback can be read", async () => {
    const files = new FakeScriptFiles(onDisk);
    files.reachable = false;
    const { library } = await setup(files);
    expect(library.loadError).toBe("The scripts API is not there");
    expect(library.scripts).toEqual([]);
    expect(() => library.add("system", "z", "")).toThrow("The scripts could not be read");
  });

  it("reload re-reads what changed on disk", async () => {
    const { library, files } = await setup();
    files.scripts[0].code = "changed elsewhere";
    files.scripts.push({ kind: "system", name: "fromElsewhere", code: "" });
    await library.reload();
    expect(library.get("system", "input")?.code).toBe("changed elsewhere");
    expect(library.has("system", "fromElsewhere")).toBe(true);
    expect(library.status).toBe("saved");
  });
});

describe("changes", () => {
  it("setCode writes the file, showing saving then saved", async () => {
    const { library, files, statuses } = await setup();
    const done = library.setCode("system", "input", "new code");
    expect(library.get("system", "input")?.code).toBe("new code"); // at once, in memory
    expect(library.status).toBe("saving");
    await done;
    expect(library.status).toBe("saved");
    expect(files.codeOf("system", "input")).toBe("new code");
    expect(files.calls).toEqual(["load", "write systems/input"]);
    expect(statuses).toEqual(["saved", "saving", "saved"]);
  });

  it("add writes a new file and checks the name first", async () => {
    const { library, files } = await setup();
    await library.add("component", "Spin", "export default class Spin {}");
    expect(names(library.scripts).at(-1)).toBe("Spin");
    expect(files.codeOf("component", "Spin")).toBe("export default class Spin {}");
    expect(() => library.add("component", "Spin", "")).toThrow('There is already a component "Spin"');
    expect(() => library.add("system", "2fast", "")).toThrow("must be an identifier");
    expect(() => library.add("component", "Transform", "")).toThrow(
      '"Transform" is a component the engine or the game defines in code',
    );
    // A system may share a name with a component, and with a reserved component name.
    expect(library.nameProblem("system", "Spin")).toBeNull();
    expect(library.nameProblem("system", "Transform")).toBeNull();
  });

  it("remove deletes the file", async () => {
    const { library, files } = await setup();
    await library.remove("system", "physics");
    expect(names(library.scripts)).toEqual(["input", "pickup", "Coin", "Player"]);
    expect(files.codeOf("system", "physics")).toBeUndefined();
    expect(() => library.remove("system", "physics")).toThrow('No system "physics"');
  });

  it("move swaps with the neighbour of the same kind and writes the systems' order", async () => {
    const { library, files } = await setup();
    await library.move("system", "pickup", -1);
    expect(names(library.ofKind("system"))).toEqual(["input", "pickup", "physics"]);
    expect(files.calls.at(-1)).toBe("order input,pickup,physics");
    expect(names(files.scripts.filter((s) => s.kind === "system"))).toEqual(["input", "pickup", "physics"]);
    // Components' order is only for the list: nothing is written.
    await library.move("component", "Player", -1);
    expect(names(library.ofKind("component"))).toEqual(["Player", "Coin"]);
    expect(files.calls.at(-1)).toBe("order input,pickup,physics");
    // At the edge nothing happens.
    await library.move("system", "input", -1);
    await library.move("system", "physics", 1);
    expect(files.calls.filter((call) => call.startsWith("order"))).toHaveLength(1);
  });

  it("setEnabled switches a system off and on, writing it, and puts it back when the write fails", async () => {
    const { library, files } = await setup();
    await library.setEnabled("physics", false);
    expect(library.get("system", "physics")?.disabled).toBe(true);
    expect(names(library.ofKind("system"))).toEqual(["input", "physics", "pickup"]); // still listed, in place
    expect(files.calls.at(-1)).toBe("disable physics");
    expect(files.isDisabled("physics")).toBe(true);
    await library.setEnabled("physics", true);
    expect(library.get("system", "physics")?.disabled).toBeUndefined();
    expect(files.calls.at(-1)).toBe("enable physics");
    expect(() => library.setEnabled("nope", false)).toThrow('No system "nope"');

    files.failure = "disk full";
    await expect(library.setEnabled("physics", false)).rejects.toThrow("disk full");
    expect(library.get("system", "physics")?.disabled).toBeUndefined();
    expect(library.status).toEqual({ error: "disk full" });
  });

  it("writes one after another, in order", async () => {
    const { library, files } = await setup();
    const first = library.setCode("system", "input", "1");
    const second = library.add("system", "extra", "2");
    const third = library.move("system", "extra", -1);
    expect(library.status).toBe("saving");
    await Promise.all([first, second, third]);
    expect(files.calls.slice(1)).toEqual(["write systems/input", "write systems/extra", "order input,physics,extra,pickup"]);
    expect(library.status).toBe("saved");
  });

  it("importScripts adds or replaces scripts and puts their systems first", async () => {
    const { library, files } = await setup();
    await library.importScripts([
      { kind: "system", name: "pickup", code: "mine" },
      { kind: "system", name: "extra", code: "new" },
      { kind: "component", name: "Player", code: "my player" },
    ]);
    expect(names(library.ofKind("system"))).toEqual(["pickup", "extra", "input", "physics"]);
    expect(library.get("component", "Player")?.code).toBe("my player");
    expect(files.codeOf("system", "extra")).toBe("new");
    expect(files.calls.at(-1)).toBe("order pickup,extra,input,physics");
  });
});

describe("saving problems", () => {
  it("a failed code write is reported and the old code comes back", async () => {
    const { library, files } = await setup();
    files.failure = "disk full";
    await expect(library.setCode("system", "input", "changed")).rejects.toThrow("disk full");
    expect(library.status).toEqual({ error: "disk full" });
    expect(library.get("system", "input")?.code).toBe("export default () => 'input';");
    files.failure = null;
    await library.setCode("system", "input", "changed");
    expect(library.status).toBe("saved");
  });

  it("a failed add or remove is reported and kept in memory until a reload", async () => {
    const { library, files } = await setup();
    files.failure = "read-only file system";
    await expect(library.add("system", "mine", "")).rejects.toThrow("read-only file system");
    expect(library.has("system", "mine")).toBe(true);
    expect(library.status).toEqual({ error: "read-only file system" });
    files.failure = null;
    await library.reload();
    expect(library.has("system", "mine")).toBe(false);
    expect(library.status).toBe("saved");
  });
});
