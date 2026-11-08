import { afterEach, describe, expect, it, vi } from "vitest";
import {
  defaultProjectId,
  pageUrl,
  projectIdFromName,
  projectIdFromSearch,
  rememberedProjectId,
  rememberProjectId,
  resolveProjectId,
} from "../../src/project/page";
import { MemoryStorage } from "../helpers/memory-storage";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("project pages", () => {
  it("reads the project from the URL, ignoring ids that could be paths", () => {
    expect(projectIdFromSearch("?project=demo&image=hero")).toBe("demo");
    expect(projectIdFromSearch("?image=hero")).toBeNull();
    expect(projectIdFromSearch("?project=../x")).toBeNull();
    expect(projectIdFromSearch("")).toBeNull();
  });

  it("opens the first project by id when the URL names none", () => {
    expect(defaultProjectId(["zoo", "demo"])).toBe("demo");
    expect(defaultProjectId([])).toBeNull();
  });

  it("makes page URLs that carry the project along", () => {
    expect(pageUrl("/editor.html", "demo")).toBe("/editor.html?project=demo");
    expect(pageUrl("/sprite-editor.html", "demo", { image: "slime sheet" })).toBe("/sprite-editor.html?image=slime+sheet&project=demo");
    expect(pageUrl("/", null)).toBe("/");
  });

  it("makes an id from a name", () => {
    expect(projectIdFromName("My Game!")).toBe("my-game");
    expect(projectIdFromName("  ")).toBe("");
  });
});

describe("remembering the scene editor's project", () => {
  it("remembers a project, and forgets it once it no longer exists", () => {
    const storage = new MemoryStorage();
    vi.stubGlobal("localStorage", storage);
    expect(rememberedProjectId(["demo", "zoo"])).toBeNull();
    rememberProjectId("zoo");
    expect(storage.getItem("browser-engine:current-project")).toBe("zoo");
    expect(rememberedProjectId(["demo", "zoo"])).toBe("zoo");
    expect(rememberedProjectId(["demo"])).toBeNull(); // zoo was deleted, say
  });

  it("does nothing without browser storage (private browsing, a sandboxed frame)", () => {
    expect(() => rememberProjectId("demo")).not.toThrow();
    expect(rememberedProjectId(["demo"])).toBeNull();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("Access denied");
      },
    });
    expect(() => rememberProjectId("demo")).not.toThrow();
    expect(rememberedProjectId(["demo"])).toBeNull();
  });

  it("resolveProjectId prefers the URL, then the remembered project, then the first by id", () => {
    const storage = new MemoryStorage();
    vi.stubGlobal("localStorage", storage);
    expect(resolveProjectId("", ["demo", "zoo"])).toBe("demo"); // nothing remembered yet
    rememberProjectId("zoo");
    expect(resolveProjectId("", ["demo", "zoo"])).toBe("zoo");
    expect(resolveProjectId("?project=demo", ["demo", "zoo"])).toBe("demo"); // the URL wins
    expect(resolveProjectId("?project=nope", ["demo", "zoo"])).toBe("nope"); // left for the caller to reject
    expect(resolveProjectId("", [])).toBeNull();
  });
});
