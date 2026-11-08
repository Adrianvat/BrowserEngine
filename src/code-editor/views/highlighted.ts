import { tokenize } from "../highlight";

/**
 * Fills `target` with `code` as highlighted spans (class "tok-<kind>"; plain text stays a
 * text node). The colors themselves live in the page's CSS, as --tok-* variables.
 */
export function renderHighlighted(target: HTMLElement, code: string): void {
  const nodes: (HTMLElement | string)[] = [];
  for (const token of tokenize(code)) {
    if (token.kind === null) {
      nodes.push(token.text);
      continue;
    }
    const span = document.createElement("span");
    span.className = `tok-${token.kind}`;
    span.textContent = token.text;
    nodes.push(span);
  }
  target.replaceChildren(...nodes);
}
