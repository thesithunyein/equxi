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
import { existsSync, readFileSync } from "node:fs";
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

  it("gives every dashboard section one plain line of orientation", () => {
    const dashboard = prose(read("app.html"));
    const descriptions = blocks(dashboard, ["p"]).filter((b) => /class="section-desc"/.test(b));
    expect(descriptions.length, "no section descriptions found").to.be.at.least(3);
    descriptions.forEach((d) => {
      const count = words(text(d));
      expect(count, `section description is ${count} words: ${text(d)}`).to.be.at.most(20);
    });
  });

  it("calls a slash a slash on every page a person reads", () => {
    // One idea, one word. The dashboard used to call the same on-chain event a
    // "violation" while the landing page and the Explorer called it a slash,
    // which read as two different things. The docs are the one place the
    // distinction between breaking a rule and the penalty is worth spelling
    // out, so they are out of scope here.
    ["index.html", "app.html", "explorer.html"].forEach((file) => {
      const body = text(prose(read(file))).toLowerCase();
      expect(body, `${file} says "violation" where the rest of the site says slash`).to.not.include(
        "violation"
      );
      expect(body, `${file} never mentions slashing`).to.include("slash");
    });
  });

  it("leaves no page without a route to the others", () => {
    // Every top-level page has to reach all four destinations. The landing page
    // had no footer links at all, the Explorer's primary button opened the app
    // while the landing page's opened the registry, and docs.html could not
    // reach the Explorer — three ways to hit a dead end from a judge's click.
    const pages = ["index.html", "explorer.html", "docs.html", "app.html"];
    pages.forEach((page) => {
      const body = read(page);
      pages
        .filter((target) => target !== page)
        .forEach((target) => {
          expect(body, `${page} has no link to ${target}`).to.include(`href="${target}"`);
        });
    });
  });

  it("links to no page that does not exist", () => {
    // A renamed file leaves a link that 404s for a reader and is invisible in
    // every other form of review.
    const pages = ["index.html", "explorer.html", "docs.html", "app.html", "deck.html"];
    const missing: string[] = [];
    pages.forEach((page) => {
      const hrefs = Array.from(read(page).matchAll(/href="([^"#:?]+\.html)"/g)).map(
        (m) => m[1]
      );
      hrefs.forEach((href) => {
        if (!existsSync(join(root, href))) missing.push(`${page} → ${href}`);
      });
    });
    expect(missing, `links to files that do not exist: ${missing.join(", ")}`).to.deep.equal(
      []
    );
  });

  it("does not repeat the same labelled link above the fold", () => {
    // The landing page's header button and its hero button both said "Check an
    // agent" and both pointed at the Explorer: two identical buttons stacked
    // one screen apart. Different labels for the same destination are fine (a
    // nav item and a call to action read differently); identical ones are not.
    const pages = ["index.html", "explorer.html", "docs.html"];
    pages.forEach((page) => {
      const body = read(page);
      const header = (body.match(/<header[\s\S]*?<\/header>/) || [""])[0];
      const hero = (body.match(/<main[\s\S]*?<\/main>/) || [""])[0];
      const seen = new Map<string, number>();
      Array.from((header + hero).matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)).forEach(
        (m) => {
          const label = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
          if (!label) return;
          const key = `${label} → ${m[1]}`;
          seen.set(key, (seen.get(key) || 0) + 1);
        }
      );
      const repeated = Array.from(seen.entries())
        .filter(([, count]) => count > 1)
        .map(([key, count]) => `${key} ×${count}`);
      expect(repeated, `${page} repeats a button: ${repeated.join(", ")}`).to.deep.equal([]);
    });
  });

  it("does not invent a second name for the collateral", () => {
    // The dashboard called the locked SOL a "stake", a "safety deposit" and
    // "Total Locked" in three different places; the landing page calls it
    // collateral, and so does everything else now.
    const retired = [/safety deposit/i, /Total Locked/i, /Lock funds/i];
    ["index.html", "app.html", "explorer.html", "app.js"].forEach((file) => {
      const body = read(file);
      retired.forEach((pattern) => {
        expect(body, `${file} still uses ${pattern}`).to.not.match(pattern);
      });
    });
  });
});
