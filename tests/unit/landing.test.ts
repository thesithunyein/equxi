/**
 * Landing-page tests — no browser, no validator, no jsdom.
 *
 * The landing page has two jobs and both are easy to break silently:
 *
 *   * **It says almost nothing.** A visitor decides in a few seconds, so every
 *     block on it is deliberately one short line. This file measures that, so a
 *     later "improvement" cannot quietly paste the wall of prose back in.
 *   * **Its numbers are live.** The tiles and the collateral board are filled
 *     by `landing.js` from `/api/trust`. The HTML and the script agree on a set
 *     of `data-fill` keys; a typo in either leaves a tile reading `—` forever
 *     with no error anywhere. The keys are asserted to match exactly.
 *
 * These are static checks on the two files because the site ships unbuilt: a
 * parser or a headless browser would be a new dependency in a repo whose read
 * path is deliberately dependency-free.
 */
import { expect } from "chai";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// `test:unit` is run from the repository root (`npm run test:unit`), and the
// loader may strip types as ESM, where `__dirname` is not defined. The working
// directory is the only anchor that holds in both readings.
const root = process.cwd();
const html = readFileSync(join(root, "index.html"), "utf8");
const landing = readFileSync(join(root, "landing.js"), "utf8");

/** Keys the HTML promises to fill, e.g. `data-fill="bonded"`. */
function fillKeysInHtml(): string[] {
  const found = html.match(/data-fill="([a-zA-Z0-9_-]+)"/g) || [];
  return found.map((m) => m.replace(/^data-fill="/, "").replace(/"$/, ""));
}

/** Keys the script claims to fill, e.g. `set("bonded", …)`. */
function fillKeysInScript(): string[] {
  const found = landing.match(/\bset\("([a-zA-Z0-9_-]+)"/g) || [];
  return found.map((m) => m.replace(/^set\("/, "").replace(/"$/, ""));
}

function words(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

describe("landing page", () => {
  it("keeps the hero to a single short line", () => {
    const match = html.match(/<p class="subhead">([\s\S]*?)<\/p>/);
    expect(match, "the hero has no .subhead paragraph").to.not.equal(null);
    const line = words((match as RegExpMatchArray)[1].replace(/<[^>]+>/g, " "));
    expect(line, `hero subhead is ${line} words`).to.be.at.most(16);
  });

  it("keeps every card and section subhead to one line", () => {
    const subs = html.match(/<p class="how-sub">([\s\S]*?)<\/p>/g) || [];
    expect(subs.length, "expected the how-sub paragraphs").to.be.at.least(3);
    subs.forEach((block) => {
      const text = block.replace(/<[^>]+>/g, " ").replace("how-sub", "");
      expect(words(text), `section subhead too long: ${text.trim()}`).to.be.at.most(16);
    });

    const cards = html.match(/<div class="how-card">[\s\S]*?<p>([\s\S]*?)<\/p>/g) || [];
    expect(cards.length, "expected the how-card paragraphs").to.be.at.least(6);
    cards.forEach((block) => {
      const text = (block.match(/<p>([\s\S]*?)<\/p>/) as RegExpMatchArray)[1].replace(
        /<[^>]+>/g,
        " "
      );
      expect(words(text), `card copy too long: ${text.trim()}`).to.be.at.most(16);
    });
  });

  it("keeps the meta description inside what a search result shows", () => {
    const match = html.match(/<meta name="description" content="([^"]*)"/);
    expect(match, "no meta description").to.not.equal(null);
    expect((match as RegExpMatchArray)[1].length).to.be.at.most(160);
  });

  it("declares every live tile it renders", () => {
    const htmlKeys = fillKeysInHtml();
    expect(htmlKeys.length, "no data-fill keys in index.html").to.be.at.least(4);
    expect(new Set(htmlKeys).size, "duplicate data-fill keys").to.equal(htmlKeys.length);
  });

  it("fills exactly the keys the HTML declares, and no others", () => {
    const htmlKeys = fillKeysInHtml().sort();
    const scriptKeys = Array.from(new Set(fillKeysInScript())).sort();
    expect(scriptKeys).to.deep.equal(htmlKeys);
  });

  it("shows an em dash, not a zero, before the read lands", () => {
    // A failed fetch and an empty cluster must never render the same way, and
    // a zero on first paint is the failure mode that looks like real data.
    const fills = html.match(/data-fill="[a-zA-Z0-9_-]+">([^<]*)</g) || [];
    expect(fills.length).to.be.at.least(4);
    fills.forEach((block) => {
      expect(block, `placeholder is not an em dash: ${block}`).to.match(/—<$/);
    });
  });

  it("reports a failed read instead of papering over it", () => {
    expect(landing).to.include("Could not read the program");
    expect(landing).to.include("throw new Error");
  });

  it("escapes chain-supplied text before it reaches the DOM", () => {
    expect(landing).to.include("function esc(");
    // Every interpolation of a chain value must go through esc().
    expect(landing).to.not.match(/innerHTML\s*=\s*[^;]*\+[^;]*agent\.name/);
  });

  it("loads the script that does the reading", () => {
    expect(html).to.include('src="landing.js"');
    expect(landing).to.include('"/api/trust"');
  });
});
