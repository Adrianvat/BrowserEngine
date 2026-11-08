import { describe, it, expect } from "vitest";
import {
  findImports,
  isScriptName,
  parseScriptPath,
  parseScripts,
  planLoad,
  rewriteImports,
  scriptPath,
  validateScripts,
  type Script,
} from "../../src/engine";

function script(kind: Script["kind"], name: string, code = ""): Script {
  return { kind, name, code };
}

describe("script names and paths", () => {
  it("accepts identifiers and rejects anything else", () => {
    expect(isScriptName("kick")).toBe(true);
    expect(isScriptName("Player2")).toBe(true);
    expect(isScriptName("_$x")).toBe(true);
    expect(isScriptName("")).toBe(false);
    expect(isScriptName("2fast")).toBe(false);
    expect(isScriptName("my system")).toBe(false);
    expect(isScriptName("a-b")).toBe(false);
    expect(isScriptName("a/b")).toBe(false);
  });

  it("builds and parses import paths", () => {
    expect(scriptPath("system", "kick")).toBe("systems/kick");
    expect(scriptPath("component", "Player")).toBe("components/Player");
    expect(parseScriptPath("systems/kick")).toEqual({ kind: "system", name: "kick" });
    expect(parseScriptPath("components/Player")).toEqual({ kind: "component", name: "Player" });
    expect(parseScriptPath("engine")).toBeNull();
    expect(parseScriptPath("systems/")).toBeNull();
    expect(parseScriptPath("systems/a/b")).toBeNull();
    expect(parseScriptPath("things/x")).toBeNull();
  });
});

describe("validateScripts", () => {
  it("returns a fresh copy of a valid set", () => {
    const scripts = [script("system", "kick", "export default () => {}")];
    const result = validateScripts({ version: 1, scripts });
    expect(result).toEqual(scripts);
    expect(result).not.toBe(scripts);
    expect(result[0]).not.toBe(scripts[0]);
  });

  it("drops extra properties, keeping a system's disabled flag", () => {
    const result = validateScripts({
      version: 1,
      scripts: [
        { kind: "component", name: "A", code: "", extra: 1, disabled: true },
        { kind: "system", name: "b", code: "", disabled: true },
        { kind: "system", name: "c", code: "", disabled: "yes" },
      ],
    });
    expect(result).toEqual([
      { kind: "component", name: "A", code: "" },
      { kind: "system", name: "b", code: "", disabled: true },
      { kind: "system", name: "c", code: "" },
    ]);
  });

  it.each([
    [null, 'must be an object with "version" and "scripts"'],
    [{ version: 1 }, 'must be an object with "version" and "scripts"'],
    [{ version: 2, scripts: [] }, "Unsupported scripts version: 2"],
    [{ version: 1, scripts: [{ kind: "thing", name: "a", code: "" }] }, "Script 0 must have a \"kind\""],
    [{ version: 1, scripts: [{ kind: "system", name: "a b", code: "" }] }, "identifier as its \"name\""],
    [{ version: 1, scripts: [{ kind: "system", name: "a", code: 5 }] }, '("a") must have its "code"'],
    [
      { version: 1, scripts: [script("system", "a"), script("system", "a")] },
      'Script "systems/a" appears twice',
    ],
  ])("rejects %j", (value, message) => {
    expect(() => validateScripts(value)).toThrow(message);
  });

  it("allows a system and a component with the same name", () => {
    expect(() =>
      validateScripts({ version: 1, scripts: [script("system", "a"), script("component", "a")] }),
    ).not.toThrow();
  });

  it("parseScripts reports bad JSON", () => {
    expect(() => parseScripts("{nope")).toThrow("Saved scripts are not valid JSON");
    expect(parseScripts('{"version":1,"scripts":[]}')).toEqual([]);
  });
});

describe("findImports", () => {
  it("finds default, named, namespace, multi-line, re-export and bare imports", () => {
    const code = [
      `import Player from "components/Player";`,
      `import { Keyboard, Velocity } from 'engine'`,
      `import * as all from "engine";`,
      `import {`,
      `  Body,`,
      `  Collider,`,
      `} from "engine";`,
      `export { helper as h } from "systems/shared";`,
      `import "systems/sideEffects";`,
      `export default function kick(world) {}`,
    ].join("\n");
    const specifiers = findImports(code).map((spec) => spec.specifier);
    expect(specifiers).toEqual([
      "components/Player",
      "engine",
      "engine",
      "engine",
      "systems/shared",
      "systems/sideEffects",
    ]);
  });

  it("reports where each specifier sits", () => {
    const code = `import A from "components/A";\nimport "x";`;
    const [first, second] = findImports(code);
    expect(code.slice(first.start, first.end)).toBe("components/A");
    expect(code.slice(second.start, second.end)).toBe("x");
  });

  it("ignores from-strings inside code, comments and dynamic imports", () => {
    const code = [
      `export const scenes = ["play"]`,
      `export default function f(world) {`,
      `  const s = 'taken from "nowhere"';`,
      `  // import { x } from "engine" would go at the top`,
      `  return import("https://example.com/mod.js");`,
      `}`,
    ].join("\n");
    expect(findImports(code)).toEqual([]);
  });

  it("ignores imports that are not at the start of a line", () => {
    expect(findImports(`const text = "import x from 'y'";`)).toEqual([]);
  });

  it("allows leading indentation", () => {
    expect(findImports(`  import x from "engine";`).map((s) => s.specifier)).toEqual(["engine"]);
  });
});

describe("rewriteImports", () => {
  it("replaces every specifier and nothing else", () => {
    const code = `import A from "components/A";\nimport { B } from 'engine';\nexport default A;`;
    const result = rewriteImports(code, (specifier) => `url:${specifier}`);
    expect(result).toBe(
      `import A from "url:components/A";\nimport { B } from 'url:engine';\nexport default A;`,
    );
  });

  it("leaves code without imports alone", () => {
    expect(rewriteImports("export default 1;", () => "x")).toBe("export default 1;");
  });
});

describe("planLoad", () => {
  const paths = (plan: ReturnType<typeof planLoad>) =>
    plan.order.map(({ script }) => scriptPath(script.kind, script.name));

  it("puts each script after the ones it imports", () => {
    const plan = planLoad([
      script("system", "kick", `import Player from "components/Player";\nimport { x } from "systems/shared";`),
      script("system", "shared", `import Player from "components/Player";`),
      script("component", "Player"),
    ]);
    expect(plan.errors).toEqual([]);
    expect(paths(plan)).toEqual(["components/Player", "systems/shared", "systems/kick"]);
    expect(plan.order[2].dependencies).toEqual(["components/Player", "systems/shared"]);
  });

  it("keeps the given order for unrelated scripts", () => {
    const plan = planLoad([script("system", "b"), script("system", "a"), script("component", "C")]);
    expect(paths(plan)).toEqual(["systems/b", "systems/a", "components/C"]);
  });

  it("does not count the engine or URL imports as scripts", () => {
    const plan = planLoad([
      script("system", "a", `import { World } from "engine";\nimport x from "https://cdn.example/x.js";`),
    ]);
    expect(plan.errors).toEqual([]);
    expect(plan.order[0].dependencies).toEqual([]);
  });

  it("reports an import of a script that does not exist", () => {
    const plan = planLoad([script("system", "a", `import P from "components/Player";`)]);
    expect(paths(plan)).toEqual([]);
    expect(plan.errors).toEqual([
      { kind: "system", name: "a", message: 'There is no script "components/Player" to import' },
    ]);
  });

  it("explains an import that is not a script path", () => {
    const plan = planLoad([script("system", "a", `import P from "./Player.js";`)]);
    expect(plan.errors[0].message).toContain('Can\'t import "./Player.js"');
    expect(plan.errors[0].message).toContain('"components/Player"');
  });

  it("reports every script in a circle of imports", () => {
    const plan = planLoad([
      script("system", "a", `import b from "systems/b";`),
      script("system", "b", `import a from "systems/a";`),
      script("system", "c"),
    ]);
    expect(paths(plan)).toEqual(["systems/c"]);
    expect(plan.errors.map((error) => error.name)).toEqual(["a", "b"]);
    expect(plan.errors[0].message).toBe(
      "Scripts import each other in a circle: systems/a -> systems/b -> systems/a",
    );
  });

  it("reports a script that imports a broken one", () => {
    const plan = planLoad([
      script("system", "a", `import b from "systems/b";`),
      script("system", "b", `import nope from "systems/nope";`),
    ]);
    expect(paths(plan)).toEqual([]);
    expect(plan.errors).toEqual([
      { kind: "system", name: "a", message: 'Can\'t load because "systems/b" failed' },
      { kind: "system", name: "b", message: 'There is no script "systems/nope" to import' },
    ]);
  });

  it("lets a script import itself only as a circle", () => {
    const plan = planLoad([script("system", "a", `import a from "systems/a";`)]);
    expect(plan.errors[0].message).toContain("systems/a -> systems/a");
  });
});
