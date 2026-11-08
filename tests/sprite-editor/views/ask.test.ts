import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { createAsker } from "../../../src/sprite-editor/views/ask";
import { FakeElement, installFakeDom } from "../../helpers/fake-dom";

let dom: ReturnType<typeof installFakeDom>;

beforeEach(() => {
  dom = installFakeDom();
});
afterEach(() => {
  dom.uninstall();
});

function setup() {
  const asker = createAsker();
  const element = asker.element as unknown as FakeElement;
  return { asker, element };
}

describe("createAsker", () => {
  it("is hidden and empty until asked", () => {
    const { element } = setup();
    expect(element.hidden).toBe(true);
    expect(element.children).toHaveLength(0);
  });

  it("shows the question with the yes button focused, and resolves true on yes", async () => {
    const { asker, element } = setup();
    const answer = asker.ask("Replace the existing image \"hero\"?", "Replace");
    expect(element.hidden).toBe(false);
    expect(element.textContent).toBe('Replace the existing image "hero"?ReplaceCancel');
    const yes = element.withText("Replace")!;
    expect(document.activeElement).toBe(yes);
    yes.click();
    await expect(answer).resolves.toBe(true);
    expect(element.hidden).toBe(true);
    expect(element.children).toHaveLength(0);
  });

  it("resolves false on Cancel or Escape", async () => {
    const { asker, element } = setup();
    const first = asker.ask("Discard?");
    element.withText("Cancel")!.click();
    await expect(first).resolves.toBe(false);

    const second = asker.ask("Discard?");
    element.fire("keydown", { key: "Escape" });
    await expect(second).resolves.toBe(false);
    expect(element.hidden).toBe(true);
  });

  it("answers an open question with false when a new one is asked", async () => {
    const { asker, element } = setup();
    const first = asker.ask("First?");
    const second = asker.ask("Second?", "OK");
    await expect(first).resolves.toBe(false);
    expect(element.textContent).toBe("Second?OKCancel");
    element.withText("OK")!.click();
    await expect(second).resolves.toBe(true);
  });

  it("ignores clicks on a stale question's buttons", async () => {
    const { asker, element } = setup();
    void asker.ask("First?");
    const staleYes = element.withText("Yes")!;
    const second = asker.ask("Second?");
    staleYes.click(); // Detached by now; must not answer the second question.
    element.withText("Cancel")!.click();
    await expect(second).resolves.toBe(false);
  });
});
