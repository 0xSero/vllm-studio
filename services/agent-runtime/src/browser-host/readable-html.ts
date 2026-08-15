import { Parser } from "htmlparser2";

const BLOCK_TAGS = new Set(
  "article body div footer h1 h2 h3 h4 h5 h6 header li main ol p section table tbody td th thead tr ul".split(
    " ",
  ),
);
const OMIT_TAGS = new Set("iframe noscript script style svg".split(" "));

type LinkState = {
  depth: number;
  href: string;
  parts: string[];
};

class ReadableWriter {
  private readonly parts: string[] = [];
  private link: LinkState | null = null;

  constructor(private readonly baseUrl: string) {}

  open(name: string, attributes: Record<string, string>): void {
    if (name === "a") {
      if (this.link) this.link.depth += 1;
      else this.link = { depth: 1, href: attributes["href"] ?? "", parts: [] };
      return;
    }
    if (name === "br") this.append("\n");
    if (name === "img") this.text(attributes["alt"] ?? "");
  }

  close(name: string): void {
    if (name === "a" && this.link) {
      this.link.depth -= 1;
      if (this.link.depth === 0) this.flushLink();
      return;
    }
    if (BLOCK_TAGS.has(name)) this.append("\n\n");
  }

  text(value: string): void {
    this.append(value.replaceAll("<", "\\<").replaceAll(">", "\\>"));
  }

  finish(): string {
    if (this.link) this.flushLink();
    return this.parts
      .join("")
      .split(/\n+/u)
      .map((line) => line.trim())
      .filter(Boolean)
      .join("\n\n");
  }

  private append(value: string): void {
    if (!value) return;
    if (this.link) this.link.parts.push(value);
    else this.parts.push(value);
  }

  private flushLink(): void {
    const link = this.link;
    if (!link) return;
    this.link = null;
    const label = link.parts.join("").replace(/\s+/gu, " ").trim();
    const href = resolveHttpHref(link.href, this.baseUrl);
    if (!href) {
      this.append(label);
      return;
    }
    const escapedLabel = label
      .replaceAll("\\", "\\\\")
      .replaceAll("[", "\\[")
      .replaceAll("]", "\\]");
    const destination = href.replaceAll("(", "%28").replaceAll(")", "%29");
    this.append(escapedLabel ? `[${escapedLabel}](${destination})` : destination);
  }
}

const resolveHttpHref = (raw: string, baseUrl: string): string => {
  try {
    const resolved = new URL(raw, baseUrl);
    return resolved.protocol === "http:" || resolved.protocol === "https:"
      ? resolved.toString()
      : "";
  } catch {
    return "";
  }
};

const normalizedInlineText = (parts: string[]): string =>
  parts.join("").replace(/\s+/gu, " ").trim();

export function readableHtml(html: string, baseUrl: string): { title: string; text: string } {
  const fallback = new ReadableWriter(baseUrl);
  const body = new ReadableWriter(baseUrl);
  const titleParts: string[] = [];
  let bodyDepth = 0;
  let bodySeen = false;
  let headDepth = 0;
  let omitDepth = 0;
  let titleDepth = 0;

  const parser = new Parser(
    {
      onopentag(name, attributes) {
        if (omitDepth > 0) {
          omitDepth += 1;
          return;
        }
        if (OMIT_TAGS.has(name)) {
          omitDepth = 1;
          return;
        }
        if (name === "head") {
          headDepth += 1;
          return;
        }
        if (name === "title") {
          titleDepth += 1;
          return;
        }
        if (name === "body") {
          bodySeen = true;
          bodyDepth += 1;
          return;
        }
        if (headDepth > 0) return;
        fallback.open(name, attributes);
        if (bodyDepth > 0) body.open(name, attributes);
      },
      ontext(value) {
        if (omitDepth > 0) return;
        if (titleDepth > 0) titleParts.push(value);
        if (headDepth > 0 || titleDepth > 0) return;
        fallback.text(value);
        if (bodyDepth > 0) body.text(value);
      },
      onclosetag(name) {
        if (omitDepth > 0) {
          omitDepth -= 1;
          return;
        }
        if (name === "title") {
          titleDepth = Math.max(0, titleDepth - 1);
          return;
        }
        if (name === "head") {
          headDepth = Math.max(0, headDepth - 1);
          return;
        }
        if (name === "body") {
          bodyDepth = Math.max(0, bodyDepth - 1);
          return;
        }
        if (headDepth > 0) return;
        fallback.close(name);
        if (bodyDepth > 0) body.close(name);
      },
    },
    { decodeEntities: true, lowerCaseAttributeNames: true, lowerCaseTags: true },
  );
  parser.end(html);

  return {
    title: normalizedInlineText(titleParts) || baseUrl,
    text: bodySeen ? body.finish() : fallback.finish(),
  };
}

export const htmlTitle = (html: string): string => readableHtml(html, "").title;
