import { ENGINE_SPECIFIER, scriptPath, type Script } from "../engine";
import { tokenize, type Token } from "./highlight";

/** Where a suggestion comes from, shown next to it. */
export type SuggestionKind = "keyword" | "engine" | "member" | "name" | "builtin" | "path";

export interface Suggestion {
  text: string;
  kind: SuggestionKind;
}

/** Suggestions for the word at the caret, and the range of text they would replace. */
export interface Completion {
  from: number;
  to: number;
  items: Suggestion[];
}

export interface SuggestRequest {
  text: string;
  caret: number;
  /** Every script (with unsaved drafts), for the names used in the project. */
  scripts: readonly Script[];
  /** The open script's path, so it does not offer to import itself. */
  currentPath?: string;
  /** Asked for (Ctrl+Space): suggest even for an empty or one-letter word. */
  explicit?: boolean;
  limit?: number;
}

const KEYWORDS = [
  "async",
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "default",
  "delete",
  "do",
  "else",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "from",
  "function",
  "if",
  "import",
  "in",
  "instanceof",
  "let",
  "new",
  "null",
  "of",
  "return",
  "static",
  "super",
  "switch",
  "this",
  "throw",
  "true",
  "try",
  "typeof",
  "undefined",
  "var",
  "while",
  "yield",
];

/** Globals scripts commonly use; their members come from the objects themselves. */
const BUILTINS: Record<string, object> = {
  Math,
  JSON,
  Object,
  Number,
  Array: Array.prototype,
  String: String.prototype,
  Map: Map.prototype,
  Set: Set.prototype,
  Promise: Promise.prototype,
  console: typeof console === "undefined" ? {} : console,
};
const BUILTIN_NAMES = [
  ...Object.keys(BUILTINS),
  "Date",
  "parseInt",
  "parseFloat",
  "isNaN",
  "setTimeout",
  "clearTimeout",
  "requestAnimationFrame",
];

const IDENTIFIER = /[\p{L}_$][\p{L}\p{N}_$]*/gu;
const WORD_AT_END = /[\p{L}_$][\p{L}\p{N}_$]*$/u;
const RECEIVER_AT_END = /([\p{L}_$][\p{L}\p{N}_$]*)\s*\??\.\s*$/u;
/** The current line up to the caret, when it is an import waiting for its specifier. */
const IMPORT_SPECIFIER = /^\s*(?:import|export)\b(?:[\w\s{},*$]*?\bfrom)?\s*(["'])([^"']*)$/;

function isIdentifier(name: string): boolean {
  return /^[\p{L}_$][\p{L}\p{N}_$]*$/u.test(name);
}

/** The names of an object's own properties (and its prototype's, for a class). */
function memberNames(value: unknown): string[] {
  const names = new Set<string>();
  const add = (target: object | null) => {
    if (!target) return;
    for (const name of Object.getOwnPropertyNames(target)) {
      if (name !== "constructor" && !name.startsWith("_") && isIdentifier(name)) names.add(name);
    }
  };
  if (typeof value === "function") {
    add((value as { prototype?: object }).prototype ?? null);
  } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    add(value);
  }
  return [...names];
}

/** The names a script uses, split into plain names and members (those after a dot). */
interface ScriptNames {
  names: Set<string>;
  members: Set<string>;
}

function namesIn(code: string): ScriptNames {
  const names = new Set<string>();
  const members = new Set<string>();
  const tokens = tokenize(code);
  let previous: Token | null = null;
  for (const token of tokens) {
    const nameLike =
      token.kind === null ||
      token.kind === "function" ||
      token.kind === "type" ||
      token.kind === "property" ||
      token.kind === "literal";
    if (nameLike) {
      const afterDot = previous !== null && /\.$/.test(previous.text);
      const isMember = token.kind === "property" || (afterDot && token.kind === "function");
      const target = isMember ? members : names;
      for (const match of token.text.matchAll(IDENTIFIER)) target.add(match[0]);
    }
    if (token.kind !== null || token.text.trim() !== "") previous = token;
  }
  return { names, members };
}

/** Where a candidate comes from; lower ranks are listed first. */
const Rank = {
  ReceiverMember: 0,
  CurrentScript: 1,
  OtherScript: 2,
  Engine: 3,
  Keyword: 4,
  Builtin: 5,
  OtherMember: 6,
} as const;
type Rank = (typeof Rank)[keyof typeof Rank];

interface Candidate extends Suggestion {
  rank: Rank;
  /** Within a rank, a fixed order (e.g. the script list's) instead of shortest first. */
  order?: number;
}

/**
 * Suggests what the word at the caret could be: JavaScript keywords, what "engine"
 * exports, members of the engine's classes (and of common built-ins), the names the
 * project's scripts use, and script paths inside an import. Simple on purpose: there is
 * no type information, so after a dot it offers every known member, with the members of
 * the class the receiver seems to be (`world.` → World) first.
 */
export class Suggester {
  private readonly engineNames: string[];
  /** Members by class name: the engine's classes and a few JavaScript built-ins. */
  private readonly classMembers = new Map<string, string[]>();
  private readonly allMembers = new Set<string>();
  private readonly cache = new Map<string, ScriptNames>();

  /**
   * `engine` is what scripts import from "engine". `extraMembers` are members known by
   * class name but not visible on a prototype, e.g. the built-in components' fields.
   */
  constructor(
    engine: Record<string, unknown>,
    extraMembers: Record<string, readonly string[]> = {},
  ) {
    this.engineNames = Object.keys(engine).filter(isIdentifier);
    const sources: Record<string, unknown> = { ...BUILTINS, ...engine };
    for (const [name, value] of Object.entries(sources)) {
      const members = [...new Set([...memberNames(value), ...(extraMembers[name] ?? [])])];
      if (members.length === 0) continue;
      this.classMembers.set(name, members);
      for (const member of members) this.allMembers.add(member);
    }
    for (const [name, members] of Object.entries(extraMembers)) {
      if (this.classMembers.has(name)) continue;
      this.classMembers.set(name, [...members]);
      for (const member of members) this.allMembers.add(member);
    }
  }

  suggest(request: SuggestRequest): Completion | null {
    const { text, caret, explicit = false, limit = 10 } = request;
    const before = text.slice(0, caret);
    // The whole text, so a string, comment or regular expression still being typed (open
    // to the end of its line) counts as one.
    const kindAt = tokenKinds(text);
    const here = kindAt(caret - 1);
    if (here === "comment" || here === "number" || here === "regexp") return null;
    if (here === "string") return this.importPath(request, before, limit);

    const word = WORD_AT_END.exec(before)?.[0] ?? "";
    const from = caret - word.length;
    const prefix = before.slice(0, from);
    const dot = /(?:\?\.|\.)\s*$/.exec(prefix);
    const afterDot = dot !== null && kindAt(dot.index) !== "number";

    if (!explicit && !afterDot && word.length < 2) return null;

    const candidates = afterDot
      ? this.members(RECEIVER_AT_END.exec(prefix)?.[1] ?? null)
      : this.names(request, from);
    const items = rank(candidates, word, limit);
    return items.length === 0 ? null : { from, to: caret, items };
  }

  private members(receiver: string | null): Candidate[] {
    const own = new Set<string>();
    if (receiver !== null) {
      const wanted = receiver.toLowerCase();
      for (const [name, members] of this.classMembers) {
        if (name.toLowerCase() === wanted) for (const member of members) own.add(member);
      }
    }
    const candidates: Candidate[] = [];
    for (const member of own) {
      candidates.push({ text: member, kind: "member", rank: Rank.ReceiverMember });
    }
    for (const member of this.allMembers) {
      if (own.has(member)) continue;
      candidates.push({ text: member, kind: "member", rank: Rank.OtherMember });
    }
    return candidates;
  }

  private names(request: SuggestRequest, from: number): Candidate[] {
    const seen = new Map<string, Candidate>();
    const offer = (text: string, kind: SuggestionKind, rank: Rank) => {
      const existing = seen.get(text);
      // The best rank wins, but an engine export is always labelled as one.
      const label = existing?.kind === "engine" || kind === "engine" ? "engine" : kind;
      if (!existing || rank < existing.rank) seen.set(text, { text, kind: label, rank });
      else existing.kind = label;
    };
    // The current script, without the word being typed (it would only suggest itself).
    const current = request.text.slice(0, from) + " " + request.text.slice(request.caret);
    for (const name of namesIn(current).names) offer(name, "name", Rank.CurrentScript);
    for (const name of this.engineNames) offer(name, "engine", Rank.Engine);
    for (const script of request.scripts) {
      if (scriptPath(script.kind, script.name) === request.currentPath) continue;
      for (const name of this.namesOf(script.code).names) offer(name, "name", Rank.OtherScript);
    }
    for (const keyword of KEYWORDS) offer(keyword, "keyword", Rank.Keyword);
    for (const name of BUILTIN_NAMES) offer(name, "builtin", Rank.Builtin);
    // A member the project uses can also be a name elsewhere (destructured fields, say).
    for (const member of this.allMembers) offer(member, "member", Rank.OtherMember);
    return [...seen.values()];
  }

  private importPath(request: SuggestRequest, before: string, limit: number): Completion | null {
    const line = before.slice(before.lastIndexOf("\n") + 1);
    const match = IMPORT_SPECIFIER.exec(line);
    if (!match) return null;
    const partial = match[2];
    const from = request.caret - partial.length;
    const candidates: Candidate[] = [
      { text: ENGINE_SPECIFIER, kind: "path", rank: Rank.CurrentScript },
    ];
    request.scripts.forEach((script, order) => {
      const path = scriptPath(script.kind, script.name);
      if (path === request.currentPath) return;
      candidates.push({ text: path, kind: "path", rank: Rank.OtherScript, order });
    });
    const items = rank(candidates, partial, limit);
    return items.length === 0 ? null : { from, to: request.caret, items };
  }

  private namesOf(code: string): ScriptNames {
    let names = this.cache.get(code);
    if (!names) {
      if (this.cache.size > 64) this.cache.clear();
      names = namesIn(code);
      this.cache.set(code, names);
    }
    return names;
  }
}

/** The kind of the token covering each character of `code` (undefined past its end). */
function tokenKinds(code: string): (index: number) => Token["kind"] | undefined {
  const starts: number[] = [];
  const tokens = tokenize(code);
  let at = 0;
  for (const token of tokens) {
    starts.push(at);
    at += token.text.length;
  }
  return (index) => {
    if (index < 0 || index >= code.length) return undefined;
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (starts[mid] <= index) low = mid;
      else high = mid - 1;
    }
    return tokens[low].kind;
  };
}

/** Prefix matches (case-sensitive first), by rank and order, then shorter and alphabetical. */
function rank(candidates: Candidate[], word: string, limit: number): Suggestion[] {
  const lower = word.toLowerCase();
  const scored: { candidate: Candidate; exact: number }[] = [];
  for (const candidate of candidates) {
    if (candidate.text === word) continue;
    if (candidate.text.startsWith(word)) scored.push({ candidate, exact: 0 });
    else if (candidate.text.toLowerCase().startsWith(lower)) scored.push({ candidate, exact: 1 });
  }
  scored.sort(
    (a, b) =>
      a.exact - b.exact ||
      a.candidate.rank - b.candidate.rank ||
      (a.candidate.order ?? 0) - (b.candidate.order ?? 0) ||
      a.candidate.text.length - b.candidate.text.length ||
      a.candidate.text.localeCompare(b.candidate.text),
  );
  return scored.slice(0, limit).map(({ candidate }) => ({ text: candidate.text, kind: candidate.kind }));
}
