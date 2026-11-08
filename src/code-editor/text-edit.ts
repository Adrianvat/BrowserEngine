/** A text field's content and selection (start === end is a caret). */
export interface TextState {
  text: string;
  start: number;
  end: number;
}

/** Replace text[from, to) with `insert`, then select [start, end). */
export interface Edit {
  from: number;
  to: number;
  insert: string;
  start: number;
  end: number;
}

export const INDENT = "  ";

export function applyEdit({ text }: TextState, edit: Edit): TextState {
  return {
    text: text.slice(0, edit.from) + edit.insert + text.slice(edit.to),
    start: edit.start,
    end: edit.end,
  };
}

/** Index of the first character of the line holding `index`. */
function lineStart(text: string, index: number): number {
  return text.lastIndexOf("\n", index - 1) + 1;
}

/** Index just past the last character of the line holding `index` (before its newline). */
function lineEnd(text: string, index: number): number {
  const newline = text.indexOf("\n", index);
  return newline < 0 ? text.length : newline;
}

/** The range of whole lines the selection touches. */
function selectedLines({ text, start, end }: TextState): { from: number; to: number } {
  // A selection ending right after a newline does not include the next line.
  const last = end > start && text[end - 1] === "\n" ? end - 1 : end;
  return { from: lineStart(text, start), to: lineEnd(text, last) };
}

/** Tab: indents every selected line, or inserts an indent at the caret. */
export function indent(state: TextState): Edit {
  const { text, start, end } = state;
  if (start === end || !text.slice(start, end).includes("\n")) {
    const caret = start + INDENT.length;
    return { from: start, to: end, insert: INDENT, start: caret, end: caret };
  }
  const { from, to } = selectedLines(state);
  const lines = text.slice(from, to).split("\n");
  const insert = lines.map((line) => (line.length > 0 ? INDENT + line : line)).join("\n");
  return { from, to, insert, start: from, end: from + insert.length };
}

/** Shift+Tab: removes up to one indent from the start of every selected line. */
export function outdent(state: TextState): Edit {
  const { text, start, end } = state;
  const { from, to } = selectedLines(state);
  const lines = text.slice(from, to).split("\n");
  let removedFirst = 0;
  let removed = 0;
  const insert = lines
    .map((line, i) => {
      const spaces = Math.min(INDENT.length, line.length - line.trimStart().length);
      if (i === 0) removedFirst = spaces;
      removed += spaces;
      return line.slice(spaces);
    })
    .join("\n");
  if (start === end) {
    const caret = Math.max(from, start - removedFirst);
    return { from, to, insert, start: caret, end: caret };
  }
  return {
    from,
    to,
    insert,
    start: Math.max(from, start - removedFirst),
    end: Math.max(from, end - removed),
  };
}

const OPENERS = new Set(["{", "[", "("]);

/** Enter: a new line with the current line's indentation, one more after an opening bracket. */
export function newline(state: TextState): Edit {
  const { text, start, end } = state;
  const from = lineStart(text, start);
  const line = text.slice(from, start);
  const leading = line.slice(0, line.length - line.trimStart().length);
  const opened = OPENERS.has(line.trimEnd().at(-1) ?? "");
  let insert = "\n" + leading + (opened ? INDENT : "");
  const caret = start + insert.length;
  // Between a pair of brackets, put the closing one on its own line below the caret.
  const next = text[end] ?? "";
  const closes = { "{": "}", "[": "]", "(": ")" }[line.trimEnd().at(-1) ?? ""];
  if (opened && closes !== undefined && next === closes) insert += "\n" + leading;
  return { from: start, to: end, insert, start: caret, end: caret };
}
