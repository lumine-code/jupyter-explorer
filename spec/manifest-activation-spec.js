const fs = require("fs");
const path = require("path");
const manifest = require(path.join(__dirname, "..", "package.json"));
const main = require(path.join(__dirname, "..", manifest.main));

describe("the manifest's activation strategy", () => {
  // `Package#activateServices` runs inside `activateNow`, which a package with
  // `activationCommands` does not reach until one of those commands fires.
  // Deferring here would mean `jupyter-variables` — whose whole use of
  // `jupyter.explorer` is to open this panel for the first time — never hears
  // that the service exists. Nothing throws; the link just does nothing.
  it("activates eagerly, because its services are what other packages open it with", () => {
    expect(Object.keys(manifest.providedServices)).toContain("jupyter.explorer");
    expect(manifest.activationCommands).toBeUndefined();
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
