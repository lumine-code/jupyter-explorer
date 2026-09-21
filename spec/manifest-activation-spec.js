const fs = require("fs");
const path = require("path");
const manifest = require(path.join(__dirname, "..", "package.json"));
const main = require(path.join(__dirname, "..", manifest.main));

describe("the manifest's bootstrap contract", () => {
  it("publishes its explorer service without lifecycle metadata", () => {
    expect(Object.keys(manifest.providedServices)).toContain("jupyter.explorer");
  });

  it("exposes a method for every service it declares", () => {
    const declared = [
      ...Object.values(manifest.providedServices || {}),
      ...Object.values(manifest.consumedServices || {}),
    ].flatMap((service) => Object.values(service.versions));

    expect(declared.length).toBeGreaterThan(0);
    for (const method of declared) {
      expect(typeof main[method]).toBe("function");
    }
  });

  it("inherits shared grid tokens and renderer-owned structure", () => {
    const css = fs.readFileSync(path.join(__dirname, "..", "styles", "main.css"), "utf8");
    expect(css).not.toContain("--canvas-grid-");
    expect(css).not.toContain(".canvas-grid-");
    expect(css).toMatch(
      /\.jupyter-explorer \{[^}]*width: 100%;[^}]*background: var\(--base-background-color\);/,
    );
    expect(css).toMatch(/\.jupyter-explorer \.explorer \{[^}]*width: 100%;[^}]*padding: 0;/);
    expect(css).toMatch(/\.explorer-body \{[^}]*width: 100%;/);
    expect(css).toMatch(/\.explorer-grid-view \{[^}]*width: 100%;/);
    expect(css).toMatch(
      /\.explorer-canvas-wrap \{[^}]*width: 100%;[^}]*background: var\(--base-background-color\);/,
    );
  });
});
