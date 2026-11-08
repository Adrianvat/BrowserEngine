import { describe, it, expect } from "vitest";
import { tokenize, type Token, type TokenKind } from "../../src/code-editor/highlight";
import { bundledProjects } from "../../src/project/bundle";

const scripts = bundledProjects.demo.scripts;

/** The tokens that are not plain, as [kind, text] pairs. */
function marked(code: string): [TokenKind, string][] {
  return tokenize(code)
    .filter((token): token is Token & { kind: TokenKind } => token.kind !== null)
    .map((token) => [token.kind, token.text]);
}

/**
 * The kind given to `text`: the first token that is exactly it, or, for plain text (which
 * is merged with the whitespace around it), that is it once trimmed.
 */
function kindOf(code: string, text: string): TokenKind | null | undefined {
  return tokenize(code).find((token) => token.text === text || token.text.trim() === text)?.kind;
}

/** A small seeded random generator, so the fuzz test is repeatable. */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

describe("tokenize", () => {
  it("gives back exactly the input when the tokens are joined", () => {
    for (const script of scripts) {
      expect(tokenize(script.code).map((t) => t.text).join("")).toBe(script.code);
    }
  });

  it("never throws or loses text, whatever it is given", () => {
    const next = random(42);
    const alphabet = "ab Z_$0129.\n\t /\\*'\"`${}()[];,:?!=<>+-#@é\u00a0";
    for (let run = 0; run < 400; run++) {
      let code = "";
      const length = Math.floor(next() * 60);
      for (let i = 0; i < length; i++) code += alphabet[Math.floor(next() * alphabet.length)];
      expect(tokenize(code).map((t) => t.text).join(""), JSON.stringify(code)).toBe(code);
    }
  });

  it("handles empty input", () => {
    expect(tokenize("")).toEqual([]);
  });

  it("merges neighbours of the same kind and never yields empty tokens", () => {
    const tokens = tokenize("f();  \n\n  g()");
    expect(tokens.every((token) => token.text !== "")).toBe(true);
    for (let i = 1; i < tokens.length; i++) expect(tokens[i].kind).not.toBe(tokens[i - 1].kind);
  });

  it("marks keywords, literals, numbers and strings", () => {
    expect(marked(`export const speed = 300;`)).toEqual([
      ["keyword", "export"],
      ["keyword", "const"],
      ["operator", "="],
      ["number", "300"],
      ["punctuation", ";"],
    ]);
    expect(marked(`return x === null || y !== true;`)).toEqual([
      ["keyword", "return"],
      ["operator", "==="],
      ["literal", "null"],
      ["operator", "||"],
      ["operator", "!=="],
      ["literal", "true"],
      ["punctuation", ";"],
    ]);
    expect(kindOf(`a = "it's"`, `"it's"`)).toBe("string");
    expect(kindOf(`a = 'say "hi"'`, `'say "hi"'`)).toBe("string");
    expect(kindOf(`a = "esc \\" aped"`, `"esc \\" aped"`)).toBe("string");
  });

  it.each(["0", "42", "3.14", ".5", "1e-3", "2.5E+10", "0xFF", "0b1010", "0o17", "1_000", "10n"])(
    "reads the number %s whole",
    (number) => {
      expect(marked(`x = ${number};`)[1]).toEqual(["number", number]);
    },
  );

  it("marks calls, methods, properties and capitalized names", () => {
    const code = `const [, v] = world.query(Player, Velocity); v.x = Math.max(1, speed(2));`;
    expect(kindOf(code, "query")).toBe("function");
    expect(kindOf(code, "Player")).toBe("type");
    expect(kindOf(code, "Velocity")).toBe("type");
    expect(kindOf(code, "x")).toBe("property");
    expect(kindOf(code, "Math")).toBe("type");
    expect(kindOf(code, "max")).toBe("function");
    expect(kindOf(code, "speed")).toBe("function");
    expect(kindOf(code, "world")).toBeNull();
    expect(kindOf(code, "v")).toBeNull();
  });

  it("marks a function's name where it is declared", () => {
    expect(kindOf(`export default function kick(world) {}`, "kick")).toBe("function");
    expect(kindOf(`function (x) {}`, "function")).toBe("keyword");
  });

  it("marks optional chaining and private fields as property access", () => {
    expect(kindOf(`world.get(e, Collider)?.layer`, "layer")).toBe("property");
    expect(kindOf(`a?.b()`, "b")).toBe("function");
    expect(kindOf(`this.#count++`, "#count")).toBe("property");
  });

  it("shows SCREAMING_CASE constants like values, and contextual keywords called as functions", () => {
    expect(kindOf(`velocity.x = dx * PLAYER_SPEED;`, "PLAYER_SPEED")).toBe("literal");
    expect(kindOf(`new A()`, "A")).toBe("type");
    expect(kindOf(`import x from "engine";`, "from")).toBe("keyword");
    expect(kindOf(`for (const a of list) get(a);`, "of")).toBe("keyword");
    expect(kindOf(`for (const a of list) get(a);`, "get")).toBe("function");
    expect(kindOf(`const f = async (x) => x;`, "async")).toBe("keyword");
  });

  it("marks line and block comments, including unterminated ones", () => {
    expect(marked(`x = 1; // note\ny`)).toContainEqual(["comment", "// note"]);
    expect(marked(`/** Doc.\n * More. */\nfunction f() {}`)[0]).toEqual([
      "comment",
      "/** Doc.\n * More. */",
    ]);
    expect(marked(`a /* open`).at(-1)).toEqual(["comment", "/* open"]);
    expect(marked(`x=//note`)).toEqual([
      ["operator", "="],
      ["comment", "//note"],
    ]);
  });

  it("ends an unterminated string at the end of its line", () => {
    expect(marked(`a = "open\nb = 1;`)).toEqual([
      ["operator", "="],
      ["string", `"open`],
      ["operator", "="],
      ["number", "1"],
      ["punctuation", ";"],
    ]);
  });

  it("tells regular expressions from divisions", () => {
    expect(kindOf(`const re = /[a/b]+\\d/gi;`, "/[a/b]+\\d/gi")).toBe("regexp");
    expect(kindOf(`x=/re/`, "/re/")).toBe("regexp");
    expect(kindOf(`return /x/.test(s)`, "/x/")).toBe("regexp");
    expect(marked(`a = b / c / d;`).filter(([kind]) => kind === "regexp")).toEqual([]);
    expect(marked(`f(x) / 2`).filter(([kind]) => kind === "regexp")).toEqual([]);
    expect(marked(`a[0] / b[1] / c`).filter(([kind]) => kind === "regexp")).toEqual([]);
    // Where only a regular expression can follow, an unclosed one runs to the line's end.
    expect(marked(`x = /re\ny = 1`)).toContainEqual(["regexp", "/re"]);
    expect(marked(`x = /re\ny = 1`)).toContainEqual(["number", "1"]);
  });

  it("follows template literals into their ${...} parts, nested ones too", () => {
    const code = "const s = `hsl(${Math.floor(h)}, ${`${n}%`})`;";
    expect(marked(code)).toEqual([
      ["keyword", "const"],
      ["operator", "="],
      ["string", "`hsl("],
      ["punctuation", "${"],
      ["type", "Math"],
      ["punctuation", "."],
      ["function", "floor"],
      ["punctuation", "("],
      ["punctuation", ")}"],
      ["string", ", "],
      ["punctuation", "${"],
      ["string", "`"],
      ["punctuation", "${"],
      ["punctuation", "}"],
      ["string", "%`"],
      ["punctuation", "}"],
      ["string", ")`"],
      ["punctuation", ";"],
    ]);
  });

  it("keeps braces inside a template expression apart from the one closing it", () => {
    const code = "`a ${ {x: 1}.x } b` + c";
    const tokens = marked(code);
    expect(tokens.at(-1)).toEqual(["operator", "+"]);
    expect(tokens).toContainEqual(["string", " b`"]);
  });

  it("treats an unterminated template literal as a string to the end", () => {
    expect(marked("a = `open\nstill ${x} open").at(-1)).toEqual(["string", " open"]);
  });

  it("leaves escaped backticks and dollar signs inside a template alone", () => {
    expect(marked("`a \\` b \\${c}`")).toEqual([["string", "`a \\` b \\${c}`"]]);
  });
});
