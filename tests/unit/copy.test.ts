/**
 * Copy-length tests — no browser, no validator.
 *
 * Every page in this repo is read by someone deciding whether to care, and the
 * failure mode is the same each time: a short, clear line gets "improved" into a
 * paragraph that nobody finishes. That is what the landing hero had become — four
 * lines and 45 words where 13 would do — and what the deck slides and the
 * Explorer footnotes had drifted into too.
 *
 * So the limits are asserted. They are deliberately generous enough to allow
 * real explanation and tight enough to catch a wall of text: a lead line is one
 * sentence, and nothing on a slide or a page footer runs past a few lines.
 *
 * Words are counted after stripping markup, so `</strong>` and inline links do
 * not count as prose.
 */
import { expect } from "chai";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function read(file: string): string {
  return readFileSync(join(root, file), "utf8");
}

/** Drop the parts of a page that are not prose. */
function prose(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
}

function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function words(value: string): number {
  return value.split(" ").filter(Boolean).length;
}

/** Every `<tag ...>…</tag>` block for the given tags, in document order. */
function blocks(html: string, tags: string[]): string[] {
  const found: string[] = [];
  for (const tag of tags) {
    const re = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?</${tag}>`, "gi");
    const matches = html.match(re);
    if (matches) found.push(...matches);
  }
  return found;
}

describe("page copy stays short", () => {
  const deck = prose(read("deck.html"));
  const explorer = prose(read("explorer.html"));

  it("gives every deck slide a one-sentence lead", () => {
    const leads = blocks(deck, ["p"]).filter((b) => /class="lead"/.test(b));
    expect(leads.length, "no slide leads found").to.be.at.least(6);
    leads.forEach((lead) => {
      const count = words(text(lead));
      expect(count, `slide lead is ${count} words: ${text(lead).slice(0, 90)}`).to.be.at.most(22);
    });
  });

  it("keeps every deck block to a few lines", () => {
    const offenders = blocks(deck, ["p", "li", "span", "h2", "h3"])
      .map(text)
      .filter((t) => words(t) > 45);
    expect(offenders, `deck blocks too long:\n${offenders.join("\n")}`).to.deep.equal([]);
  });

  it("keeps the Explorer notes readable", () => {
    const notes = blocks(explorer, ["p"]).flatMap((block) => block.split(/<br\s*\/?>/i));
    const offenders = notes.map(text).filter((t) => words(t) > 60);
    expect(offenders, `explorer notes too long:\n${offenders.join("\n")}`).to.deep.equal([]);
  });

  it("keeps the top of the README skimmable", () => {
    const lines = read("README.md").split(/\r?\n/).slice(0, 60);
    const paragraphs: string[] = [];
    let current: string[] = [];
    lines.forEach((line) => {
      if (!line.trim()) {
        if (current.length) paragraphs.push(current.join(" "));
        current = [];
        return;
      }
      current.push(line.trim());
    });
    if (current.length) paragraphs.push(current.join(" "));

    // Lists, tables and embedded HTML are counted one row at a time by the eye,
    // so only running prose is measured here.
    const offenders = paragraphs
      .filter((p) => !/^\s*([-|#!<]|```)/.test(p))
      .map((p) => p.replace(/[#*>`[\]()]/g, " ").replace(/\s+/g, " ").trim())
      .filter((p) => words(p) > 45);
    expect(offenders, `README paragraphs too long:\n${offenders.join("\n")}`).to.deep.equal([]);
  });
});
