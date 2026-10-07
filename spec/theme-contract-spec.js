const path = require("path");

describe("explorer table selection colors", () => {
  it("colors every selected cell, including the sticky index, from the selected-row pair", () => {
    const stylesheet = lumine.themes.requireStylesheet(
      path.join(__dirname, "..", "styles", "main.css"),
    );
    const container = document.createElement("div");
    container.className = "jupyter-explorer";
    container.style.cssText =
      "--background-color-selected: rgb(10,20,30); --text-color-selected: rgb(240,230,220); --background-color-highlight: rgb(100,110,120); --text-color-subtle: rgb(50,60,70);";
    container.innerHTML =
      '<div class="explorer"><div class="explorer-table-wrapper"><table class="explorer-table"><tbody><tr class="explorer-row-selected"><td class="explorer-index-cell">0</td><td>value</td></tr></tbody></table></div></div>';
    jasmine.attachToDOM(container);
    try {
      for (const cell of container.querySelectorAll("td")) {
        expect(getComputedStyle(cell).backgroundColor).toBe("rgb(10, 20, 30)");
        expect(getComputedStyle(cell).color).toBe("rgb(240, 230, 220)");
      }
    } finally {
      container.remove();
      stylesheet.dispose();
    }
  });
});
