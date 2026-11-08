import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { ScriptLibrary } from "../../src/code-editor/library";
import { CodeEditorModel, type Checker } from "../../src/code-editor/model";
import { component, type LoadedScripts, type Script } from "../../src/engine";
import { FakeScriptFiles } from "../helpers/fake-script-files";

const onDisk: Script[] = [
  { kind: "component", name: "Player", code: "export default class Player {}" },
  { kind: "system", name: "input", code: "export default () => {};" },
  { kind: "system", name: "physics", code: "export default () => {};" },
];

/**
 * A checker that "loads" instantly: a script whose code contains "BAD" fails, systems
 * get the scenes named in a `scenes:` comment, and every check is recorded.
 */
function fakeChecker() {
  const checked: Script[][] = [];
  const checker: Checker = async (scripts) => {
    checked.push(scripts.map((script) => ({ ...script })));
    const result: LoadedScripts = { components: [], systems: [], scenes: [], errors: [] };
    for (const script of scripts) {
      if (script.code.includes("BAD")) {
        result.errors.push({ kind: script.kind, name: script.name, message: `bad: ${script.name}` });
      } else if (script.kind === "system") {
        const scenes = /scenes:(\w+)/.exec(script.code);
        result.systems.push({
          name: script.name,
          system: () => {},
          disabled: script.disabled === true,
          scenes: scenes ? [scenes[1]] : null,
          phase: "update",
          startsEnabled: true,
          onEnable: null,
          onDisable: null,
          exports: {},
        });
      } else {
        result.components.push({
          name: script.name,
          definition: component(class {}, script.name, {}),
          exports: {},
        });
      }
    }
    return result;
  };
  return { checker, checked };
}

/** A model over fake files that hold the scripts; `loadedLibrary` makes the library read them first. */
function setup(files = new FakeScriptFiles(onDisk)) {
  const library = new ScriptLibrary({ files });
  const { checker, checked } = fakeChecker();
  // Reading the files is async; the model is built once they are in, as main.ts does.
  let model!: CodeEditorModel;
  let changes = 0;
  const ready = library.load().then(() => {
    model = new CodeEditorModel({ library, checker, sceneNames: ["title", "play"], checkDelay: 100 });
    model.onChange(() => changes++);
  });
  /** The scripts in the files, for checking what was written. */
  const stored = () => files.scripts;
  return {
    get model() {
      return model;
    },
    library,
    files,
    checked,
    stored,
    changes: () => changes,
    ready,
  };
}

/** A model that has read its files. */
async function loaded(files?: FakeScriptFiles) {
  const result = setup(files);
  await result.ready;
  return result;
}

/** Lets pending promises (a check) settle. */
const settle = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("opening and editing", () => {
  it("starts with nothing open and checks the scripts once", async () => {
    const library = new ScriptLibrary({ files: new FakeScriptFiles(onDisk) });
    await library.load();
    const { checker, checked } = fakeChecker();
    const model = new CodeEditorModel({ library, checker, sceneNames: [] });
    expect(model.selected).toBeNull();
    expect(model.text).toBeNull();
    expect(model.dirty).toBe(false);
    expect(model.checking).toBe(true);
    await settle();
    expect(model.checking).toBe(false);
    expect(checked).toHaveLength(1);
    expect(model.infoOf("system", "input")).toMatchObject({ error: null, system: { name: "input" } });
    expect(model.infoOf("component", "Player")).toMatchObject({ component: { name: "Player" } });
  });

  it("select opens a script and shows its saved code", async () => {
    const { model, changes } = await loaded();
    await settle();
    const before = changes();
    model.select({ kind: "system", name: "input" });
    expect(model.selected).toEqual({ kind: "system", name: "input" });
    expect(model.text).toBe("export default () => {};");
    expect(changes()).toBe(before + 1);
    expect(() => model.select({ kind: "system", name: "nope" })).toThrow('No system "nope"');
    model.select(null);
    expect(model.text).toBeNull();
  });

  it("edit keeps a draft per script without saving, and checks after a pause", async () => {
    const { model, checked, files } = await loaded();
    await settle();
    model.select({ kind: "system", name: "input" });
    model.edit("draft one");
    expect(model.text).toBe("draft one");
    expect(model.dirty).toBe(true);
    expect(model.isDirty("system", "input")).toBe(true);
    expect(files.calls).toEqual(["load"]); // nothing written yet
    expect(checked).toHaveLength(1);

    // Typing more within the delay postpones the check; then it runs on the drafts.
    await vi.advanceTimersByTimeAsync(60);
    model.edit("draft two");
    await vi.advanceTimersByTimeAsync(60);
    expect(checked).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(60);
    expect(checked).toHaveLength(2);
    expect(checked[1][1].code).toBe("draft two");

    // Switching scripts keeps the draft.
    model.select({ kind: "system", name: "physics" });
    expect(model.text).toBe("export default () => {};");
    model.select({ kind: "system", name: "input" });
    expect(model.text).toBe("draft two");
  });

  it("a draft typed back to the saved code is no draft", async () => {
    const { model } = await loaded();
    model.select({ kind: "system", name: "input" });
    model.edit("x");
    model.edit("export default () => {};");
    expect(model.dirty).toBe(false);
  });

  it("edit without an open script is an error", async () => {
    const { model } = await loaded();
    expect(() => model.edit("x")).toThrow("No script is open");
  });

  it("discard drops the open script's draft", async () => {
    const { model } = await loaded();
    model.select({ kind: "system", name: "input" });
    model.edit("x");
    model.discard();
    expect(model.text).toBe("export default () => {};");
    expect(model.dirty).toBe(false);
  });
});

describe("saving", () => {
  it("save writes every draft to its file, then checks once", async () => {
    const { model, library, checked, files } = await loaded();
    await settle();
    model.select({ kind: "system", name: "input" });
    model.edit("input v2");
    model.select({ kind: "component", name: "Player" });
    model.edit("player v2");
    const saved = model.save();
    expect(model.dirty).toBe(false);
    expect(library.get("system", "input")?.code).toBe("input v2");
    expect(library.get("component", "Player")?.code).toBe("player v2");
    await saved;
    expect(files.codeOf("system", "input")).toBe("input v2");
    expect(files.codeOf("component", "Player")).toBe("player v2");
    expect(files.calls.slice(1)).toEqual(["write systems/input", "write components/Player"]);
    expect(library.status).toBe("saved");
    await settle();
    expect(checked).toHaveLength(2);
    // The pending typing check was cancelled by the save.
    await vi.advanceTimersByTimeAsync(200);
    expect(checked).toHaveLength(2);
  });

  it("save with nothing to save does nothing", async () => {
    const { model, checked, files } = await loaded();
    await settle();
    await model.save();
    await settle();
    expect(files.calls).toEqual(["load"]);
    expect(checked).toHaveLength(1);
  });

  it("keeps a draft whose write failed, so it can be saved again", async () => {
    const { model, library, files } = await loaded();
    model.select({ kind: "system", name: "input" });
    model.edit("input v2");
    files.failure = "disk full";
    await model.save();
    expect(library.status).toEqual({ error: "disk full" });
    expect(model.isDirty("system", "input")).toBe(true);
    expect(model.text).toBe("input v2");
    expect(files.codeOf("system", "input")).toBe("export default () => {};");
    files.failure = null;
    await model.save();
    expect(model.dirty).toBe(false);
    expect(files.codeOf("system", "input")).toBe("input v2");
    expect(library.status).toBe("saved");
  });
});

describe("checking", () => {
  it("reports each broken script's error and what the working ones define", async () => {
    const { model } = await loaded();
    model.select({ kind: "system", name: "input" });
    model.edit("BAD scenes:play");
    await vi.advanceTimersByTimeAsync(100);
    expect(model.infoOf("system", "input")).toEqual({ error: "bad: input", system: null, component: null, scene: null });
    model.edit("fine scenes:play");
    await vi.advanceTimersByTimeAsync(100);
    expect(model.infoOf("system", "input")).toMatchObject({ error: null, system: { scenes: ["play"] } });
  });

  it("has no info before the first check finishes", async () => {
    const library = new ScriptLibrary({ files: new FakeScriptFiles(onDisk) });
    await library.load();
    const model = new CodeEditorModel({ library, checker: fakeChecker().checker, sceneNames: [] });
    expect(model.infoOf("system", "input")).toBeNull();
  });

  it("does not check the same scripts twice in a row", async () => {
    const { model, checked } = await loaded();
    await settle();
    await model.check();
    model.select({ kind: "system", name: "input" });
    model.edit("x");
    model.discard();
    await vi.advanceTimersByTimeAsync(100);
    expect(checked).toHaveLength(1);
    model.edit("x");
    await vi.advanceTimersByTimeAsync(100);
    expect(checked).toHaveLength(2);
  });

  it("the latest check wins, whatever order they finish in", async () => {
    const library = new ScriptLibrary({ files: new FakeScriptFiles(onDisk) });
    await library.load();
    const resolvers: ((result: LoadedScripts) => void)[] = [];
    const checker: Checker = () => new Promise((resolve) => resolvers.push(resolve));
    const model = new CodeEditorModel({ library, checker, sceneNames: [], checkDelay: 10 });
    model.select({ kind: "system", name: "input" });
    model.edit("v2");
    void model.check();
    expect(resolvers).toHaveLength(2);
    expect(model.checking).toBe(true);
    const late: LoadedScripts = {
      components: [],
      systems: [],
      scenes: [],
      errors: [{ kind: "system", name: "input", message: "late" }],
    };
    resolvers[1](late);
    await settle();
    resolvers[0]({ components: [], systems: [], scenes: [], errors: [] });
    await settle();
    expect(model.checking).toBe(false);
    expect(model.infoOf("system", "input")?.error).toBe("late");
  });

  it("a checker that throws is reported as a check error, not a script error", async () => {
    const library = new ScriptLibrary({ files: new FakeScriptFiles(onDisk) });
    await library.load();
    const checker: Checker = async () => {
      throw new Error("no modules here");
    };
    const model = new CodeEditorModel({ library, checker, sceneNames: [] });
    await settle();
    expect(model.checkError).toBe("no modules here");
    expect(model.infoOf("system", "input")).toBeNull();
  });
});

describe("adding, removing and arranging", () => {
  it("add creates a script from a template, writes its file and opens it", async () => {
    const { model, files } = await loaded();
    await model.add("system", "bounce");
    expect(model.selected).toEqual({ kind: "system", name: "bounce" });
    expect(model.text).toContain("export default function bounce(world, dt)");
    expect(model.text).toContain('export const scenes = ["play"];');
    expect(files.codeOf("system", "bounce")).toBe(model.text);

    await model.add("component", "Spin");
    expect(model.text).toContain("export default class Spin");
    expect(model.text).toContain("export const fields");
    expect(() => model.add("component", "Spin")).toThrow("already a component");
  });

  it("addBuiltInSystem adds one of the engine's systems as a script that re-exports it, and loads it", async () => {
    const { model, files } = await loaded();
    await model.remove("system", "physics");
    await model.add("scene", "play");
    await model.addBuiltInSystem("physics");
    expect(model.selected).toEqual({ kind: "system", name: "physics" });
    expect(model.text).toContain('import { physics } from "engine";');
    expect(model.text).toContain("export default physics;");
    expect(model.text).toContain('// export const scenes = ["play"];');
    expect(files.codeOf("system", "physics")).toBe(model.text);
    expect(() => model.addBuiltInSystem("physics")).toThrow("already a system");
    expect(() => model.addBuiltInSystem("render")).toThrow('The engine has no system "render"');
    await vi.advanceTimersByTimeAsync(100);
    expect(model.infoOf("system", "physics")).toMatchObject({ error: null, system: { scenes: null } });
  });

  it("setEnabled switches a system off and on again, keeping its file", async () => {
    const { model, library, files } = await loaded();
    await model.setEnabled("physics", false);
    expect(library.get("system", "physics")?.disabled).toBe(true);
    expect(files.isDisabled("physics")).toBe(true);
    expect(files.codeOf("system", "physics")).toBeDefined();
    await vi.advanceTimersByTimeAsync(100);
    expect(model.infoOf("system", "physics")).toMatchObject({ error: null, system: { disabled: true } });
    await model.setEnabled("physics", true);
    expect(library.get("system", "physics")?.disabled).toBeUndefined();
    expect(files.isDisabled("physics")).toBe(false);
    expect(() => model.setEnabled("nope", false)).toThrow('No system "nope"');
  });

  it("remove drops the script, its draft and the selection, and deletes the file", async () => {
    const { model, library, files } = await loaded();
    model.select({ kind: "system", name: "input" });
    model.edit("draft");
    await model.remove("system", "input");
    expect(library.has("system", "input")).toBe(false);
    expect(files.codeOf("system", "input")).toBeUndefined();
    expect(model.selected).toBeNull();
    expect(model.dirty).toBe(false);
    // Removing another script leaves the selection alone.
    model.select({ kind: "system", name: "physics" });
    await model.remove("component", "Player");
    expect(model.selected).toEqual({ kind: "system", name: "physics" });
  });

  it("move reorders systems and writes the order", async () => {
    const { model, library, files } = await loaded();
    await model.move("system", "physics", -1);
    expect(library.ofKind("system").map((s) => s.name)).toEqual(["physics", "input"]);
    expect(files.calls.at(-1)).toBe("order physics,input");
  });

  it("follows changes made on disk: stale drafts and selections go", async () => {
    const { model, library, files, checked } = await loaded();
    await settle();
    model.select({ kind: "system", name: "physics" });
    model.edit("draft");
    files.scripts = files.scripts.filter((s) => s.name !== "physics");
    files.scripts.find((s) => s.name === "input")!.code = "from elsewhere";
    await library.reload();
    expect(model.selected).toBeNull();
    expect(model.dirty).toBe(false);
    expect(library.get("system", "input")?.code).toBe("from elsewhere");
    await settle();
    expect(checked).toHaveLength(2);
  });
});
