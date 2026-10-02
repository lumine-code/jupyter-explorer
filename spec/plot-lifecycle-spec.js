const etch = require("@lumine-code/etch");
const Explorer = require("../lib/explorer");
const { ResponsivePlot } = Explorer;
const { ExplorerStore } = require("../lib/explorer-store");

const theme = { text: "rgb(255, 255, 255)", grid: "rgb(80, 80, 80)" };
const figure = (value = 1) => ({ data: [{ x: [value], y: [2] }], layout: {} });

describe("explorer plot lifetime", () => {
  let plot;
  let runtime;

  beforeEach(() => {
    spyOn(ResponsivePlot.prototype, "didMount");
    runtime = {
      Icons: { camera: {} },
      newPlot: jasmine.createSpy("newPlot").and.returnValue(Promise.resolve()),
      react: jasmine.createSpy("react").and.returnValue(Promise.resolve()),
      purge: jasmine.createSpy("purge"),
    };
    plot = new ResponsivePlot({ figure: figure() });
    plot.Plotly = runtime;
    plot.refs.container.on = jasmine.createSpy("on");
  });

  afterEach(() => plot?.destroy());

  it("contains a rejected render and keeps its root and anchor stable", async () => {
    const root = plot.element;
    const anchor = plot.refs.container;
    runtime.newPlot.and.returnValue(Promise.reject(new Error("cannot create canvas")));
    await plot.draw("newPlot", theme);
    etch.updateSync(plot);

    expect(plot.error.message).toBe("cannot create canvas");
    expect(plot.element).toBe(root);
    expect(plot.refs.container).toBe(anchor);
    expect(plot.element.textContent).toContain("Could not render this plot");
  });

  it("serializes initialization and skips superseded draws that have not started", async () => {
    let finishFirst;
    runtime.newPlot.and.returnValue(new Promise((resolve) => (finishFirst = resolve)));
    const first = plot.draw("newPlot", theme);
    await Promise.resolve();
    plot.props = { figure: figure(3) };
    const intermediate = plot.draw("react", theme);
    plot.props = { figure: figure(4) };
    const latest = plot.draw("react", theme);
    expect(runtime.react).not.toHaveBeenCalled();
    finishFirst();
    await Promise.all([first, intermediate, latest]);

    expect(runtime.react).toHaveBeenCalledTimes(1);
    expect(runtime.react.calls.mostRecent().args[1][0].x).toEqual([4]);
    expect(plot.refs.container.on).toHaveBeenCalledTimes(1);
  });

  it("purges a slow plot after its view has already closed", async () => {
    let finish;
    const container = plot.refs.container;
    runtime.newPlot.and.returnValue(new Promise((resolve) => (finish = resolve)));
    const pending = plot.draw("newPlot", theme);
    await Promise.resolve();
    plot.destroy();
    finish();
    await pending;

    expect(runtime.purge).toHaveBeenCalledTimes(2);
    expect(container.on).not.toHaveBeenCalled();
  });

  it("does not run a queued plot action after the view closes", async () => {
    const action = jasmine.createSpy("plot action");
    const pending = plot.plotAction(action);
    plot.destroy();
    await pending;

    expect(action).not.toHaveBeenCalled();
  });
});

describe("explorer figure reuse", () => {
  it("survives an already-queued patch after the view has closed", () => {
    const store = new ExplorerStore();
    store.setPayload({ kind: "list", columns: ["value"], rows: [[1]] });
    const component = new Explorer({ store });
    store.setExpression("pending patch");
    component.destroy();

    expect(() => etch.updateSync(component)).not.toThrow();
    expect(store.activeGrid).toBeNull();
  });
  it("keeps missing and blank numeric cells as plot gaps rather than zeroes", () => {
    const store = new ExplorerStore();
    store.setPayload({
      kind: "dataframe",
      columns: ["value"],
      numeric_columns: ["value"],
      index: [0, 1, 2, 3],
      rows: [[null], [""], [" "], [2]],
    });
    store.setViewMode("line");
    const component = new Explorer({ store });
    try {
      expect(component.plot.props.figure.data[0].y).toEqual([null, null, null, 2]);
    } finally {
      component.destroy();
    }
  });

  it("keeps the figure when search highlights, selection, and expression text change", () => {
    const store = new ExplorerStore();
    store.setPayload({
      kind: "dataframe",
      columns: ["value"],
      numeric_columns: ["value"],
      index: [0, 1],
      rows: [[1], [2]],
    });
    store.setViewMode("line");
    const component = new Explorer({ store });
    try {
      const first = component.plot.props.figure;
      store.setSearchMatches([{ row: 0, column: 0 }], 0);
      etch.updateSync(component);
      expect(component.plot.props.figure).toBe(first);
      store.setSelectedRow(1);
      etch.updateSync(component);
      expect(component.plot.props.figure).toBe(first);
      store.setExpression("another_expression");
      etch.updateSync(component);
      expect(component.plot.props.figure).toBe(first);

      store.setXColumn("value");
      etch.updateSync(component);
      expect(component.plot.props.figure).not.toBe(first);
    } finally {
      component.destroy();
    }
  });
});
