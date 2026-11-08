/**
 * A button that asks before acting, inline: clicking it swaps in the question with Yes
 * and Cancel. Browser dialogs (confirm/prompt) are not used anywhere in the code editor,
 * since a browser can suppress them, which would make the action silently do nothing.
 */
export function confirmingButton(
  label: string,
  question: string,
  onConfirm: () => void,
  className = "",
): HTMLSpanElement {
  const holder = document.createElement("span");
  holder.className = "confirming";

  const button = document.createElement("button");
  button.textContent = label;
  button.className = className;

  const ask = () => {
    const text = document.createElement("span");
    text.className = "question";
    text.textContent = question;
    const yes = document.createElement("button");
    yes.textContent = "Yes";
    yes.className = className;
    yes.addEventListener("click", () => {
      holder.replaceChildren(button);
      onConfirm();
    });
    const cancel = document.createElement("button");
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", () => holder.replaceChildren(button));
    holder.replaceChildren(text, yes, cancel);
    yes.focus();
  };
  button.addEventListener("click", ask);

  holder.replaceChildren(button);
  return holder;
}
