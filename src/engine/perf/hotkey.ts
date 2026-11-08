/**
 * A key with the modifiers that must be held with it. `code` is a KeyboardEvent.code
 * value ("F3", "KeyP", "Backquote"...), naming a physical key like the Keyboard resource does.
 */
export interface Hotkey {
  code: string;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
}

/** The parts of a KeyboardEvent a hotkey looks at. */
export interface KeyLike {
  code?: string;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
}

const MODIFIERS: Record<string, keyof Omit<Hotkey, "code">> = {
  ctrl: "ctrl",
  control: "ctrl",
  shift: "shift",
  alt: "alt",
  option: "alt",
  meta: "meta",
  cmd: "meta",
  command: "meta",
};

/**
 * Parses text like "F3", "Shift+F3" or "Ctrl+Alt+KeyP": modifiers (Ctrl, Shift, Alt, Meta;
 * any case) joined by "+", with the key's code last (exact case).
 */
export function parseHotkey(text: string): Hotkey {
  const parts = text.split("+").map((part) => part.trim());
  const code = parts.pop() ?? "";
  if (code === "" || parts.some((part) => part === "")) {
    throw new Error(`Hotkey "${text}" needs a key code, e.g. "F3" or "Shift+F3"`);
  }
  const hotkey: Hotkey = { code, ctrl: false, shift: false, alt: false, meta: false };
  for (const part of parts) {
    const modifier = MODIFIERS[part.toLowerCase()];
    if (!modifier) {
      throw new Error(
        `Hotkey "${text}": unknown modifier "${part}" (use Ctrl, Shift, Alt or Meta)`,
      );
    }
    if (hotkey[modifier]) throw new Error(`Hotkey "${text}": modifier "${part}" is repeated`);
    hotkey[modifier] = true;
  }
  return hotkey;
}

/** True when the event is this key with exactly these modifiers held (no extra ones). */
export function matchesHotkey(hotkey: Hotkey, event: KeyLike): boolean {
  return (
    event.code === hotkey.code &&
    (event.ctrlKey ?? false) === hotkey.ctrl &&
    (event.shiftKey ?? false) === hotkey.shift &&
    (event.altKey ?? false) === hotkey.alt &&
    (event.metaKey ?? false) === hotkey.meta
  );
}

/** The hotkey written back out, e.g. "Ctrl+Shift+F3". */
export function formatHotkey(hotkey: Hotkey): string {
  const parts: string[] = [];
  if (hotkey.ctrl) parts.push("Ctrl");
  if (hotkey.shift) parts.push("Shift");
  if (hotkey.alt) parts.push("Alt");
  if (hotkey.meta) parts.push("Meta");
  parts.push(hotkey.code);
  return parts.join("+");
}
