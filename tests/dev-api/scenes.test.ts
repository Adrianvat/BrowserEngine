import { describe, expect, it } from "vitest";
import { ScenesApi, validateSceneFiles } from "../../src/dev-api/scenes";

/** A fetch that answers from a script, recording every request. */
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

const data = { version: 1 as const, entities: [] };

describe("ScenesApi", () => {
  it("loads the scene files from GET", async () => {
    const scenes = [{ name: "play", text: "{}" }];
    const { fetchFn, requests } = fakeFetch(() => json(200, { version: 1, scenes }));
    const api = new ScenesApi("/api/scenes", fetchFn);
    expect(await api.load()).toEqual(scenes);
    expect(requests).toEqual([{ method: "GET", url: "/api/scenes", body: undefined }]);
  });

  it("writes with the right route and body", async () => {
    const { fetchFn, requests } = fakeFetch(() => json(200, { ok: true }));
    await new ScenesApi("/api/scenes", fetchFn).write("play", data);
    expect(requests).toEqual([{ method: "PUT", url: "/api/scenes/play", body: JSON.stringify({ data }) }]);
  });

  it("turns the server's error into a thrown one, and explains when there is no server", async () => {
    const { fetchFn } = fakeFetch(() => json(400, { error: "nope" }));
    await expect(new ScenesApi("/api/scenes", fetchFn).write("play", data)).rejects.toThrow("nope");
    const page = fakeFetch(() => new Response("<!doctype html>", { status: 200, headers: { "Content-Type": "text/html" } }));
    await expect(new ScenesApi("/api/scenes", page.fetchFn).load()).rejects.toThrow(
      "/api/scenes is not there; is this the dev server (npm run dev)?",
    );
  });

  it("rejects a malformed answer", () => {
    expect(() => validateSceneFiles({ version: 1, scenes: [{ name: "a/b", text: "" }] })).toThrow("something other than scene files");
    expect(() => validateSceneFiles({ version: 2, scenes: [] })).toThrow();
    expect(() => validateSceneFiles(null)).toThrow();
    expect(validateSceneFiles({ version: 1, scenes: [{ name: "play", text: "x", extra: 1 }] })).toEqual([{ name: "play", text: "x" }]);
  });
});
