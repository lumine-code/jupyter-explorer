describe("jupyter-explorer singleton pane operations", () => {
  let item;

  beforeEach(async () => {
    lumine.config.set("about.showOnStartup", false);
    await lumine.packages.activatePackage("jupyter-explorer");
    jasmine.attachToDOM(lumine.workspace.getElement());
    item = await lumine.workspace.open("lumine://jupyter-explorer");
  });

  afterEach(async () => {
    const pane = lumine.workspace.paneForItem(item);
    if (pane) await pane.destroyItem(item, true);
    await lumine.packages.deactivatePackage("jupyter-explorer");
  });

  it("moves the exact singleton into a split and refuses copies without changing the layout", async () => {
    const sourcePane = lumine.workspace.paneForItem(item);
    const root = lumine.views.getView(item);
    const moved = await lumine.workspace.movePaneItem(item, { splitDirection: "right" });
    expect(moved.item).toBe(item);
    expect(moved.pane).not.toBe(sourcePane);
    expect(sourcePane.getItems()).toEqual([]);
    expect(sourcePane.isDestroyed()).toBe(false);
    expect(lumine.views.getView(item)).toBe(root);
    const panes = lumine.workspace.getCenter().getPanes();
    const activePane = lumine.workspace.getActivePane();
    await expectAsync(
      lumine.workspace.copyPaneItem(item, { splitDirection: "down" }),
    ).toBeRejectedWith(jasmine.objectContaining({ code: "SINGLETON" }));
    expect(lumine.workspace.getCenter().getPanes()).toEqual(panes);
    expect(lumine.workspace.getActivePane()).toBe(activePane);
    expect(lumine.workspace.paneForItem(item)).toBe(moved.pane);
  });
});
