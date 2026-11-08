import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import * as engine from "../../src/engine";
import { dataUrlHost, loadScripts, type Script } from "../../src/engine";
import { ScriptLibrary } from "../../src/code-editor/library";
import { CodeEditorModel } from "../../src/code-editor/model";
import { mountDetails } from "../../src/code-editor/views/details";
import { mountEditor } from "../../src/code-editor/views/editor";
import { mountHelp } from "../../src/code-editor/views/help";
import { mountNavigator } from "../../src/code-editor/views/navigator";
import { mountTopBar } from "../../src/code-editor/views/top-bar";
import { Suggester } from "../../src/code-editor/suggest";
import { FakeElement, installFakeDom } from "../helpers/fake-dom";
import { FakeScriptFiles } from "../helpers/fake-script-files";
import { mountMigration, LEGACY_KEY } from "../../src/code-editor/views/migration";
import { MemoryStorage } from "../helpers/memory-storage";

/**
 * Smoke tests over a tiny fake DOM: the views mount, show the model, and drive it through
 * the main flows. Real scripts are loaded (through data: URLs) by the check.
 */
const defaults: Script[] = [
  { kind: "component", name: "Player", code: "export default class Player {}\n" },
  {
    kind: "system",
    name: "input",
    code: `import Player from "components/Player";\nexport const scenes = ["play"];\nexport default function input(world) {}\n`,
  },
  { kind: "system", name: "physics", code: `import { physics } from "engine";\nexport default physics;\n` },
];

let dom: ReturnType<typeof installFakeDom>;
let current: CodeEditorModel | null = null;

/** Lets debounce timers fire and waits for the check (real module loads) to finish. */
async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(50);
  for (let i = 0; i < 500 && current?.checking; i++) await vi.advanceTimersByTimeAsync(1);
  if (current?.checking) throw new Error("The check did not finish");
}

async function setup(files = new FakeScriptFiles(defaults)) {
  const library = new ScriptLibrary({
    files,
    fallback: async () => defaults.slice(0, 1),
    reservedComponentNames: ["Transform"],
  });
  await library.load();
  const model = new CodeEditorModel({
    library,
    sceneNames: ["title", "play"],
    checkDelay: 50,
    checker: (scripts) =>
      loadScripts(scripts, { engine, host: dataUrlHost, sceneNames: ["title", "play"] }),
  });
  current = model;
  const roots = {
    top: new FakeElement("header"),
    nav: new FakeElement("aside"),
    editor: new FakeElement("main"),
    details: new FakeElement("div"),
    help: new FakeElement("div"),
  };
  mountTopBar(roots.top as unknown as HTMLElement, model, library, { projectId: "demo", projectName: "Demo" });
  mountNavigator(roots.nav as unknown as HTMLElement, model, library);
  mountEditor(roots.editor as unknown as HTMLElement, model, { suggester: new Suggester(engine) });
  mountDetails(roots.details as unknown as HTMLElement, model, library, "demo");
  mountHelp(roots.help as unknown as HTMLElement, Object.keys(engine), ["title", "play"]);
  const textarea = () => roots.editor.byTag("textarea")[0];
  /** Opens the inline name form for a kind, types a name, and submits it. */
  const addViaForm = (kind: "system" | "component", name: string) => {
    roots.nav.withText(`+ Add ${kind}`)!.click();
    const form = roots.nav.byTag("form")[0];
    const input = form.byTag("input")[0];
    input.value = name;
    input.fire("input");
    form.fire("submit");
    return { form, input };
  };
  /** Clicks a confirming button, then its Yes (or Cancel). */
  const confirmClick = (root: FakeElement, label: string, yes: boolean) => {
    root.withText(label)!.click();
    const holder = root.find((e) => e.classList.contains("confirming"))
      .find((e) => e.withText("Yes") !== undefined)!;
    holder.withText(yes ? "Yes" : "Cancel")!.click();
  };
  const items = () => roots.nav.byTag("li").map((li) => li.textContent);
  const status = () => roots.top.find((e) => e.classList.contains("status"))[0].textContent;
  const check = () => roots.details.find((e) => e.classList.contains("check"))[0]?.textContent;
  return { model, library, files, roots, textarea, items, status, check, addViaForm, confirmClick };
}

/** Types into the textarea the way a browser would: value changes, then an input event. */
function type(area: FakeElement, text: string): void {
  area.value = text;
  area.fire("input");
}

beforeEach(() => {
  vi.useFakeTimers();
  dom = installFakeDom();
});
afterEach(async () => {
  await settle(); // A check still running would touch the DOM after it is gone.
  current = null;
  dom.uninstall();
  vi.useRealTimers();
});

describe("code editor views", () => {
  it("list the scripts by kind with their scenes once checked", async () => {
    const { items, roots, status } = await setup();
    expect(items()).toEqual(["input", "physics", "Player", "No scene setups"]);
    expect(roots.nav.byTag("h2").map((h) => h.textContent)).toEqual(["Systems", "Components", "Scene setups"]);
    expect(status()).toBe("Saved to projects/demo/scripts");
    expect(roots.top.textContent).toContain("Project: Demo");
    await settle();
    expect(items()).toEqual(["inputplay", "physicsall scenes", "Player", "No scene setups"]);
    expect(roots.help.byTag("details")).toHaveLength(6);
  });

  it("open a script, take typing as a draft, check it, and save with the button", async () => {
    const { model, library, files, roots, textarea, status, check, items } = await setup();
    await settle();
    expect(roots.editor.byTag("p")[0].hidden).toBe(false); // the placeholder
    roots.nav.byTag("li")[0].click();
    expect(model.selected).toEqual({ kind: "system", name: "input" });
    expect(textarea().value).toBe(defaults[1].code);
    expect(roots.editor.byTag("p")[0].hidden).toBe(true);
    expect(roots.editor.find((e) => e.classList.contains("gutter"))[0].textContent).toBe("1\n2\n3\n4");
    expect(check()).toContain("Runs in play");

    type(textarea(), "export default function ( {");
    expect(model.dirty).toBe(true);
    expect(status()).toBe("Unsaved changes");
    expect(items()[0]).toContain("unsaved");
    await settle();
    expect(check()).toMatch(/^SyntaxError/);
    expect(items()[0]).toContain("!");

    type(textarea(), `export default function input() {}\n`);
    await settle();
    expect(check()).toContain("Runs in every scene");

    roots.top.withText("Save")!.click();
    expect(model.dirty).toBe(false);
    expect(library.get("system", "input")?.code).toBe(`export default function input() {}\n`);
    expect(status()).toBe("Saving…");
    await settle();
    expect(status()).toBe("Saved to projects/demo/scripts");
    expect(files.codeOf("system", "input")).toBe(`export default function input() {}\n`);
    expect(items()[0]).toBe("inputall scenes");
  });

  it("indent with Tab and keep indentation on Enter through the textarea", async () => {
    const { roots, textarea, model } = await setup();
    roots.nav.byTag("li")[0].click();
    const area = textarea();
    area.value = "if (x) {";
    area.setSelectionRange(8, 8);
    const enter = area.fire("keydown", { key: "Enter" });
    expect(enter.defaultPrevented).toBe(true);
    expect(area.value).toBe("if (x) {\n  ");
    expect(model.text).toBe("if (x) {\n  ");
    area.fire("keydown", { key: "Tab" });
    expect(area.value).toBe("if (x) {\n    ");
    area.fire("keydown", { key: "Tab", shiftKey: true });
    expect(area.value).toBe("if (x) {\n  ");
    // Escape, then Tab, leaves the editor instead of indenting.
    area.fire("keydown", { key: "Escape" });
    const leave = area.fire("keydown", { key: "Tab" });
    expect(leave.defaultPrevented).toBe(false);
    expect(area.value).toBe("if (x) {\n  ");
    expect(area.fire("keydown", { key: "Tab" }).defaultPrevented).toBe(true);
  });

  it("add a system through the inline name form and remove it after confirming inline", async () => {
    const { roots, model, library, files, items, textarea, addViaForm, confirmClick } = await setup();
    // Opening the form focuses its input and hides the Add button meanwhile.
    roots.nav.withText("+ Add system")!.click();
    const input = roots.nav.byTag("form")[0].byTag("input")[0];
    expect(document.activeElement).toBe(input);
    expect(roots.nav.withText("+ Add system")).toBeUndefined();
    expect(roots.nav.withText("+ Add component")).toBeDefined();
    // Escape closes it.
    input.fire("keydown", { key: "Escape" });
    expect(roots.nav.byTag("form")).toHaveLength(0);
    expect(roots.nav.withText("+ Add system")).toBeDefined();

    addViaForm("system", " bounce ");
    expect(library.has("system", "bounce")).toBe(true);
    expect(model.selected).toEqual({ kind: "system", name: "bounce" });
    expect(textarea().value).toContain("function bounce(world, dt)");
    expect(items()).toContain("bounce");
    expect(files.codeOf("system", "bounce")).toBeUndefined(); // the write is on its way
    await settle();
    expect(files.codeOf("system", "bounce")).toContain("function bounce");
    expect(roots.nav.byTag("form")).toHaveLength(0);

    // A bad name is explained while typing and on submit, and not added.
    const bad = addViaForm("component", "2fast");
    expect(bad.form.find((e) => e.classList.contains("error"))[0].textContent).toContain("identifier");
    expect(document.activeElement).toBe(bad.input);
    bad.input.value = "Transform";
    bad.input.fire("input");
    expect(bad.form.find((e) => e.classList.contains("error"))[0].textContent).toContain("defines in code");
    bad.form.withText("Cancel")!.click();
    expect(library.ofKind("component")).toHaveLength(1);
    expect(roots.nav.byTag("form")).toHaveLength(0);

    confirmClick(roots.details, "Remove", false);
    expect(library.has("system", "bounce")).toBe(true);
    expect(roots.details.withText("Remove")).toBeDefined(); // back to the plain button
    confirmClick(roots.details, "Remove", true);
    expect(library.has("system", "bounce")).toBe(false);
    expect(model.selected).toBeNull();
    expect(roots.details.byTag("h2")).toHaveLength(0);
  });

  it("keeps the name being typed when the navigator is rebuilt", async () => {
    const { roots, model } = await setup();
    await settle();
    roots.nav.withText("+ Add component")!.click();
    const input = roots.nav.byTag("form")[0].byTag("input")[0];
    input.value = "Sp";
    input.fire("input");
    model.select({ kind: "system", name: "input" }); // rebuilds the navigator
    const again = roots.nav.byTag("form")[0].byTag("input")[0];
    expect(again).toBe(input);
    expect(again.value).toBe("Sp");
    expect(document.activeElement).toBe(input);
  });

  it("offers the engine's systems in the Add system form, and adds one as a ready-made script", async () => {
    const { roots, model, library, files, textarea } = await setup();
    await model.remove("system", "physics");
    roots.nav.withText("+ Add system")!.click();
    const form = roots.nav.byTag("form")[0];
    const picker = form.byTag("select")[0];
    const input = form.byTag("input")[0];
    expect(picker.children.map((option) => [option.textContent, option.disabled])).toEqual([
      ["New system…", false],
      ["physics (built in)", false],
    ]);
    expect(input.hidden).toBe(false);
    picker.value = "physics";
    picker.fire("change");
    expect(input.hidden).toBe(true);
    form.fire("submit");
    expect(library.has("system", "physics")).toBe(true);
    expect(model.selected).toEqual({ kind: "system", name: "physics" });
    expect(textarea().value).toContain('import { physics } from "engine";');
    expect(textarea().value).toContain("export default physics;");
    await settle();
    expect(files.codeOf("system", "physics")).toContain("export default physics;");
    expect(roots.nav.byTag("li").map((li) => li.textContent)).toContain("physicsall scenes");

    // Once added, the built-in is shown as such and can't be picked again; a custom name still can.
    roots.nav.withText("+ Add system")!.click();
    const again = roots.nav.byTag("form")[0];
    const options = again.byTag("select")[0].children;
    expect(options[1].textContent).toBe("physics (already in the project)");
    expect(options[1].disabled).toBe(true);
    expect(again.byTag("select")[0].value).toBe("");
    expect(again.byTag("input")[0].hidden).toBe(false);
  });

  it("lists a built-in system the project never added under Not running, without adding or disabling it first", async () => {
    const { roots, model, library, items } = await setup();
    await model.remove("system", "physics");
    expect(roots.nav.byTag("h3").map((h) => h.textContent)).toEqual(["Not running"]);
    expect(items()).toEqual(["input", "physicsbuilt in", "Player", "No scene setups"]);
    expect(roots.nav.withText("physicsbuilt in")!.title).toContain("Not in the project yet");

    // One click adds it, switched on, and it moves out of Not running into the systems list.
    roots.nav.withText("physicsbuilt in")!.click();
    await settle();
    expect(library.has("system", "physics")).toBe(true);
    expect(library.get("system", "physics")?.disabled).toBeUndefined();
    expect(model.selected).toEqual({ kind: "system", name: "physics" });
    expect(roots.nav.byTag("h3")).toHaveLength(0);
    expect(items()).toEqual(["inputplay", "physicsall scenes", "Player", "No scene setups"]);
  });

  it("disables a system from its details, lists it apart, and enables it again from the Add system form", async () => {
    const { roots, model, library, files, items } = await setup();
    roots.nav.byTag("li")[1].click(); // physics
    roots.details.withText("Disable")!.click();
    await settle();
    expect(library.get("system", "physics")?.disabled).toBe(true);
    expect(files.isDisabled("physics")).toBe(true);
    expect(files.codeOf("system", "physics")).toBeDefined();
    expect(roots.nav.byTag("h3").map((h) => h.textContent)).toEqual(["Not running"]);
    expect(items()).toEqual(["inputplay", "physicsoff", "Player", "No scene setups"]);
    expect(roots.details.withText("Enable")).toBeDefined();
    expect(roots.details.find((e) => e.classList.contains("muted"))[0].textContent).toContain("Disabled");

    // The Add system form offers it back; picking it enables it (no new file) and opens it.
    roots.nav.withText("+ Add system")!.click();
    const form = roots.nav.byTag("form")[0];
    const picker = form.byTag("select")[0];
    expect(picker.children.map((o) => o.textContent)).toEqual([
      "New system…",
      "physics (already in the project)",
      "physics (disabled; enable it again)",
    ]);
    picker.value = "enable:physics";
    picker.fire("change");
    form.fire("submit");
    await settle();
    expect(library.get("system", "physics")?.disabled).toBeUndefined();
    expect(files.calls.at(-1)).toBe("enable physics");
    expect(model.selected).toEqual({ kind: "system", name: "physics" });
    expect(roots.nav.byTag("h3")).toHaveLength(0);
    expect(items()).toEqual(["inputplay", "physicsall scenes", "Player", "No scene setups"]);
  });

  it("move from the details pane, writing the systems' order", async () => {
    const { roots, library, files } = await setup();
    roots.nav.byTag("li")[1].click(); // physics
    roots.details.withText("↑ Move up")!.click();
    expect(library.ofKind("system").map((s) => s.name)).toEqual(["physics", "input"]);
    roots.details.withText("↓ Move down")!.click();
    expect(library.ofKind("system").map((s) => s.name)).toEqual(["input", "physics"]);
    await settle();
    expect(files.calls.filter((call) => call.startsWith("order"))).toEqual([
      "order physics,input",
      "order input,physics",
    ]);
    const about = roots.details.find((e) => e.classList.contains("muted"))[0];
    expect(about.textContent).toContain("projects/demo/scripts/systems/physics.js");
  });

  it("shows a failed write in the status, and read-only mode without the dev server", async () => {
    const { roots, files, status, model } = await setup();
    files.failure = "disk full";
    roots.nav.byTag("li")[0].click();
    model.edit("changed");
    roots.top.withText("Save")!.click();
    await settle();
    expect(status()).toBe("Not saved: disk full");
    expect(model.dirty).toBe(true);

    const offline = new FakeScriptFiles(defaults);
    offline.reachable = false;
    const readOnly = await setup(offline);
    expect(readOnly.status()).toContain("Read-only");
    // The bundled fallback has no systems at all; physics (built in) still shows, inertly.
    expect(readOnly.items()).toEqual(["No systems", "physicsbuilt in", "Player", "No scene setups"]);
    expect(readOnly.roots.nav.withText("+ Add system")!.disabled).toBe(true);
    readOnly.roots.nav.withText("physicsbuilt in")!.click();
    expect(readOnly.library.has("system", "physics")).toBe(false); // not clickable while read-only
    readOnly.roots.nav.withText("Player")!.click();
    expect(readOnly.roots.details.withText("Remove")).toBeUndefined();
    const about = readOnly.roots.details.find((e) => e.classList.contains("muted"))[0];
    expect(about.textContent).toContain("read-only");
  });

  it("offers to import scripts an older version kept in the browser, once", async () => {
    const { library, files } = await setup();
    const root = new FakeElement("p");
    const storage = new MemoryStorage();
    const legacy = [{ kind: "system", name: "input", code: "mine" }, { kind: "system", name: "old", code: "x" }];
    storage.setItem(LEGACY_KEY, JSON.stringify({ version: 1, scripts: legacy }));
    mountMigration(root as unknown as HTMLElement, library, storage);
    expect(root.textContent).toContain("2 scripts saved in this browser");
    root.withText("Import")!.click();
    await settle();
    expect(files.codeOf("system", "input")).toBe("mine");
    expect(files.codeOf("system", "old")).toBe("x");
    expect(library.ofKind("system").map((s) => s.name)).toEqual(["input", "old", "physics"]);
    expect(storage.getItem(LEGACY_KEY)).toBeNull();
    expect(root.children).toHaveLength(0);

    // Discarding forgets them; nothing stored means nothing shown; broken storage is dropped.
    storage.setItem(LEGACY_KEY, JSON.stringify({ version: 1, scripts: legacy }));
    mountMigration(root as unknown as HTMLElement, library, storage);
    root.withText("Discard them")!.click();
    expect(storage.getItem(LEGACY_KEY)).toBeNull();
    mountMigration(root as unknown as HTMLElement, library, storage);
    expect(root.children).toHaveLength(0);
    storage.setItem(LEGACY_KEY, "{broken");
    mountMigration(root as unknown as HTMLElement, library, storage);
    expect(root.children).toHaveLength(0);
    expect(storage.getItem(LEGACY_KEY)).toBeNull();
  });

  it("colors the code in a copy that always matches the textarea", async () => {
    const { roots, textarea } = await setup();
    const colored = () => roots.editor.find((e) => e.classList.contains("highlight"))[0];
    const kinds = () =>
      colored()
        .children.filter((child) => child.tagName === "span")
        .map((span) => [span.className, span.textContent]);

    roots.nav.byTag("li")[0].click(); // input
    // The code ends with a newline, so the copy gets a space to give the last line height.
    expect(colored().textContent).toBe(textarea().value + " ");
    expect(kinds()).toContainEqual(["tok-keyword", "import"]);
    expect(kinds()).toContainEqual(["tok-type", "Player"]);
    expect(kinds()).toContainEqual(["tok-string", '"components/Player"']);
    expect(kinds()).toContainEqual(["tok-function", "input"]);

    type(textarea(), "const n = 42; // six times seven");
    expect(colored().textContent).toBe("const n = 42; // six times seven");
    expect(kinds()).toEqual([
      ["tok-keyword", "const"],
      ["tok-operator", "="],
      ["tok-number", "42"],
      ["tok-punctuation", ";"],
      ["tok-comment", "// six times seven"],
    ]);

    // Opening another script recolors too.
    roots.nav.byTag("li")[2].click(); // Player
    expect(colored().textContent).toBe(defaults[0].code + " ");
    expect(kinds()).toContainEqual(["tok-type", "Player"]);
  });

  it("keeps the colored copy and the line numbers scrolled with the textarea", async () => {
    const { roots, textarea } = await setup();
    roots.nav.byTag("li")[0].click();
    const area = textarea();
    area.scrollTop = 120;
    area.scrollLeft = 30;
    area.fire("scroll");
    const colored = roots.editor.find((e) => e.classList.contains("highlight"))[0];
    const gutter = roots.editor.find((e) => e.classList.contains("gutter"))[0];
    expect([colored.scrollTop, colored.scrollLeft, gutter.scrollTop]).toEqual([120, 30, 120]);
  });

  it("marks the caret's line, following the caret and the scroll", async () => {
    const { roots, textarea } = await setup();
    roots.nav.byTag("li")[0].click();
    const area = textarea();
    const marker = roots.editor.find((e) => e.classList.contains("current-line"))[0];
    // 8px padding, 20px lines (the defaults when no stylesheet can be read).
    area.setSelectionRange(0, 0);
    area.fire("keyup");
    expect(marker.style).toMatchObject({ top: "8px", height: "20px" });
    const thirdLine = area.value.split("\n").slice(0, 2).join("\n").length + 1;
    area.setSelectionRange(thirdLine, thirdLine);
    area.fire("mouseup");
    expect(marker.style.top).toBe("48px");
    area.scrollTop = 20;
    area.fire("scroll");
    expect(marker.style.top).toBe("28px");
  });

  it("colors the help's code samples like the editor", async () => {
    const { roots } = await setup();
    const sample = roots.help.find((e) => e.classList.contains("sample"))[0];
    expect(sample.byTag("span").map((span) => span.className)).toContain("tok-keyword");
    expect(sample.textContent).toContain('export const scenes = ["title", "play"];');
  });

  describe("suggestions", () => {
    /** Types `text` at the end of the textarea, one input event, caret at the end. */
    function typeAtEnd(area: FakeElement, text: string) {
      area.value += text;
      area.setSelectionRange(area.value.length, area.value.length);
      area.fire("input");
    }
    const popupOf = (root: FakeElement) => root.find((e) => e.classList.contains("suggest"))[0];
    const shown = (root: FakeElement) => {
      const popup = popupOf(root);
      return popup.hidden ? null : popup.byTag("li").map((li) => li.byTag("span")[0].textContent);
    };
    const selectedIn = (root: FakeElement) =>
      popupOf(root).byTag("li").findIndex((li) => li.classList.contains("selected"));

    it("pop up while typing a word, and Enter completes it through the textarea", async () => {
      const { roots, textarea, model } = await setup();
      roots.nav.byTag("li")[0].click();
      const area = textarea();
      area.value = "";
      area.fire("input");
      expect(shown(roots.editor)).toBeNull();
      typeAtEnd(area, "import { Keyb");
      expect(shown(roots.editor)).toEqual(["Keyboard"]);
      expect(popupOf(roots.editor).byTag("li")[0].byTag("span")[1].textContent).toBe("engine");
      const enter = area.fire("keydown", { key: "Enter" });
      expect(enter.defaultPrevented).toBe(true);
      expect(area.value).toBe("import { Keyboard");
      expect(area.selectionStart).toBe("import { Keyboard".length);
      expect(model.text).toBe("import { Keyboard");
      expect(shown(roots.editor)).toBeNull();
    });

    it("let Up/Down choose, Tab accept, and show members after a dot", async () => {
      const { roots, textarea } = await setup();
      roots.nav.byTag("li")[0].click();
      const area = textarea();
      area.value = "";
      area.fire("input");
      typeAtEnd(area, "world.");
      const members = shown(roots.editor)!;
      expect(members.length).toBeGreaterThan(3);
      expect(members).toContain("query");
      expect(selectedIn(roots.editor)).toBe(0);
      area.fire("keydown", { key: "ArrowDown" });
      area.fire("keydown", { key: "ArrowDown" });
      expect(selectedIn(roots.editor)).toBe(2);
      area.fire("keydown", { key: "ArrowUp" });
      expect(selectedIn(roots.editor)).toBe(1);
      const tab = area.fire("keydown", { key: "Tab" });
      expect(tab.defaultPrevented).toBe(true);
      expect(area.value).toBe(`world.${members[1]}`);
    });

    it("are dismissed by Escape until the word changes, and Escape then still lets Tab leave", async () => {
      const { roots, textarea } = await setup();
      roots.nav.byTag("li")[0].click();
      const area = textarea();
      area.value = "";
      area.fire("input");
      typeAtEnd(area, "const p = Pla");
      expect(shown(roots.editor)).toContain("Player");
      area.fire("keydown", { key: "Escape" });
      expect(shown(roots.editor)).toBeNull();
      // Retyping the same word keeps them away; a longer word brings them back.
      area.fire("input");
      expect(shown(roots.editor)).toBeNull();
      typeAtEnd(area, "y");
      expect(shown(roots.editor)).toContain("Player");
      area.fire("keydown", { key: "Escape" });
      // With nothing open, Escape then Tab moves the focus on instead of indenting.
      area.fire("keydown", { key: "Escape" });
      expect(area.fire("keydown", { key: "Tab" }).defaultPrevented).toBe(false);
    });

    it("open on Ctrl+Space even for a short word, and close when the caret moves away", async () => {
      const { roots, textarea } = await setup();
      roots.nav.byTag("li")[0].click();
      const area = textarea();
      area.value = "";
      area.fire("input");
      typeAtEnd(area, "K");
      expect(shown(roots.editor)).toBeNull();
      const open = area.fire("keydown", { key: " ", ctrlKey: true });
      expect(open.defaultPrevented).toBe(true);
      expect(shown(roots.editor)).toContain("Keyboard");
      area.setSelectionRange(0, 0);
      area.fire("keyup");
      expect(shown(roots.editor)).toBeNull();
    });

    it("sit under the word, following the textarea's scroll", async () => {
      const { roots, textarea } = await setup();
      roots.nav.byTag("li")[0].click();
      const area = textarea();
      area.value = "x\n";
      area.fire("input");
      typeAtEnd(area, "  Keyb");
      const popup = popupOf(roots.editor);
      // Line 2 (index 1): 8px padding + 20px, below it: 48px. Column 2: 10px + 2 * 7.8px.
      expect(popup.style.top).toBe("48px");
      expect(popup.style.left).toBe(`${10 + 2 * 7.8}px`);
      area.scrollTop = 10;
      area.fire("scroll");
      expect(popup.style.top).toBe("38px");
    });

    it("complete script paths inside an import string", async () => {
      const { roots, textarea } = await setup();
      roots.nav.byTag("li")[0].click(); // systems/input
      const area = textarea();
      area.value = "";
      area.fire("input");
      typeAtEnd(area, `import Player from "`);
      expect(shown(roots.editor)).toEqual(["engine", "components/Player", "systems/physics"]);
      area.fire("keydown", { key: "ArrowDown" });
      area.fire("keydown", { key: "Enter" });
      expect(area.value).toBe(`import Player from "components/Player`);
    });
  });

  it("open the game and the scene editor in new tabs", async () => {
    const { roots } = await setup();
    roots.top.withText("Play")!.click();
    roots.top.withText("Scene editor")!.click();
    expect(dom.opened).toEqual(["/?project=demo", "/editor.html?project=demo"]);
  });
});
