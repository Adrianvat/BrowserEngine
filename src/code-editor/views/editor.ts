import { scriptPath } from "../../engine";
import type { CodeEditorModel } from "../model";
import type { Completion, Suggester } from "../suggest";
import { indent, newline, outdent, type Edit, type TextState } from "../text-edit";
import { renderHighlighted } from "./highlighted";

/** The editor's line height in px when the page's CSS can't be read (it sets 20px). */
const DEFAULT_LINE_HEIGHT = 20;
/** A character's width in px when it can't be measured (13px monospace is about this). */
const DEFAULT_CHAR_WIDTH = 7.8;

export interface EditorOptions {
  /** Completes the word at the caret; without it there are no suggestions. */
  suggester?: Suggester;
}

/** Applies an edit to the textarea, through the browser's own undo history where it can. */
function apply(area: HTMLTextAreaElement, edit: Edit): void {
  area.focus();
  area.setSelectionRange(edit.from, edit.to);
  let done = false;
  try {
    // Deprecated, but still the only way to keep Ctrl+Z working for the change.
    done = document.execCommand("insertText", false, edit.insert);
  } catch {
    done = false;
  }
  if (!done || area.value.slice(edit.from, edit.from + edit.insert.length) !== edit.insert) {
    area.setRangeText(edit.insert, edit.from, edit.to, "end");
    area.dispatchEvent(new Event("input", { bubbles: true }));
  }
  area.setSelectionRange(edit.start, edit.end);
}

function stateOf(area: HTMLTextAreaElement): TextState {
  return { text: area.value, start: area.selectionStart, end: area.selectionEnd };
}

/** A CSS length of the textarea in px (its line height, its top padding). */
function pixels(
  area: HTMLElement,
  property: "lineHeight" | "paddingTop",
  fallback: number,
): number {
  if (typeof getComputedStyle !== "function") return fallback;
  const value = parseFloat(getComputedStyle(area)[property]);
  return Number.isFinite(value) ? value : fallback;
}

/**
 * The open script's code, syntax-highlighted, with line numbers and the caret's line
 * marked. The text is typed into a textarea whose own letters are transparent, laid
 * exactly over a colored copy, so editing, selection and undo stay the browser's own.
 * Tab indents (Shift+Tab outdents; Escape then Tab leaves the editor), Enter keeps the
 * indentation, and every keystroke becomes a draft in the model. The text is only
 * replaced when another script is opened or its text changed elsewhere.
 *
 * Suggestions pop up under the word being typed (or on Ctrl+Space): Up/Down choose,
 * Enter or Tab accepts, Escape dismisses them for that word.
 */
export function mountEditor(
  root: HTMLElement,
  model: CodeEditorModel,
  options: EditorOptions = {},
): void {
  const header = document.createElement("div");
  header.className = "editor-header";
  const path = document.createElement("span");
  path.className = "path";
  const state = document.createElement("span");
  state.className = "state";
  header.append(path, state);

  const body = document.createElement("div");
  body.className = "editor-body";
  const gutter = document.createElement("pre");
  gutter.className = "gutter";
  gutter.setAttribute("aria-hidden", "true");

  const stack = document.createElement("div");
  stack.className = "code-stack";
  const currentLine = document.createElement("div");
  currentLine.className = "current-line";
  currentLine.setAttribute("aria-hidden", "true");
  const colored = document.createElement("pre");
  colored.className = "highlight";
  colored.setAttribute("aria-hidden", "true");
  const area = document.createElement("textarea");
  area.className = "code";
  area.spellcheck = false;
  area.autocapitalize = "off";
  area.wrap = "off";
  area.setAttribute("autocomplete", "off");
  area.setAttribute("aria-label", "Script code");
  area.title =
    "Tab indents; Ctrl+Space suggests names; press Escape, then Tab, to move focus out of the editor";
  const popup = document.createElement("ul");
  popup.className = "suggest";
  popup.setAttribute("role", "listbox");
  popup.hidden = true;
  stack.append(currentLine, colored, area, popup);
  body.append(gutter, stack);

  const placeholder = document.createElement("p");
  placeholder.className = "placeholder";
  placeholder.textContent = "Select a system or component on the left, or add one.";

  root.replaceChildren(header, body, placeholder);

  let shownPath = "";
  let lineCount = 0;
  const renumber = () => {
    const lines = area.value.split("\n").length;
    if (lines === lineCount) return;
    lineCount = lines;
    gutter.textContent = Array.from({ length: lines }, (_, i) => String(i + 1)).join("\n");
  };

  /** Keeps the colored copy, the line numbers and the line marker where the text is. */
  const followScroll = () => {
    colored.scrollTop = area.scrollTop;
    colored.scrollLeft = area.scrollLeft;
    gutter.scrollTop = area.scrollTop;
  };
  const markCurrentLine = () => {
    const line = area.value.slice(0, area.selectionStart).split("\n").length - 1;
    const height = pixels(area, "lineHeight", DEFAULT_LINE_HEIGHT);
    const top = pixels(area, "paddingTop", 8) + line * height - area.scrollTop;
    currentLine.style.top = `${top}px`;
    currentLine.style.height = `${height}px`;
  };
  const recolor = () => {
    // A text ending in a newline has an empty last line; the space gives it its height.
    renderHighlighted(colored, area.value.endsWith("\n") ? area.value + " " : area.value);
    renumber();
    followScroll();
    markCurrentLine();
  };

  // --- Suggestions ---------------------------------------------------------------------
  const { suggester } = options;
  let completion: Completion | null = null;
  let chosen = 0;
  /** A word the user dismissed (or just accepted): no more suggestions until it changes. */
  let dismissed: { from: number; word: string } | null = null;
  let charWidth = 0;

  const measureCharWidth = (): number => {
    if (charWidth > 0) return charWidth;
    const probe = document.createElement("span");
    probe.textContent = "0".repeat(20);
    colored.append(probe);
    const measured = probe as { getBoundingClientRect?: () => { width: number } };
    const width = measured.getBoundingClientRect?.().width;
    probe.remove();
    charWidth = width && width > 0 ? width / 20 : DEFAULT_CHAR_WIDTH;
    return charWidth;
  };
  const hideSuggestions = () => {
    completion = null;
    popup.hidden = true;
  };
  const placePopup = () => {
    if (!completion) return;
    const { from } = completion;
    const line = area.value.slice(0, from).split("\n").length - 1;
    const column = from - (area.value.lastIndexOf("\n", from - 1) + 1);
    const height = pixels(area, "lineHeight", DEFAULT_LINE_HEIGHT);
    const lineTop = pixels(area, "paddingTop", 8) + line * height - area.scrollTop;
    const left = 10 + column * measureCharWidth() - area.scrollLeft;
    const own = (popup as { offsetHeight?: number }).offsetHeight ?? 0;
    const room = (stack as { clientHeight?: number }).clientHeight ?? Infinity;
    // Below the line, unless it would not fit: then above it.
    const fitsBelow = lineTop + height + own <= room || lineTop - own < 0;
    const top = fitsBelow ? lineTop + height : lineTop - own;
    popup.style.top = `${top}px`;
    popup.style.left = `${Math.max(0, left)}px`;
  };
  const renderSuggestions = () => {
    if (!completion) return;
    popup.replaceChildren(
      ...completion.items.map((item, index) => {
        const li = document.createElement("li");
        li.setAttribute("role", "option");
        li.setAttribute("aria-selected", String(index === chosen));
        li.classList.toggle("selected", index === chosen);
        const text = document.createElement("span");
        text.className = "text";
        text.textContent = item.text;
        const kind = document.createElement("span");
        kind.className = "kind";
        kind.textContent = item.kind;
        li.append(text, kind);
        // mousedown would move the focus out of the textarea.
        li.addEventListener("mousedown", (event) => event.preventDefault());
        li.addEventListener("click", () => acceptSuggestion(index));
        li.addEventListener("mousemove", () => {
          if (chosen !== index) {
            chosen = index;
            renderSuggestions();
          }
        });
        return li;
      }),
    );
    popup.hidden = false;
    placePopup();
  };
  const showSuggestions = (explicit: boolean) => {
    const { selected } = model;
    if (!suggester || !selected) return hideSuggestions();
    const found = suggester.suggest({
      text: area.value,
      caret: area.selectionStart,
      scripts: model.withDrafts(),
      currentPath: scriptPath(selected.kind, selected.name),
      explicit,
    });
    const word = found ? area.value.slice(found.from, found.to) : "";
    const stillDismissed =
      found !== null &&
      dismissed !== null &&
      dismissed.from === found.from &&
      dismissed.word === word;
    if (!found || (stillDismissed && !explicit)) return hideSuggestions();
    dismissed = null;
    completion = found;
    chosen = 0;
    renderSuggestions();
  };
  const acceptSuggestion = (index: number) => {
    if (!completion) return;
    const { from, to } = completion;
    const { text } = completion.items[index];
    hideSuggestions();
    dismissed = { from, word: text };
    apply(area, { from, to, insert: text, start: from + text.length, end: from + text.length });
  };
  const moveChoice = (step: number) => {
    if (!completion) return;
    chosen = (chosen + step + completion.items.length) % completion.items.length;
    renderSuggestions();
  };
  /** The caret left the word the suggestions were for. */
  const checkCaret = () => {
    if (completion && area.selectionStart !== completion.to) hideSuggestions();
  };

  area.addEventListener("input", () => {
    if (model.selected) model.edit(area.value);
    recolor();
    showSuggestions(false);
  });
  area.addEventListener("scroll", () => {
    followScroll();
    markCurrentLine();
    placePopup();
  });
  for (const type of ["keyup", "mouseup", "focus", "select"]) {
    area.addEventListener(type, () => {
      markCurrentLine();
      checkCaret();
    });
  }
  area.addEventListener("blur", hideSuggestions);
  document.addEventListener("selectionchange", () => {
    if (document.activeElement === area) {
      markCurrentLine();
      checkCaret();
    }
  });

  let tabLeaves = false;
  area.addEventListener("keydown", (event) => {
    if (event.isComposing) return;
    if ((event.ctrlKey || event.metaKey) && event.key === " ") {
      event.preventDefault();
      showSuggestions(true);
      return;
    }
    if (completion) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        moveChoice(event.key === "ArrowDown" ? 1 : -1);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        acceptSuggestion(chosen);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        const { from, to } = completion;
        dismissed = { from, word: area.value.slice(from, to) };
        hideSuggestions();
        return;
      }
    }
    if (event.key === "Escape") {
      tabLeaves = true;
      return;
    }
    if (event.key === "Tab") {
      if (tabLeaves) {
        tabLeaves = false;
        return; // The browser moves the focus on.
      }
      event.preventDefault();
      apply(area, event.shiftKey ? outdent(stateOf(area)) : indent(stateOf(area)));
    } else if (event.key === "Enter" && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      apply(area, newline(stateOf(area)));
    }
    tabLeaves = false;
  });

  const update = () => {
    const { selected } = model;
    const text = model.text;
    const open = selected !== null && text !== null;
    body.hidden = !open;
    header.hidden = !open;
    placeholder.hidden = open;
    if (!open || !selected) {
      shownPath = "";
      return;
    }
    const current = scriptPath(selected.kind, selected.name);
    path.textContent = current;
    const dirty = model.isDirty(selected.kind, selected.name);
    state.textContent = dirty ? "● unsaved — Ctrl+S to save" : "";
    // Typing already put the text in the model; only replace it for another script or an
    // outside change, so the caret and the undo history survive.
    if (current !== shownPath || area.value !== text) {
      const switching = current !== shownPath;
      area.value = text;
      if (switching) {
        area.scrollTop = 0;
        area.scrollLeft = 0;
        area.setSelectionRange(0, 0);
      }
      shownPath = current;
      lineCount = 0;
      hideSuggestions();
      recolor();
    }
  };
  model.onChange(update);
  update();
}
