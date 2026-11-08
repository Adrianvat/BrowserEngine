import { describe, it, expect } from "vitest";
import { ScriptsApi } from "../../src/dev-api/scripts";

/** A fetch that answers from a script, recording every request. */
function fakeFetch(answer: (method: string, url: string, body: string | undefined) => Response | Promise<Response>) {
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

describe("ScriptsApi", () => {
  it("loads the script set from GET", async () => {
    const scripts = [{ kind: "system", name: "a", code: "x" }];
    const { fetchFn, requests } = fakeFetch(() => json(200, { version: 1, scripts }));
    const api = new ScriptsApi("/api/scripts", fetchFn);
    expect(await api.load()).toEqual(scripts);
    expect(requests).toEqual([{ method: "GET", url: "/api/scripts", body: undefined }]);
  });

  it("writes, removes and orders with the right routes and bodies", async () => {
    const { fetchFn, requests } = fakeFetch(() => json(200, { ok: true }));
    const api = new ScriptsApi("/api/scripts", fetchFn);
    await api.write("system", "kick", "code");
    await api.remove("component", "Player");
    await api.setOrder(["b", "a"]);
    await api.setEnabled("kick", false);
    expect(requests).toEqual([
      { method: "PUT", url: "/api/scripts/systems/kick", body: JSON.stringify({ code: "code" }) },
      { method: "DELETE", url: "/api/scripts/components/Player", body: undefined },
      { method: "PUT", url: "/api/scripts/order", body: JSON.stringify({ systems: ["b", "a"] }) },
      { method: "PUT", url: "/api/scripts/systems/kick/enabled", body: JSON.stringify({ enabled: false }) },
    ]);
  });

  it("turns the server's error into a thrown one", async () => {
    const { fetchFn } = fakeFetch(() => json(400, { error: '"code" must be a string' }));
    await expect(new ScriptsApi("/api/scripts", fetchFn).write("system", "a", "")).rejects.toThrow(
      '"code" must be a string',
    );
    const plain = fakeFetch(() => json(500, {}));
    await expect(new ScriptsApi("/api/scripts", plain.fetchFn).load()).rejects.toThrow("HTTP 500");
  });

  it("explains when there is no API (a page comes back) or no server at all", async () => {
    const page = fakeFetch(() => new Response("<!doctype html>", { status: 200, headers: { "Content-Type": "text/html" } }));
    await expect(new ScriptsApi("/api/scripts", page.fetchFn).load()).rejects.toThrow("is this the dev server");
    const down = fakeFetch(() => {
      throw new TypeError("Failed to fetch");
    });
    await expect(new ScriptsApi("/api/scripts", down.fetchFn).load()).rejects.toThrow(
      "The dev server can't be reached: Failed to fetch",
    );
  });

  it("rejects a malformed script set", async () => {
    const { fetchFn } = fakeFetch(() => json(200, { version: 1, scripts: [{ kind: "x" }] }));
    await expect(new ScriptsApi("/api/scripts", fetchFn).load()).rejects.toThrow("Script 0 must have");
  });
});
