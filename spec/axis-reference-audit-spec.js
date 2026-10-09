const path = require("node:path");

describe("Explorer native axis controls", () => {
  let Explorer, ExplorerStore, etch, component, store;
  beforeEach(async () => {
    for (const method of ["openPath", "openExternal", "openApplication", "showItemInFolder"])
      spyOn(lumine.shell, method).and.resolveTo();
    spyOn(lumine.application, "openWindow").and.resolveTo();
    const pack = await lumine.packages.activatePackage("jupyter-explorer");
    Explorer = require(path.join(pack.path, "lib/explorer"));
    ExplorerStore = require(path.join(pack.path, "lib/explorer-store")).ExplorerStore;
    etch = require(path.join(pack.path, "node_modules/@lumine-code/etch"));
    // Preserve the actual component, refs, controls and stretch implementation;
    // only the external Plotly renderer is held at its public engine boundary.
    spyOn(Explorer.ResponsivePlot.prototype, "didMount");
    store = new ExplorerStore();
    store.setPayload({
      kind: "dataframe",
      columns: ["x", "y", "z"],
      numeric_columns: ["x", "y", "z"],
      index: [0, 1],
      rows: [
        [0, 2, 3],
        [10, 12, 13],
      ],
      navmeta: [{}, {}],
    });
    store.setXColumn("x");
    store.setYColumn("y");
    store.setViewMode("scatter");
    component = new Explorer({ store });
    jasmine.attachToDOM(component.element);
    etch.updateSync(component);
  });
  afterEach(async () => {
    await component?.destroy();
    store?.reset();
    await lumine.packages.deactivatePackage("jupyter-explorer");
  });
  it("routes visible stretch and compress buttons to the current 2D and replacement 3D plot", async () => {
    for (const threeD of [false, true]) {
      if (threeD) {
        store.setZColumn("z");
        etch.updateSync(component);
      }
      const plot = component.refs.plot ?? component.plot;
      expect(plot).toBeTruthy();
      if (!plot) continue;
      const layout = {
        xaxis: { range: [0, 10] },
        yaxis: { range: [2, 12] },
        zaxis: { range: [3, 13] },
      };
      plot.refs.container._fullLayout = threeD ? { scene: layout } : layout;
      const relayout = jasmine.createSpy("controlled Plotly relayout").and.resolveTo();
      plot.Plotly = { relayout, purge() {} };
      const axes = threeD
        ? [
            ["X", "xaxis", [1, 9]],
            ["Y", "yaxis", [3, 11]],
            ["Z", "zaxis", [4, 12]],
          ]
        : [
            ["X", "xaxis", [1, 9]],
            ["Y", "yaxis", [3, 11]],
          ];
      for (const [label, axis, range] of axes) {
        component.element.querySelector(`[title="Stretch ${label} axis"]`).click();
        await Promise.resolve();
        expect(relayout).toHaveBeenCalledWith(plot.refs.container, {
          [threeD ? `scene.${axis}.range` : `${axis}.range`]: range,
        });
      }
      component.element.querySelector('[title="Compress X axis"]').click();
      await Promise.resolve();
      expect(relayout).toHaveBeenCalledWith(plot.refs.container, {
        [threeD ? "scene.xaxis.range" : "xaxis.range"]: [-1.25, 11.25],
      });
    }
  });
});
