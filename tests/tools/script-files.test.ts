import { describe, it, expect } from "vitest";
import { handleScriptsRequest, ScriptFiles } from "../../tools/script-files";
import { MemoryFiles } from "../helpers/memory-files";

const ROOT = "src/game/scripts";

function setup(extra: Record<string, string> = {}) {
  const fs = new MemoryFiles({
    [`${ROOT}/systems/input.js`]: "export default () => 'input';",
    [`${ROOT}/systems/physics.js`]: "export default () => 'physics';",
    [`${ROOT}/systems/apply.js`]: "export default () => 'apply';",
    [`${ROOT}/components/Player.js`]: "export default class Player {}",
    [`${ROOT}/components/Coin.js`]: "export default class Coin {}",
    [`${ROOT}/scenes/play.js`]: "export default () => 'play';",
    [`${ROOT}/order.json`]: JSON.stringify({ systems: ["physics", "input"] }),
    [`${ROOT}/systems/notes.txt`]: "not a script",
    [`${ROOT}/README.md`]: "not a script either",
    ...extra,
  });
  return { fs, files: new ScriptFiles(ROOT, fs) };
}

const names = (scripts: { kind: string; name: string }[]) => scripts.map((s) => `${s.kind}:${s.name}`);
const order = (fs: MemoryFiles) => JSON.parse(fs.text(`${ROOT}/order.json`)!).systems;

describe("ScriptFiles", () => {
  it("lists systems in order (unlisted ones after, by name), then components by name", async () => {
    const { files } = setup();
    const scripts = await files.list();
    expect(names(scripts)).toEqual([
      "system:physics",
      "system:input",
      "system:apply",
      "component:Coin",
      "component:Player",
      "scene:play",
    ]);
    expect(scripts[0].code).toBe("export default () => 'physics';");
  });

  it("copes with a missing or broken order file and missing folders", async () => {
    const { files, fs } = setup();
    fs.files.set(`${ROOT}/order.json`, "{oops");
    expect(names(await files.list()).slice(0, 3)).toEqual(["system:apply", "system:input", "system:physics"]);
    const empty = new ScriptFiles("elsewhere", new MemoryFiles());
    expect(await empty.list()).toEqual([]);
  });

  it("write creates or replaces a file; a new system is appended to the order", async () => {
    const { files, fs } = setup();
    await files.write("system", "bounce", "export default () => {};");
    expect(fs.text(`${ROOT}/systems/bounce.js`)).toBe("export default () => {};");
    expect(order(fs)).toEqual(["physics", "input", "bounce"]);
    await files.write("system", "physics", "changed");
    expect(order(fs)).toEqual(["physics", "input", "bounce"]);
    await files.write("component", "Spin", "export default class Spin {}");
    expect(fs.files.has(`${ROOT}/components/Spin.js`)).toBe(true);
    expect(order(fs)).toEqual(["physics", "input", "bounce"]);
    expect(fs.text(`${ROOT}/order.json`)).toMatch(/\n$/);
  });

  it("remove deletes the file and takes a system out of the order", async () => {
    const { files, fs } = setup();
    await files.remove("system", "physics");
    expect(fs.files.has(`${ROOT}/systems/physics.js`)).toBe(false);
    expect(order(fs)).toEqual(["input"]);
    await files.remove("component", "Coin");
    expect(fs.files.has(`${ROOT}/components/Coin.js`)).toBe(false);
    await expect(files.remove("system", "nothing")).resolves.toBeUndefined();
  });

  it("setEnabled switches a system off and on in the order file, keeping its file and place", async () => {
    const { files, fs } = setup();
    await files.setEnabled("input", false);
    expect(JSON.parse(fs.text(`${ROOT}/order.json`)!)).toEqual({ systems: ["physics", "input"], disabled: ["input"] });
    expect(fs.files.has(`${ROOT}/systems/input.js`)).toBe(true);
    const scripts = await files.list();
    expect(scripts.map((s) => `${s.name}${s.disabled ? "(off)" : ""}`).slice(0, 3)).toEqual(["physics", "input(off)", "apply"]);
    await files.setEnabled("input", false);
    expect(JSON.parse(fs.text(`${ROOT}/order.json`)!).disabled).toEqual(["input"]);
    await files.setEnabled("input", true);
    expect(JSON.parse(fs.text(`${ROOT}/order.json`)!)).toEqual({ systems: ["physics", "input"] });
    await expect(files.setEnabled("nope", false)).rejects.toThrow('There is no system "nope"');
    // Removing a disabled system takes it out of the disabled list too; the order survives reordering.
    await files.setEnabled("apply", false);
    await files.setOrder(["apply", "input"]);
    expect(JSON.parse(fs.text(`${ROOT}/order.json`)!)).toEqual({ systems: ["apply", "input", "physics"], disabled: ["apply"] });
    await files.remove("system", "apply");
    expect(JSON.parse(fs.text(`${ROOT}/order.json`)!)).toEqual({ systems: ["input", "physics"] });
  });

  it("setOrder replaces the order, keeping systems it leaves out at the end", async () => {
    const { files, fs } = setup();
    await files.setOrder(["apply", "input"]);
    expect(order(fs)).toEqual(["apply", "input", "physics"]);
    expect(names(await files.list()).slice(0, 3)).toEqual(["system:apply", "system:input", "system:physics"]);
    await expect(files.setOrder(["nope"])).rejects.toThrow('There is no system "nope"');
  });

  it("refuses names that are not identifiers (so no paths sneak in)", async () => {
    const { files } = setup();
    await expect(files.write("system", "../../etc/passwd", "x")).rejects.toThrow("not a valid system name");
    await expect(files.remove("component", "a/b", )).rejects.toThrow("not a valid component name");
  });
});

describe("handleScriptsRequest", () => {
  const call = (files: ScriptFiles, method: string, path: string, body: unknown = "") =>
    handleScriptsRequest(files, { method, path, body: typeof body === "string" ? body : JSON.stringify(body) });

  it("GET lists the scripts as a script set", async () => {
    const { files } = setup();
    const response = await call(files, "GET", "/");
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ version: 1 });
    expect(names((response.body as { scripts: [] }).scripts)).toHaveLength(6);
    expect((await call(files, "GET", "")).status).toBe(200);
  });

  it("PUT and DELETE a script, and PUT the order", async () => {
    const { files, fs } = setup();
    expect(await call(files, "PUT", "/systems/bounce", { code: "x" })).toEqual({ status: 200, body: { ok: true } });
    expect(fs.text(`${ROOT}/systems/bounce.js`)).toBe("x");
    expect(await call(files, "PUT", "/order", { systems: ["bounce", "input"] })).toMatchObject({ status: 200 });
    expect(await call(files, "PUT", "/systems/bounce/enabled", { enabled: false })).toEqual({ status: 200, body: { ok: true } });
    expect(JSON.parse(fs.text(`${ROOT}/order.json`)!).disabled).toEqual(["bounce"]);
    expect(await call(files, "PUT", "/systems/bounce/enabled", { enabled: "no" })).toMatchObject({ status: 400 });
    expect(await call(files, "PUT", "/systems/nope/enabled", { enabled: true })).toMatchObject({ status: 500 });
    expect(await call(files, "GET", "/systems/bounce/enabled")).toMatchObject({ status: 404 });
    expect(order(fs)).toEqual(["bounce", "input", "physics", "apply"]);
    expect(await call(files, "DELETE", "/components/Coin")).toMatchObject({ status: 200 });
    expect(fs.files.has(`${ROOT}/components/Coin.js`)).toBe(false);
    expect(await call(files, "PUT", "/scenes/title", { code: "t" })).toMatchObject({ status: 200 });
    expect(fs.text(`${ROOT}/scenes/title.js`)).toBe("t");
    expect(await call(files, "DELETE", "/scenes/play")).toMatchObject({ status: 200 });
    expect(fs.files.has(`${ROOT}/scenes/play.js`)).toBe(false);
  });

  it("rejects bad input with 400 and explains", async () => {
    const { files } = setup();
    expect(await call(files, "PUT", "/systems/bounce", "{nope")).toMatchObject({
      status: 400,
      body: { error: "The request body must be a JSON object" },
    });
    expect(await call(files, "PUT", "/systems/bounce", { code: 5 })).toMatchObject({
      status: 400,
      body: { error: '"code" must be a string' },
    });
    expect(await call(files, "PUT", "/order", { systems: "input" })).toMatchObject({ status: 400 });
    expect(await call(files, "PUT", "/systems/2fast", { code: "" })).toMatchObject({ status: 400 });
    expect(await call(files, "PUT", "/things/x", { code: "" })).toMatchObject({ status: 404 });
    expect(await call(files, "POST", "/", "")).toMatchObject({ status: 404 });
  });

  it("reports a failing file system as 500", async () => {
    const { files, fs } = setup();
    fs.write = async () => {
      throw new Error("disk full");
    };
    expect(await call(files, "PUT", "/systems/input", { code: "x" })).toEqual({
      status: 500,
      body: { error: "disk full" },
    });
    expect(await call(files, "PUT", "/order", { systems: ["nope"] })).toEqual({
      status: 500,
      body: { error: 'There is no system "nope"' },
    });
  });
});
