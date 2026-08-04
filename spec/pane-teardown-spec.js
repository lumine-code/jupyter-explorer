const DataExplorerPane = require("../lib/data-explorer-pane");

// A pane drops an item only when the item tells it so. Losing the kernel
// service destroys the item directly rather than through `pane.destroyItem`,
// which would otherwise leave the tab behind holding an emptied element.

describe("jupyter-explorer pane teardown", () => {
  it("leaves no tab behind when destroyed directly", () => {
    const item = new DataExplorerPane();
    const pane = atom.workspace.getCenter().getActivePane();
    pane.addItem(item);

    expect(pane.getItems()).toContain(item);

    item.destroy();

    expect(pane.getItems()).not.toContain(item);
  });

  it("survives being destroyed twice", () => {
    const item = new DataExplorerPane();
    item.destroy();
    expect(() => item.destroy()).not.toThrow();
  });
});
