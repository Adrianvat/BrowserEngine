import { describe, expect, it } from "vitest";
import type { ProjectsClient } from "../../src/dev-api/projects";
import { ProjectLibrary, READ_ONLY } from "../../src/editor/project-library";
import { formatProjectSettings, newProjectSettings, type ProjectFile, type ProjectSettings } from "../../src/engine";

class FakeProjects implements ProjectsClient {
  readonly files = new Map<string, string>();
  readonly calls: string[] = [];
  reachable = true;
  constructor(initial: Record<string, string>) {
    for (const [id, text] of Object.entries(initial)) this.files.set(id, text);
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
  async writeSettings(id: string, settings: ProjectSettings): Promise<void> {
    this.calls.push(`settings ${id}`);
    this.files.set(id, formatProjectSettings(settings));
  }
}

const demo = formatProjectSettings(newProjectSettings("Demo"));

describe("ProjectLibrary", () => {
  it("lists the projects with their names, keeping one whose settings are broken", async () => {
    const client = new FakeProjects({ demo, unnamed: formatProjectSettings(newProjectSettings("")), bad: "{oops" });
    const library = new ProjectLibrary(client);
    await library.load();
    expect(library.entries.map((entry) => [entry.id, entry.name, entry.error === null])).toEqual([
      ["demo", "Demo", true],
      ["unnamed", "unnamed", true],
      ["bad", "bad", false],
    ]);
    expect(library.get("bad")?.error).toMatch(/not valid JSON/);
    expect(library.ids).toEqual(["demo", "unnamed", "bad"]);
    expect(library.available).toBe(true);
    expect(library.loadError).toBeNull();
  });

  it("creates and removes projects, checking ids first, and tells listeners", async () => {
    const client = new FakeProjects({ demo });
    const library = new ProjectLibrary(client);
    let changes = 0;
    library.onChange(() => changes++);
    await library.load();
    expect(library.idProblem("demo")).toBe('There is already a project "demo"');
    expect(library.idProblem("my game")).toContain("letters, digits");
    expect(library.idProblem("my-game")).toBeNull();
    await expect(library.create("demo", "x")).rejects.toThrow("already a project");
    await library.create("my-game", "My Game");
    expect(library.get("my-game")?.name).toBe("My Game");
    await library.remove("demo");
    expect(library.ids).toEqual(["my-game"]);
    await expect(library.remove("demo")).rejects.toThrow('There is no project "demo"');
    expect(client.calls).toEqual(["load", "create my-game", "load", "remove demo", "load"]);
    expect(changes).toBe(3);
  });

  it("shows the bundled projects read-only without the dev server, or reports no projects at all", async () => {
    const client = new FakeProjects({ demo });
    client.reachable = false;
    const library = new ProjectLibrary(client, async () => [{ id: "bundled", text: demo }]);
    await library.load();
    expect(library.available).toBe(false);
    expect(library.ids).toEqual(["bundled"]);
    await expect(library.create("x", "x")).rejects.toThrow(READ_ONLY);
    await expect(library.remove("bundled")).rejects.toThrow(READ_ONLY);

    const none = new ProjectLibrary(client);
    await none.load();
    expect(none.loadError).toBe("/api/projects is not there");
    expect(none.ids).toEqual([]);
  });
});
