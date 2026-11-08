import { describe, expect, it } from "vitest";
import { projectApiBase, ProjectsApi, validateProjectFiles } from "../../src/dev-api/projects";
import { newProjectSettings } from "../../src/engine";

function fakeFetch(answer: (method: string, url: string, body: string | undefined) => Response) {
  const requests: { method: string; url: string; body: string | undefined }[] = [];
  const fetchFn: typeof fetch = async (input, init) => {
    const request = { method: init?.method ?? "GET", url: String(input), body: init?.body as string | undefined };
    requests.push(request);
    return answer(request.method, request.url, request.body);
  };
  return { fetchFn, requests };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("ProjectsApi", () => {
  it("loads the project files from GET", async () => {
    const projects = [{ id: "demo", text: "{}" }];
    const { fetchFn, requests } = fakeFetch(() => json(200, { version: 1, projects }));
    expect(await new ProjectsApi("/api/projects", fetchFn).load()).toEqual(projects);
    expect(requests).toEqual([{ method: "GET", url: "/api/projects", body: undefined }]);
  });

  it("creates, removes and writes settings with the right routes and bodies", async () => {
    const { fetchFn, requests } = fakeFetch(() => json(200, { ok: true }));
    const api = new ProjectsApi("/api/projects", fetchFn);
    const settings = newProjectSettings("X");
    await api.create("x", "X");
    await api.writeSettings("x", settings);
    await api.remove("x");
    expect(requests).toEqual([
      { method: "POST", url: "/api/projects", body: JSON.stringify({ id: "x", name: "X" }) },
      { method: "PUT", url: "/api/projects/x/settings", body: JSON.stringify({ settings }) },
      { method: "DELETE", url: "/api/projects/x", body: undefined },
    ]);
  });

  it("rejects a malformed answer, and names each project folder's API", () => {
    expect(validateProjectFiles({ version: 1, projects: [{ id: "demo", text: "{}", more: 1 }] })).toEqual([{ id: "demo", text: "{}" }]);
    expect(() => validateProjectFiles({ version: 1, projects: [{ id: "a/b", text: "" }] })).toThrow("something other than project files");
    expect(() => validateProjectFiles(null)).toThrow();
    expect(projectApiBase("demo", "images")).toBe("/api/projects/demo/images");
  });
});
