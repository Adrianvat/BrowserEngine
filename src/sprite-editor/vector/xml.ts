/** An element of a small XML document: what the editor needs to read an SVG. */
export interface XmlElement {
  /** The tag name without any namespace prefix. */
  name: string;
  attributes: Record<string, string>;
  children: XmlElement[];
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === "#") {
      const code = entity[1] === "x" || entity[1] === "X" ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[entity.toLowerCase()] ?? match;
  });
}

/**
 * Reads XML into elements (text, comments, declarations and CDATA are skipped). Enough
 * for SVG files; throws on malformed markup.
 */
export function parseXml(text: string): XmlElement {
  let position = 0;
  const stack: XmlElement[] = [];
  let root: XmlElement | null = null;

  const fail = (what: string): never => {
    throw new Error(`${what} at character ${position}`);
  };
  const skipTo = (marker: string) => {
    const end = text.indexOf(marker, position);
    if (end === -1) fail(`Unterminated ${marker}`);
    position = end + marker.length;
  };

  while (position < text.length) {
    const open = text.indexOf("<", position);
    if (open === -1) break;
    position = open;
    if (text.startsWith("<!--", position)) {
      skipTo("-->");
    } else if (text.startsWith("<![CDATA[", position)) {
      skipTo("]]>");
    } else if (text.startsWith("<?", position)) {
      skipTo("?>");
    } else if (text.startsWith("<!", position)) {
      skipTo(">");
    } else if (text.startsWith("</", position)) {
      const close = text.indexOf(">", position);
      if (close === -1) fail("Unterminated closing tag");
      const name = stripPrefix(text.slice(position + 2, close).trim());
      const element = stack.pop();
      if (!element || element.name !== name) fail(`Unexpected closing tag </${name}>`);
      position = close + 1;
    } else {
      const match = /^<([A-Za-z_:][-\w:.]*)/.exec(text.slice(position));
      if (!match) fail("Malformed tag");
      const element: XmlElement = { name: stripPrefix(match![1]), attributes: {}, children: [] };
      position += match![0].length;
      // Attributes up to the end of the tag.
      for (;;) {
        const rest = text.slice(position);
        const space = /^\s+/.exec(rest);
        if (space) {
          position += space[0].length;
          continue;
        }
        if (rest.startsWith("/>")) {
          position += 2;
          attach(element, true);
          break;
        }
        if (rest.startsWith(">")) {
          position += 1;
          attach(element, false);
          break;
        }
        const attribute = /^([A-Za-z_:][-\w:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(rest);
        if (!attribute) fail("Malformed attribute");
        element.attributes[stripPrefix(attribute![1])] = decode(attribute![2] ?? attribute![3] ?? "");
        position += attribute![0].length;
      }
    }
  }
  if (stack.length > 0) fail(`Unclosed <${stack[stack.length - 1].name}>`);
  if (!root) throw new Error("No elements found");
  return root;

  function attach(element: XmlElement, selfClosing: boolean): void {
    const parent = stack[stack.length - 1];
    if (parent) parent.children.push(element);
    else if (!root) root = element;
    else fail("More than one root element");
    if (!selfClosing) stack.push(element);
  }
}

/** "svg:rect" and "xlink:href" keep only the part after the colon (xmlns declarations are left alone). */
function stripPrefix(name: string): string {
  if (name.startsWith("xmlns")) return name;
  const colon = name.indexOf(":");
  return colon === -1 ? name : name.slice(colon + 1);
}
