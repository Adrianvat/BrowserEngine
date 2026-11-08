import { describe, it, expect } from "vitest";
import { applyEdit, indent, newline, outdent, type TextState } from "../../src/code-editor/text-edit";

/** Builds a state from text with "|" marking the caret, or "[" and "]" a selection. */
function state(marked: string): TextState {
  const caret = marked.indexOf("|");
  if (caret >= 0) {
    return { text: marked.slice(0, caret) + marked.slice(caret + 1), start: caret, end: caret };
  }
  const start = marked.indexOf("[");
  const end = marked.indexOf("]") - 1;
  return { text: marked.replace("[", "").replace("]", ""), start, end };
}

/** The opposite: the text with the selection marked. */
function marked({ text, start, end }: TextState): string {
  if (start === end) return text.slice(0, start) + "|" + text.slice(start);
  return text.slice(0, start) + "[" + text.slice(start, end) + "]" + text.slice(end);
}

const run = (edit: typeof indent, input: string) => marked(applyEdit(state(input), edit(state(input))));

describe("indent", () => {
  it("inserts two spaces at a caret", () => {
    expect(run(indent, "ab|cd")).toBe("ab  |cd");
  });

  it("replaces a selection within one line", () => {
    expect(run(indent, "a[bc]d")).toBe("a  |d");
  });

  it("indents every line a multi-line selection touches, keeping them selected", () => {
    expect(run(indent, "one\nt[wo\nthr]ee\nfour")).toBe("one\n[  two\n  three]\nfour");
  });

  it("leaves empty lines alone and does not count a line after a trailing newline", () => {
    expect(run(indent, "[a\n\nb\n]c")).toBe("[  a\n\n  b]\nc");
  });
});

describe("outdent", () => {
  it("removes up to two leading spaces from the caret's line", () => {
    expect(run(outdent, "    ab|c")).toBe("  ab|c");
    expect(run(outdent, " a|b")).toBe("a|b");
    expect(run(outdent, "ab|")).toBe("ab|");
  });

  it("keeps the caret on its line when it was inside the removed spaces", () => {
    expect(run(outdent, " |  ab")).toBe("| ab");
  });

  it("outdents every selected line and shrinks the selection to match", () => {
    expect(run(outdent, "  o[ne\n    two\nthr]ee")).toBe("o[ne\n  two\nthr]ee");
  });
});

describe("newline", () => {
  it("keeps the current line's indentation", () => {
    expect(run(newline, "  ab|")).toBe("  ab\n  |");
    expect(run(newline, "ab|")).toBe("ab\n|");
  });

  it("indents one more after an opening bracket", () => {
    expect(run(newline, "  if (x) {|")).toBe("  if (x) {\n    |");
    expect(run(newline, "const a = [|")).toBe("const a = [\n  |");
  });

  it("puts a closing bracket right after the caret on its own line", () => {
    expect(run(newline, "f() {|}")).toBe("f() {\n  |\n}");
    expect(run(newline, "  x = [|];")).toBe("  x = [\n    |\n  ];");
  });

  it("replaces a selection", () => {
    expect(run(newline, "  a[bc]d")).toBe("  a\n  |d");
  });

  it("splits a line in the middle, using the indentation before the caret", () => {
    expect(run(newline, "    foo(|bar)")).toBe("    foo(\n      |bar)");
  });
});
