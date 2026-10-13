const theme = { text: "rgb(255, 255, 255)", grid: "rgb(80, 80, 80)" };
const figure = (value) => ({ data: [{ x: [value], y: [2] }], layout: {} });

describe("lazy Plotly runtime", () => {
  let loader;

  beforeEach(() => {
    loader = require("../lib/plotly-loader");
  });

  it("shares concurrent native imports with the existing CommonJS library identity", async () => {
    const [first, second] = await Promise.all([loader.loadPlotly(), loader.loadPlotly()]);
    expect(first).toBe(second);
    expect(first).toBe(require("plotly.js-dist"));
    expect(typeof first.newPlot).toBe("function");
    expect(typeof first.react).toBe("function");
  });

  it("shares a pending load and allows another attempt after rejection", async () => {
    const runtime = {};
    const importRuntime = jasmine
      .createSpy("import Plotly")
      .and.returnValues(
        Promise.reject(new Error("load failed")),
        Promise.resolve({ default: runtime }),
      );
    const load = loader.createPlotlyLoader(importRuntime);
    const first = load();
    expect(load()).toBe(first);
    await expectAsync(first).toBeRejectedWithError("load failed");
    expect(await load()).toBe(runtime);
    expect(importRuntime).toHaveBeenCalledTimes(2);
  });
});

describe("plots awaiting their runtime", () => {
  let plot;
  let loader;
  let runtime;
  let finishImport;

  beforeEach(() => {
    const { ResponsivePlot } = require("../lib/explorer");
    loader = require("../lib/plotly-loader");
    spyOn(ResponsivePlot.prototype, "didMount");
    runtime = {
      Icons: { camera: {} },
      newPlot: jasmine.createSpy("newPlot").and.resolveTo(),
      react: jasmine.createSpy("react").and.resolveTo(),
      purge: jasmine.createSpy("purge"),
    };
    spyOn(loader, "loadPlotly").and.returnValue(new Promise((resolve) => (finishImport = resolve)));
    plot = new ResponsivePlot({ figure: figure(1) });
    plot.refs.container.on = jasmine.createSpy("on");
  });

  afterEach(() => plot?.destroy());

  it("leaves a hidden plot mounted without importing the rendering library", () => {
    expect(plot.tryDraw()).toBeUndefined();
    expect(plot.element.isConnected).toBeFalse();
    expect(loader.loadPlotly).not.toHaveBeenCalled();
  });

  it("does not draw or retain the runtime if the view closes during its import", async () => {
    const root = plot.element;
    const pending = plot.draw("newPlot", theme);
    await Promise.resolve();
    expect(loader.loadPlotly).toHaveBeenCalledTimes(1);
    plot.destroy();
    finishImport(runtime);
    await pending;
    expect(plot.Plotly).toBeUndefined();
    expect(runtime.newPlot).not.toHaveBeenCalled();
    expect(runtime.purge).not.toHaveBeenCalled();
    expect(root.isConnected).toBeFalse();
  });

  it("renders the newest figure when data changes during the first import", async () => {
    const oldDraw = plot.draw("newPlot", theme);
    await Promise.resolve();
    plot.props = { figure: figure(3) };
    const newDraw = plot.draw("react", theme);
    finishImport(runtime);
    await Promise.all([oldDraw, newDraw]);
    expect(runtime.newPlot).toHaveBeenCalledTimes(1);
    expect(runtime.newPlot.calls.mostRecent().args[1][0].x).toEqual([3]);
    expect(runtime.react).not.toHaveBeenCalled();
  });

  it("contains import errors and retries with the next requested figure", async () => {
    loader.loadPlotly.and.returnValues(
      Promise.reject(new Error("runtime unavailable")),
      Promise.resolve(runtime),
    );
    await plot.draw("newPlot", theme);
    expect(plot.error.message).toBe("runtime unavailable");
    expect(runtime.newPlot).not.toHaveBeenCalled();
    plot.props = { figure: figure(4) };
    plot.error = null;
    await plot.draw("newPlot", theme);
    expect(runtime.newPlot.calls.mostRecent().args[1][0].x).toEqual([4]);
  });
});
