/**
 * A small JavaScript tokenizer for syntax highlighting. It is forgiving rather than
 * exact: it never throws, every character of the input ends up in exactly one token (so
 * the tokens joined give back the input), and text it can't classify is left plain.
 */
export type TokenKind =
  | "comment"
  | "string"
  | "number"
  | "keyword"
  | "literal"
  | "regexp"
  | "function"
  | "type"
  | "property"
  | "operator"
  | "punctuation";

export interface Token {
  /** null: plain text (whitespace, ordinary names). */
  kind: TokenKind | null;
  text: string;
}

const KEYWORDS = new Set([
  "as",
  "async",
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "default",
  "delete",
  "do",
  "else",
  "export",
  "extends",
  "finally",
  "for",
  "from",
  "function",
  "get",
  "if",
  "import",
  "in",
  "instanceof",
  "let",
  "new",
  "of",
  "return",
  "set",
  "static",
  "super",
  "switch",
  "throw",
  "try",
  "typeof",
  "var",
  "void",
  "while",
  "with",
  "yield",
]);

/**
 * Keywords only in some places; called like a function they are ordinary names, e.g.
 * `get(key)`. (`async (x) => ...` is left a keyword: it is far more common than a call.)
 */
const CONTEXTUAL = new Set(["as", "from", "get", "of", "set", "static"]);

const LITERALS = new Set(["true", "false", "null", "undefined", "this", "NaN", "Infinity"]);

/** SCREAMING_CASE names: constants, shown like the values they stand for. */
const CONSTANT = /^(?=.*\p{Lu}.*\p{Lu})[\p{Lu}\d_$]+$/u;

/** After these keywords a `/` starts a regular expression, not a division. */
const BEFORE_REGEXP = new Set([
  "return",
  "typeof",
  "case",
  "do",
  "else",
  "in",
  "of",
  "new",
  "delete",
  "void",
  "throw",
  "yield",
  "await",
  "instanceof",
]);

const IDENTIFIER = /[\p{L}\p{Nl}_$][\p{L}\p{Nl}\p{Mn}\p{Mc}\p{Nd}\p{Pc}_$\u200c\u200d]*/uy;
const NUMBER =
  /(?:0[xX][\da-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+)n?|(?:\d[\d_]*(?:\.[\d_]*)?|\.\d[\d_]*)(?:[eE][+-]?\d[\d_]*)?n?/y;
const WHITESPACE = /\s+/y;
// A `/` only ever stands alone (or as `/=`), so a run never swallows the start of a
// comment or a regular expression, as in `x=//note` or `x=/re/`.
const OPERATOR = /=>|\?\.(?!\d)|\/=?|[=!<>&|^~?:+\-*%]+/y;
const PUNCTUATION = "(){}[];,.#@";

function matchAt(pattern: RegExp, code: string, at: number): string | null {
  pattern.lastIndex = at;
  const match = pattern.exec(code);
  return match ? match[0] : null;
}

/** The first non-whitespace character at or after `at`, or "". */
function nextSignificant(code: string, at: number): string {
  WHITESPACE.lastIndex = at;
  const skipped = WHITESPACE.exec(code);
  return code[skipped ? at + skipped[0].length : at] ?? "";
}

/** Where a quoted string starting at `at` ends: after its closing quote, or at the line end. */
function stringEnd(code: string, at: number): number {
  const quote = code[at];
  let i = at + 1;
  while (i < code.length) {
    const c = code[i];
    if (c === "\\") i += 2;
    else if (c === quote) return i + 1;
    else if (c === "\n") return i;
    else i++;
  }
  return code.length;
}

/**
 * Where a regular expression starting at `at` ends: after its flags, or at the end of its
 * line when it is not closed (still being typed, or a mistake).
 */
function regexpEnd(code: string, at: number): number {
  let i = at + 1;
  let inClass = false;
  while (i < code.length) {
    const c = code[i];
    if (c === "\n") return i;
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === "[") inClass = true;
    else if (c === "]") inClass = false;
    else if (c === "/" && !inClass) {
      i++;
      while (i < code.length && /[a-z]/i.test(code[i])) i++;
      return i;
    }
    i++;
  }
  return code.length;
}

/**
 * Splits JavaScript source into highlighted tokens. Template literals are followed into
 * their `${...}` parts, which are tokenized as code.
 */
export function tokenize(code: string): Token[] {
  const tokens: Token[] = [];
  const push = (kind: TokenKind | null, text: string) => {
    if (text === "") return;
    const last = tokens[tokens.length - 1];
    if (last && last.kind === kind) last.text += text;
    else tokens.push({ kind, text });
  };
  /** The last token that is not whitespace or a comment, for telling `/` apart. */
  let previous: Token | null = null;
  const significant = (kind: TokenKind | null, text: string) => {
    push(kind, text);
    previous = { kind, text };
  };
  const regexpAllowed = (): boolean => {
    const before = previous as Token | null;
    if (before === null) return true;
    if (before.kind === "keyword") return BEFORE_REGEXP.has(before.text);
    if (before.kind === "operator") return true;
    if (before.kind === "punctuation") return !/[)\]}]$/.test(before.text);
    return false;
  };

  /** One entry per open `${`: how many `{` are open inside it. */
  const templates: number[] = [];
  let inTemplate = false;
  let i = 0;

  while (i < code.length) {
    if (inTemplate) {
      // Inside a template literal's text: up to the closing backtick or a `${`.
      let j = i;
      while (j < code.length && code[j] !== "`" && !(code[j] === "$" && code[j + 1] === "{")) {
        j += code[j] === "\\" ? 2 : 1;
      }
      j = Math.min(j, code.length);
      if (j >= code.length) {
        significant("string", code.slice(i));
        break;
      }
      if (code[j] === "`") {
        significant("string", code.slice(i, j + 1));
        inTemplate = false;
        i = j + 1;
      } else {
        significant("string", code.slice(i, j));
        significant("punctuation", "${");
        templates.push(0);
        inTemplate = false;
        i = j + 2;
      }
      continue;
    }

    const c = code[i];
    const whitespace = matchAt(WHITESPACE, code, i);
    if (whitespace) {
      push(null, whitespace);
      i += whitespace.length;
      continue;
    }

    if (c === "/" && code[i + 1] === "/") {
      const end = code.indexOf("\n", i);
      const stop = end < 0 ? code.length : end;
      push("comment", code.slice(i, stop));
      i = stop;
      continue;
    }
    if (c === "/" && code[i + 1] === "*") {
      const end = code.indexOf("*/", i + 2);
      const stop = end < 0 ? code.length : end + 2;
      push("comment", code.slice(i, stop));
      i = stop;
      continue;
    }

    if (c === '"' || c === "'") {
      const end = stringEnd(code, i);
      significant("string", code.slice(i, end));
      i = end;
      continue;
    }
    if (c === "`") {
      inTemplate = true;
      push("string", "`");
      i++;
      continue;
    }

    if (c === "/" && regexpAllowed()) {
      const end = regexpEnd(code, i);
      significant("regexp", code.slice(i, end));
      i = end;
      continue;
    }

    if (/[\d.]/.test(c)) {
      const number = matchAt(NUMBER, code, i);
      if (number && (c !== "." || number.length > 1)) {
        significant("number", number);
        i += number.length;
        continue;
      }
    }

    const privateName = c === "#" ? matchAt(IDENTIFIER, code, i + 1) : null;
    if (privateName) {
      significant("property", "#" + privateName);
      i += privateName.length + 1;
      continue;
    }

    const name = matchAt(IDENTIFIER, code, i);
    if (name) {
      const before = previous as Token | null;
      const afterDot = before?.text === "." || before?.text === "?.";
      const called = nextSignificant(code, i + name.length) === "(";
      let kind: TokenKind | null;
      if (afterDot) kind = called ? "function" : "property";
      else if (LITERALS.has(name)) kind = "literal";
      else if (CONTEXTUAL.has(name) && called) kind = "function";
      else if (KEYWORDS.has(name)) kind = "keyword";
      else if (CONSTANT.test(name)) kind = "literal";
      else if (/^\p{Lu}/u.test(name)) kind = "type";
      else if (called) kind = "function";
      else kind = null;
      significant(kind, name);
      i += name.length;
      continue;
    }

    if (c === "{" || c === "}") {
      if (c === "}" && templates.length > 0 && templates[templates.length - 1] === 0) {
        // Closes a `${`: back to the template's text.
        templates.pop();
        significant("punctuation", "}");
        inTemplate = true;
        i++;
        continue;
      }
      if (templates.length > 0) templates[templates.length - 1] += c === "{" ? 1 : -1;
      significant("punctuation", c);
      i++;
      continue;
    }

    const operator = matchAt(OPERATOR, code, i);
    if (operator) {
      significant("operator", operator);
      i += operator.length;
      continue;
    }

    significant(PUNCTUATION.includes(c) ? "punctuation" : null, c);
    i++;
  }
  return tokens;
}
