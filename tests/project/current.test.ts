import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectsClient } from "../../src/dev-api/projects";
import { formatProjectSettings, newProjectSettings, type ProjectFile } from "../../src/engine";
import { currentProject, readProjectFiles, settingsOf } from "../../src/project/current";
import { rememberProjectId } from "../../src/project/page";
import { MemoryStorage } from "../helpers/memory-storage";

afterEach(() => {
  vi.unstubAllGlobals();
});

function client(files: ProjectFile[] | null): ProjectsClient {
  return {
    async load() {
      if (files === null) throw new Error("/api/projects is not there");
      return files;
    },
    create: async () => {},
    remove: async () => {},
    writeSettings: async () => {},
  };
}

const zoo = { id: "zoo", text: formatProjectSettings(newProjectSettings("Zoo")) };
const abc = { id: "abc", text: formatProjectSettings(newProjectSettings("")) };

describe("currentProject", () => {
  it("is the URL's project, or else the first one, with its settings", async () => {
    expect(await currentProject("?project=zoo", client([zoo, abc]))).toMatchObject({
      id: "zoo",
      settings: { name: "Zoo" },
      readOnly: false,
    });
    expect((await currentProject("", client([zoo, abc])))?.id).toBe("abc");
    expect(await currentProject("", client([]))).toBeNull();
  });

  it("opens the project remembered from the scene editor over the first by id", async () => {
    vi.stubGlobal("localStorage", new MemoryStorage());
    rememberProjectId("zoo");
    expect((await currentProject("", client([zoo, abc])))?.id).toBe("zoo");
    expect((await currentProject("?project=abc", client([zoo, abc])))?.id).toBe("abc"); // the URL still wins
  });

  it("throws for a project that is not there or whose settings are broken", async () => {
    await expect(currentProject("?project=nope", client([zoo]))).rejects.toThrow('There is no project "nope" (the projects are zoo)');
    await expect(currentProject("?project=bad", client([{ id: "bad", text: "{oops" }]))).rejects.toThrow(
      /^projects\/bad\/project\.json: not valid JSON/,
    );
    expect(() => settingsOf({ id: "x", text: "{}" })).toThrow("projects/x/project.json: ");
  });

  it("falls back to the bundled projects, read-only, without the dev server", async () => {
    const { files, readOnly } = await readProjectFiles(client(null));
    expect(readOnly).toBe(true);
    expect(files.map((file) => file.id)).toEqual(["demo"]);
    expect(await currentProject("", client(null))).toMatchObject({ id: "demo", readOnly: true });
  });
});
