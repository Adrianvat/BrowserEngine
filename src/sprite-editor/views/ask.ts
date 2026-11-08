/** An inline yes/no question: what `window.confirm` did, without a browser dialog. */
export interface Asker {
  /** Where the question shows; empty (and hidden) while nothing is asked. */
  readonly element: HTMLElement;
  /**
   * Shows the question and resolves true for the yes button, false for Cancel or Escape.
   * Asking again while a question is open answers the open one with false.
   */
  ask(question: string, yes?: string): Promise<boolean>;
}

/**
 * Browser dialogs are not used in the editors: a browser can suppress them (the "don't
 * let this page create more dialogs" box, sandboxed frames), and then `confirm` returns
 * false at once, so the action would silently never happen.
 */
export function createAsker(): Asker {
  const element = document.createElement("span");
  element.className = "ask";
  element.setAttribute("role", "alertdialog");
  element.hidden = true;

  let answer: ((yes: boolean) => void) | null = null;
  const settle = (yes: boolean) => {
    const resolve = answer;
    answer = null;
    element.replaceChildren();
    element.hidden = true;
    resolve?.(yes);
  };

  element.addEventListener("keydown", (event) => {
    if ((event as KeyboardEvent).key === "Escape") settle(false);
  });

  const ask = (question: string, yes = "Yes"): Promise<boolean> => {
    settle(false);
    return new Promise<boolean>((resolve) => {
      answer = resolve;
      // Only while this question is the open one; a superseded question's buttons do nothing.
      const reply = (value: boolean) => {
        if (answer === resolve) settle(value);
      };
      const text = document.createElement("span");
      text.className = "question";
      text.textContent = question;
      const ok = document.createElement("button");
      ok.textContent = yes;
      ok.addEventListener("click", () => reply(true));
      const cancel = document.createElement("button");
      cancel.textContent = "Cancel";
      cancel.addEventListener("click", () => reply(false));
      element.replaceChildren(text, ok, cancel);
      element.hidden = false;
      ok.focus();
    });
  };

  return { element, ask };
}
