import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ProjectsClient } from "../../src/dev-api/projects";
import { ImageLibrary } from "../../src/editor/image-library";
import type { LegacyContent } from "../../src/editor/legacy-storage";
import { EditorModel } from "../../src/editor/model";
import { ProjectLibrary } from "../../src/editor/project-library";
import { mountMigration } from "../../src/editor/views/migration";
import { mountProjectBar } from "../../src/editor/views/project-bar";
import { mountTopBar } from "../../src/editor/views/top-bar";
import {
  Assets,
  formatProjectSettings,
  formatSceneData,
  newProjectSettings,
  type ProjectFile,
  type ProjectSettings,
} from "../../src/engine";
import { FakeElement, installFakeDom } from "../helpers/fake-dom";
import { FakeImageFiles } from "../helpers/fake-image-files";
import { FakeSceneFiles } from "../helpers/fake-scene-files";

/** Smoke tests over a tiny fake DOM for the scene editor's project and scene controls. */
const settings: ProjectSettings = {
  ...newProjectSettings("Test"),
  width: 200,
  height: 100,
  scenes: ["main", "other"],
  firstScene: "main",
};

/** Stands in for the dev server's projects: settings text per id, every call logged. */
class FakeProjects implements ProjectsClient {
  readonly files = new Map<string, string>();
  readonly calls: string[] = [];
  reachable = true;
  constructor(initial: Record<string, ProjectSettings>) {
    for (const [id, value] of Object.entries(initial)) this.files.set(id, formatProjectSettings(value));
  }
  async load(): Promise<ProjectFile[]> {
    this.calls.push("load");
    if (!this.reachable) throw new Error("/api/projects is not there");
    return [...this.files].map(([id, text]) => ({ id, text }));
  }
  async create(id: string, name: string): Promise<void> {
    this.calls.push(`create ${id}`);
    this.files.set(id, formatProjectSettings(newProjectSettings(name)));
  }
  async remove(id: string): Promise<void> {
    this.calls.push(`remove ${id}`);
    this.files.delete(id);
  }
  async writeSettings(id: string, next: ProjectSettings): Promise<void> {
    this.calls.push(`settings ${id}`);
    this.files.set(id, formatProjectSettings(next));
  }
}

let dom: ReturnType<typeof installFakeDom>;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

async function setup(options: { reachable?: boolean } = {}) {
  const sceneFiles = new FakeSceneFiles({ main: formatSceneData({ version: 1, entities: [] }) });
  sceneFiles.reachable = options.reachable ?? true;
  const written: ProjectSettings[] = [];
  const model = new EditorModel({
    settings,
    files: sceneFiles,
    fallback: async () => [{ name: "main", text: formatSceneData({ version: 1, entities: [] }) }],
    writeSettings: async (next) => {
      written.push(next);
    },
  });
  await model.load();
  const imageFiles = new FakeImageFiles();
  imageFiles.reachable = options.reachable ?? true;
  const library = new ImageLibrary({
    files: imageFiles,
    fallback: async () => [],
    assets: new Assets(async () => ({ width: 8, height: 8 }) as HTMLImageElement),
  });
  await library.load();
  const top = new FakeElement("header");
  mountTopBar(top as unknown as HTMLElement, model, "demo");
  const status = () => top.find((e) => e.classList.contains("status"))[0].textContent;
  const sceneOptions = () => top.byTag("select")[0].children.map((option) => option.textContent);
  return { model, library, sceneFiles, imageFiles, written, top, status, sceneOptions };
}

/** Types into an input the way a browser would: value changes, then an input event. */
function type(input: FakeElement, text: string): void {
  input.value = text;
  input.fire("input");
}

beforeEach(() => {
  dom = installFakeDom();
});
afterEach(() => {
  dom.uninstall();
});

describe("scene editor top bar", () => {
  it("shows the scenes with the start one marked, where they are saved, and follows the save status", async () => {
    const { model, top, status, sceneOptions } = await setup();
    expect(sceneOptions()).toEqual(["main (start)", "other"]);
    expect(top.withText("Reset to default")).toBeUndefined();
    expect(status()).toBe("Saved to projects/demo");
    model.addEntity();
    expect(status()).toBe("Saving…");
    await settle();
    expect(status()).toBe("Saved to projects/demo");
  });

  it("adds a scene through the inline form, checking the name first", async () => {
    const { model, top, sceneOptions } = await setup();
    top.withText("+ Add scene")!.click();
    const form = top.byTag("form")[0];
    const input = form.byTag("input")[0];
    type(input, "main");
    expect(form.find((e) => e.classList.contains("error"))[0].textContent).toContain("already a scene");
    form.fire("submit");
    expect(model.sceneNames).toEqual(["main", "other"]);
    type(input, "level1");
    form.fire("submit");
    expect(model.sceneNames).toEqual(["main", "other", "level1"]);
    expect(model.scene).toBe("level1");
    expect(sceneOptions()).toEqual(["main (start)", "other", "level1"]);
    expect(top.byTag("form")).toHaveLength(0);
  });

  it("removes the open scene after asking, and makes it the start scene on request", async () => {
    const { model, top, written } = await setup();
    expect(top.withText("Start here")!.disabled).toBe(true); // main already is
    model.openScene("other");
    top.withText("Start here")!.click();
    expect(model.firstScene).toBe("other");
    top.withText("Remove scene")!.click();
    expect(top.textContent).toContain('Remove the scene "other"');
    top.withText("Yes")!.click();
    expect(model.sceneNames).toEqual(["main"]);
    expect(model.scene).toBe("main");
    expect(top.withText("Remove scene")!.disabled).toBe(true); // the last scene stays
    await settle();
    expect(written.map((s) => s.firstScene)).toEqual(["other", "main"]);
  });

  it("says so and disables the scene controls when the files can't be reached", async () => {
    const { top, status } = await setup({ reachable: false });
    expect(status()).toContain("Read-only");
    expect(top.withText("+ Add scene")!.disabled).toBe(true);
    expect(top.withText("Remove scene")!.disabled).toBe(true);
  });
});

describe("project bar", () => {
  async function projectBar(options: { current?: string | null; reachable?: boolean } = {}) {
    const client = new FakeProjects({ demo: { ...settings, name: "Demo" }, zoo: { ...settings, name: "" } });
    client.reachable = options.reachable ?? true;
    const library = new ProjectLibrary(client, async () => [{ id: "bundled", text: formatProjectSettings(settings) }]);
    await library.load();
    const root = new FakeElement("header");
    const navigated: (string | null)[] = [];
    mountProjectBar(root as unknown as HTMLElement, library, {
      currentId: options.current === undefined ? "demo" : options.current,
      navigate: (id) => navigated.push(id),
    });
    const picker = () => root.byTag("select")[0];
    return { client, library, root, navigated, picker };
  }

  it("lists the projects by name, with the current one picked, and goes to a picked one", async () => {
    const { root, picker, navigated } = await projectBar();
    expect(picker().children.map((option) => option.textContent)).toEqual(["Demo", "zoo"]);
    expect(picker().value).toBe("demo");
    picker().value = "zoo";
    picker().fire("change");
    expect(navigated).toEqual(["zoo"]);
    expect(root.withText("Delete project")).toBeDefined();
  });

  it("offers a pick when there is no current project, and only New project when there are none", async () => {
    const none = await projectBar({ current: null });
    expect(none.picker().value).toBe("");
    expect(none.root.withText("Delete project")).toBeUndefined();
    const missing = await projectBar({ current: "gone" });
    expect(missing.picker().children.map((o) => o.textContent)).toContain("(pick a project)");
  });

  it("makes a project from a name through the inline form, then goes to it", async () => {
    const { root, client, navigated } = await projectBar();
    root.withText("New project")!.click();
    const form = root.byTag("form")[0];
    const input = form.byTag("input")[0];
    type(input, "My Game!");
    expect(form.find((e) => e.classList.contains("muted"))[0].textContent).toBe("projects/my-game");
    type(input, "Demo");
    expect(form.find((e) => e.classList.contains("error"))[0].textContent).toContain("already a project");
    form.fire("submit");
    expect(client.calls.filter((call) => call.startsWith("create"))).toEqual([]);
    type(input, "My Game!");
    form.fire("submit");
    await settle();
    await settle();
    expect(client.calls).toContain("create my-game");
    expect(client.files.get("my-game")).toContain('"name": "My Game!"');
    expect(navigated).toEqual(["my-game"]);
  });

  it("deletes the current project after asking, then leaves it", async () => {
    const { root, client, navigated } = await projectBar();
    root.withText("Delete project")!.click();
    expect(root.textContent).toContain('Delete the project "Demo" and all its files?');
    root.withText("Cancel")!.click();
    expect(client.calls).not.toContain("remove demo");
    root.withText("Delete project")!.click();
    root.withText("Yes")!.click();
    await settle();
    await settle();
    expect(client.calls).toContain("remove demo");
    expect(navigated).toEqual([null]);
  });

  it("shows the bundled projects, read-only, without the dev server", async () => {
    const { root, library, picker } = await projectBar({ reachable: false, current: "bundled" });
    expect(library.available).toBe(false);
    expect(picker().children.map((o) => o.textContent)).toEqual(["Test"]);
    expect(root.withText("New project")!.disabled).toBe(true);
    expect(root.withText("Delete project")!.disabled).toBe(true);
    expect(root.textContent).toContain("start the dev server");
  });
});

describe("migration", () => {
  const png = new Blob(["x"], { type: "image/png" });
  function legacy(): LegacyContent & { forgotten: number } {
    const content = {
      scenes: [{ name: "main", text: JSON.stringify({ version: 1, entities: [{ name: "Old", components: {} }] }) }],
      images: [{ name: "coin", file: png, sheet: null }],
      forgotten: 0,
      async forget() {
        content.forgotten++;
      },
    };
    return content;
  }

  it("offers to import what an older version kept in the browser, once", async () => {
    const { model, library, sceneFiles, imageFiles } = await setup();
    const root = new FakeElement("p");
    const content = legacy();
    mountMigration(root as unknown as HTMLElement, model, library, content);
    expect(root.textContent).toContain("1 scene and 1 image saved in this browser");
    root.withText("Import")!.click();
    await settle();
    await settle();
    expect(sceneFiles.dataOf("main")!.entities[0].name).toBe("Old");
    expect(model.data.entities[0].name).toBe("Old");
    expect(imageFiles.images.has("coin")).toBe(true);
    expect(library.names).toEqual(["coin"]);
    expect(content.forgotten).toBe(1);
    expect(root.children).toHaveLength(0);
  });

  it("can discard them instead, and shows nothing when there is nothing or no way to write", async () => {
    const { model, library } = await setup();
    const root = new FakeElement("p");
    const content = legacy();
    mountMigration(root as unknown as HTMLElement, model, library, content);
    root.withText("Discard them")!.click();
    expect(content.forgotten).toBe(1);
    expect(root.children).toHaveLength(0);
    mountMigration(root as unknown as HTMLElement, model, library, null);
    expect(root.children).toHaveLength(0);

    const readOnly = await setup({ reachable: false });
    mountMigration(root as unknown as HTMLElement, readOnly.model, readOnly.library, legacy());
    expect(root.children).toHaveLength(0);
  });

  it("reports an import that fails and lets the user try again", async () => {
    const { model, library, sceneFiles } = await setup();
    const root = new FakeElement("p");
    const content = legacy();
    content.scenes[0].text = "{oops";
    mountMigration(root as unknown as HTMLElement, model, library, content);
    root.withText("Import")!.click();
    await settle();
    expect(root.textContent).toContain("Couldn't import: Scene data is not valid JSON");
    expect(root.withText("Import")!.disabled).toBe(false);
    expect(content.forgotten).toBe(0);
    expect(sceneFiles.calls).toEqual(["load"]);
  });
});
