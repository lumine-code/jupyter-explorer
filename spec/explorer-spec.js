const etch = require("@lumine-code/etch");
const Explorer = require("../lib/explorer");
const { ExplorerStore } = require("../lib/explorer-store");

// The panel moved off React, where several of its pieces were function
// components. Etch calls a function tag with `new` and reads `.element` off the
// result, so a leftover function component renders `undefined` and the patch
// dies with "appendChild: parameter 1 is not of type 'Node'" — which only
// showed up on the chart views, because that is the only branch that rendered
// one. These specs walk every view for that reason.

const flush = (component) => etch.updateSync(component);

function tabularPayload() {
  return {
    kind: "dataframe",
    name: "df",
    columns: ["a", "b", "label"],
    numeric_columns: ["a", "b"],
    index: [0, 1, 2],
    rows: [
      [1, 10, "x"],
      [2, 20, "y"],
      [3, 30, "x"],
    ],
    navmeta: [{}, {}, {}],
    shape: [3, 3],
    total_rows: 3,
    truncated: false,
    summary: { stats: ["mean"], index: ["a", "b"], rows: [[2], [20]] },
  };
}

describe("data explorer", () => {
  let store;
  let component;

  beforeEach(() => {
    store = new ExplorerStore();
    component = new Explorer({ store: store });
  });

  afterEach(() => {
    component?.destroy();
    component = null;
  });

  const body = () => component.element.querySelector(".explorer-body");

  it("asks for an expression before anything is loaded", () => {
    flush(component);
    expect(body().textContent).toContain("No data loaded");
  });

  it("renders the toolbar and the expression editor", () => {
    flush(component);
    expect(component.element.querySelectorAll(".explorer-view-toggle .btn").length).toBe(4);
    expect(component.element.querySelector("lumine-text-editor.explorer-expression")).toBeTruthy();
  });

  it("renders the canvas grid for a tabular payload", () => {
    store.setPayload(tabularPayload());
    flush(component);

    expect(component.element.querySelector(".canvas-grid-canvas")).toBeTruthy();
    expect(component.element.querySelector(".canvas-grid-overlay")).toBeTruthy();
    expect(component.element.querySelector(".explorer-canvas-wrap")).toBeTruthy();
  });

  it("falls back to the repr when the value is not tabular", () => {
    store.setPayload({ kind: "scalar", name: "x", repr: "42" });
    flush(component);

    expect(component.element.querySelector(".explorer-scalar").textContent).toContain("42");
  });

  it("switches to every view without losing the grid", () => {
    store.setPayload(tabularPayload());
    flush(component);

    for (const view of ["line", "scatter", "heatmap", "summary", "grid"]) {
      store.setViewMode(view);
      flush(component);

      // The grid stays mounted and is hidden, so switching back is cheap.
      const grid = component.element.querySelector(".explorer-grid-view");
      expect(grid).toBeTruthy();
      expect(grid.classList.contains("is-hidden")).toBe(view !== "grid");
    }
  });

  it("renders the summary table", () => {
    store.setPayload(tabularPayload());
    store.setViewMode("summary");
    flush(component);

    const table = component.element.querySelector(".explorer-alt-view .explorer-table");
    expect(table).toBeTruthy();
    expect(table.querySelectorAll("tbody tr").length).toBe(2);
  });

  it("renders the axis controls for a chart view", () => {
    store.setPayload(tabularPayload());
    store.setViewMode("scatter");
    flush(component);

    // These were function components under React; as tags they would render
    // nothing and take the whole patch down with them.
    const controls = component.element.querySelectorAll(".explorer-control");
    expect(controls.length).toBeGreaterThan(0);
    expect(component.element.querySelectorAll(".explorer-axis-select[role=combobox]").length).toBe(
      4,
    );
    expect(component.element.querySelector("select")).toBeNull();
  });

  it("focuses the plot surface on a left-button Plotly interaction", () => {
    store.setPayload(tabularPayload());
    store.setViewMode("scatter");
    flush(component);
    jasmine.attachToDOM(component.element);

    const plotSurface = component.element.querySelector(".explorer-plot");
    const plotly = component.element.querySelector(".explorer-plotly");
    plotly.dispatchEvent(new MouseEvent("mousedown", { button: 0, bubbles: true }));

    expect(document.activeElement).toBe(plotSurface);
  });

  it("reports a load failure in place of the data", () => {
    store.setError("boom");
    flush(component);

    expect(body().textContent).toContain("boom");
  });

  it("notes when the kernel capped the rows it returned", () => {
    store.setPayload({ ...tabularPayload(), truncated: true, total_rows: 999 });
    flush(component);

    expect(component.element.querySelector(".explorer-pager").textContent).toContain("of 999 rows");
  });
});
