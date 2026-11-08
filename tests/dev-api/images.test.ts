import { describe, expect, it } from "vitest";
import { encodeFile, ImagesApi, validateImageFiles } from "../../src/dev-api/images";

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

const sheet = { frameWidth: 16, frameHeight: 16, animations: { walk: { frames: [0, 1], fps: 8 } } };

describe("ImagesApi", () => {
  it("loads the image files from GET, with URLs under the API for their files", async () => {
    const images = [
      { name: "coin", file: "coin.png" },
      { name: "hero", file: "hero.svg", sheet },
      { name: "torn", file: "torn.png", error: "torn.json: not valid JSON" },
    ];
    const { fetchFn, requests } = fakeFetch(() => json(200, { version: 1, images }));
    expect(await new ImagesApi("/api/images", fetchFn).load()).toEqual([
      { name: "coin", url: "/api/images/files/coin.png" },
      { name: "hero", url: "/api/images/files/hero.svg", sheet },
      { name: "torn", url: "/api/images/files/torn.png", error: "torn.json: not valid JSON" },
    ]);
    expect(requests).toEqual([{ method: "GET", url: "/api/images", body: undefined }]);
  });

  it("saves a file as base64 with its type and sheet, sets a sheet, and removes", async () => {
    const { fetchFn, requests } = fakeFetch(() => json(200, { ok: true }));
    const api = new ImagesApi("/api/images", fetchFn);
    await api.save("slime", new Blob(["hi"], { type: "image/png" }), sheet);
    await api.setSheet("slime", null);
    await api.remove("slime");
    expect(requests).toEqual([
      { method: "PUT", url: "/api/images/slime", body: JSON.stringify({ type: "image/png", data: "aGk=", sheet }) },
      { method: "PUT", url: "/api/images/slime/sheet", body: JSON.stringify({ sheet: null }) },
      { method: "DELETE", url: "/api/images/slime", body: undefined },
    ]);
  });

  it("encodes big files too", async () => {
    const bytes = new Uint8Array(100_000).map((_, i) => i % 253);
    const encoded = await encodeFile(new Blob([bytes]));
    expect(Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0))).toEqual(bytes);
  });

  it("rejects a malformed answer", () => {
    const url = (file: string) => `/x/${file}`;
    expect(() => validateImageFiles({ version: 1, images: [{ name: "a/b", file: "a.png" }] }, url)).toThrow("broken image list: bad name");
    expect(() => validateImageFiles({ version: 1, images: [{ name: "a", file: "../a.png" }] }, url)).toThrow('bad file for "a"');
    expect(() => validateImageFiles({ version: 1, images: [{ name: "a", file: "a.txt" }] }, url)).toThrow('bad file for "a"');
    expect(() => validateImageFiles({ version: 1, images: [{ name: "a", file: "a.png", sheet: { frameWidth: 0 } }] }, url)).toThrow(
      "broken image list",
    );
    expect(() => validateImageFiles({ version: 1, images: [{ name: "a", file: "a.png", error: 5 }] }, url)).toThrow('bad error for "a"');
    expect(() => validateImageFiles({ version: 1 }, url)).toThrow("something other than image files");
    expect(() => validateImageFiles(undefined, url)).toThrow("something other than image files");
  });
});
