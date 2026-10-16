describe("Explorer presentations across native windows", () => {
  let item;
  beforeEach(async () => {
    jasmine.useRealClock();
    jasmine.attachToDOM(lumine.workspace.getElement());
    require("@lumine-code/etch").setScheduler(lumine.views);
    await lumine.packages.activatePackage("jupyter-explorer");
  });
  afterEach(async () => {
    if (item) {
      const pane = lumine.workspace.paneForItem(item);
      if (pane) await pane.destroyItem(item, true);
      else await item.destroy();
    }
    await lumine.workspace.discardEditorWindows();
  });
  it("does not consume the explore shortcut outside an editor", async () => {
    const command = "jupyter-explorer:explore";
    const editor = await lumine.workspace.open();
    expect(
      lumine.keymaps.findKeyBindings({ target: lumine.workspace.getElement(), command }),
    ).toEqual([]);
    expect(lumine.keymaps.findKeyBindings({ target: editor.element, command }).length).toBe(1);
    expect(lumine.commands.canDispatch(editor.element, command)).toBe(false);
    editor.destroy();
  });
  it("retains a real Plotly chart, its zoom and native pointer context through detach and attach", async () => {
    const { ResponsivePlot } = require("../lib/explorer");
    const plot = new ResponsivePlot({
      figure: { data: [{ x: [1, 2], y: [3, 4], type: "scatter" }], layout: {} },
      is3D: false,
    });
    plot.element.style.cssText = "width:500px;height:350px";
    item = {
      getTitle: () => "Plot",
      canCopy: () => false,
      element: plot.element,
      destroy: () => plot.destroy(),
    };
    const workspace = lumine.workspace;
    await workspace.open(item);
    plot.refs.container.style.cssText = "width:500px;height:350px";
    await plot.tryDraw();
    expect(plot.error).toBeNull();
    await globalThis.conditionPromise(() => plot._drawn);
    const gd = plot.refs.container;
    await plot.Plotly.relayout(gd, { "xaxis.range": [1.1, 1.6] });
    const extra = await workspace.detachItem(item);
    expect(plot.refs.container).toBe(gd);
    expect(plot.document).toBe(extra.getDocument());
    expect(gd.layout.xaxis.range).toEqual([1.1, 1.6]);
    expect(gd.querySelector("svg.main-svg")).not.toBeNull();
    const move = spyOn(plot, "handleMouseMove").and.callThrough();
    plot.handleMouseDown({
      button: 2,
      clientX: 20,
      clientY: 20,
      preventDefault() {},
      stopPropagation() {},
    });
    window.dispatchEvent(new MouseEvent("mousemove"));
    expect(move).not.toHaveBeenCalled();
    const remoteWindow = extra.getDocument().defaultView;
    remoteWindow.dispatchEvent(new remoteWindow.MouseEvent("mouseup"));
    expect(plot._pan).toBeNull();
    await workspace.attachWindow(extra);
    expect(plot.refs.container).toBe(gd);
    expect(plot.document).toBe(workspace.getMainWindow().getDocument());
    expect(gd.layout.xaxis.range).toEqual([1.1, 1.6]);
  });
});
