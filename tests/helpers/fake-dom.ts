/**
 * Just enough of the DOM for the views to mount and react in tests: elements with
 * children, text, classes, attributes and listeners; a textarea with a selection;
 * document.createElement and activeElement. window.prompt/confirm/alert throw, since the
 * editors must not depend on dialogs a browser can suppress.
 */
export class FakeClassList {
  private readonly names = new Set<string>();
  constructor(private readonly owner: FakeElement) {}
  add(...names: string[]): void {
    for (const name of names) this.names.add(name);
    this.sync();
  }
  toggle(name: string, force?: boolean): boolean {
    const on = force ?? !this.names.has(name);
    if (on) this.names.add(name);
    else this.names.delete(name);
    this.sync();
    return on;
  }
  contains(name: string): boolean {
    return this.names.has(name);
  }
  private sync(): void {
    this.owner.classNameValue = [...this.names].join(" ");
  }
}

export class FakeElement {
  readonly children: FakeElement[] = [];
  parent: FakeElement | null = null;
  classNameValue = "";
  readonly classList = new FakeClassList(this);
  readonly dataset: Record<string, string> = {};
  readonly attributes: Record<string, string> = {};
  readonly listeners = new Map<string, ((event: FakeEvent) => void)[]>();
  /** Own text; only #text nodes have it. */
  private text = "";
  hidden = false;
  disabled = false;
  title = "";
  type = "";
  value = "";
  checked = false;
  spellcheck = true;
  autocomplete = "";
  placeholder = "";
  autocapitalize = "";
  wrap = "";
  scrollTop = 0;
  scrollLeft = 0;
  readonly style: Record<string, string> = {};
  selectionStart = 0;
  selectionEnd = 0;

  constructor(readonly tagName: string) {}

  get className(): string {
    return this.classNameValue;
  }
  set className(value: string) {
    this.classNameValue = value;
    for (const name of value.split(/\s+/).filter(Boolean)) this.classList.add(name);
  }

  get textContent(): string {
    if (this.tagName === "#text") return this.text;
    return this.children.map((child) => child.textContent).join("");
  }
  set textContent(value: string) {
    this.children.length = 0;
    if (this.tagName === "#text") {
      this.text = value;
    } else if (value !== "") {
      const node = new FakeElement("#text");
      node.text = value;
      this.children.push(node);
    }
  }

  get childElementCount(): number {
    return this.children.length;
  }

  append(...nodes: (FakeElement | string)[]): void {
    for (const node of nodes) {
      if (typeof node === "string") {
        const text = new FakeElement("#text");
        text.text = node;
        this.children.push(text);
      } else {
        node.parent = this;
        this.children.push(node);
      }
    }
  }
  replaceChildren(...nodes: (FakeElement | string)[]): void {
    this.children.length = 0;
    this.append(...nodes);
  }
  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
  }
  remove(): void {
    if (!this.parent) return;
    const siblings = this.parent.children;
    siblings.splice(siblings.indexOf(this), 1);
    this.parent = null;
  }
  addEventListener(type: string, listener: (event: FakeEvent) => void): void {
    let list = this.listeners.get(type);
    if (!list) this.listeners.set(type, (list = []));
    list.push(listener);
  }
  dispatchEvent(event: FakeEvent): boolean {
    for (const listener of this.listeners.get(event.type) ?? []) listener(event);
    return !event.defaultPrevented;
  }
  /** Fires an event of this type with extra fields (e.g. key). */
  fire(type: string, fields: Record<string, unknown> = {}): FakeEvent {
    const event = Object.assign(new FakeEvent(type), fields);
    this.dispatchEvent(event);
    return event;
  }
  /** A click; on a submit button, also the form's submit. */
  click(): void {
    this.fire("click");
    if (this.tagName === "button" && this.type === "submit") this.closest("form")?.fire("submit");
  }
  closest(tag: string): FakeElement | null {
    let node: FakeElement | null = this;
    while (node && node.tagName !== tag) node = node.parent;
    return node;
  }
  focus(): void {
    fakeDocument.activeElement = this;
  }
  setSelectionRange(start: number, end: number): void {
    this.selectionStart = start;
    this.selectionEnd = end;
  }
  setRangeText(text: string, start: number, end: number): void {
    this.value = this.value.slice(0, start) + text + this.value.slice(end);
    this.selectionStart = this.selectionEnd = start + text.length;
  }

  /** Every element below this one (depth first) for which `test` holds. */
  find(test: (element: FakeElement) => boolean): FakeElement[] {
    const found: FakeElement[] = [];
    for (const child of this.children) {
      if (test(child)) found.push(child);
      found.push(...child.find(test));
    }
    return found;
  }
  byTag(tag: string): FakeElement[] {
    return this.find((element) => element.tagName === tag);
  }
  /** The first element below this one with the tag name `selector` (only tag selectors are understood). */
  querySelector(selector: string): FakeElement | null {
    return this.byTag(selector)[0] ?? null;
  }
  /** The innermost element whose text is exactly this (a button, say, not its wrapper). */
  withText(text: string): FakeElement | undefined {
    const matches = this.find((element) => element.tagName !== "#text" && element.textContent === text);
    return matches.sort((a, b) => a.find(() => true).length - b.find(() => true).length)[0];
  }
}

export class FakeEvent {
  defaultPrevented = false;
  constructor(
    readonly type: string,
    readonly init: { bubbles?: boolean } = {},
  ) {}
  preventDefault(): void {
    this.defaultPrevented = true;
  }
}

export class FakeOption extends FakeElement {
  constructor(text: string, value: string) {
    super("option");
    this.textContent = text;
    this.value = value;
  }
}

export interface FakeWindow {
  /** URLs passed to window.open. */
  opened: string[];
}

const listeners = new Map<string, ((event: FakeEvent) => void)[]>();
const fakeDocument = {
  activeElement: null as FakeElement | null,
  createElement: (tag: string) => new FakeElement(tag),
  execCommand: () => false,
  addEventListener(type: string, listener: (event: FakeEvent) => void) {
    let list = listeners.get(type);
    if (!list) listeners.set(type, (list = []));
    list.push(listener);
  },
  querySelector: () => null,
};

const noDialogs = () => {
  throw new Error("Browser dialogs must not be used: a browser can suppress them");
};

/** Installs document, window, Event, Option, HTML*Element globals. */
export function installFakeDom(): FakeWindow & { uninstall(): void } {
  const scripted: FakeWindow = { opened: [] };
  listeners.clear();
  fakeDocument.activeElement = null;
  const document = fakeDocument;
  const window = {
    prompt: noDialogs,
    confirm: noDialogs,
    alert: noDialogs,
    open: (url: string) => {
      scripted.opened.push(url);
      return null;
    },
    addEventListener: document.addEventListener,
  };
  const globals = globalThis as Record<string, unknown>;
  const previous = new Map<string, unknown>();
  const install = (name: string, value: unknown) => {
    previous.set(name, globals[name]);
    globals[name] = value;
  };
  install("document", document);
  install("window", window);
  install("Event", FakeEvent);
  install("Option", FakeOption);
  install("HTMLElement", FakeElement);
  install("HTMLInputElement", FakeElement);
  install("HTMLSelectElement", FakeElement);
  install("HTMLTextAreaElement", FakeElement);
  return {
    get opened() {
      return scripted.opened;
    },
    uninstall() {
      for (const [name, value] of previous) {
        if (value === undefined) delete globals[name];
        else globals[name] = value;
      }
    },
  };
}
