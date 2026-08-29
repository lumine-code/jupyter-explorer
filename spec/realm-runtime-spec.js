const { loadPlotlyFor } = require("../lib/realm-runtime");

describe("jupyter-explorer renderer realms", () => {
  it("loads Plotly through the destination document without Node", async () => {
    const runtime = { Plots: {} };
    const domWindow = {};
    const domDocument = { defaultView: domWindow };
    const modulePath = require.resolve("plotly.js-dist");
    spyOn(lumine.dom, "loadScript").and.resolveTo(runtime);

    expect(await loadPlotlyFor(domDocument)).toBe(runtime);
    expect(lumine.dom.loadScript).toHaveBeenCalledOnceWith(domDocument, modulePath, {
      global: "Plotly",
    });
  });
});
