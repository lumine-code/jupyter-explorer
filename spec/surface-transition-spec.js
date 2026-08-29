const etch = require("@lumine-code/etch");
const ExplorerPane = require("../lib/explorer-pane");
const { explorerStore } = require("../lib/explorer-store");

function payload() {
  return {
    kind: "dataframe",
    name: "df",
    columns: ["a", "b"],
    numeric_columns: ["a", "b"],
    index: [0, 1],
    rows: [
      [1, 2],
      [3, 4],
    ],
    navmeta: [{}, {}],
    shape: [2, 2],
    total_rows: 2,
    truncated: false,
  };
}

describe("jupyter-explorer detached surface", () => {
  let item;
  let detachedPane;
  let frame;

  beforeEach(() => explorerStore.reset());

  afterEach(async () => {
    if (detachedPane?.isAlive?.()) {
      await lumine.workspace.attachDetachedPane(detachedPane);
    }
    item?.destroy();
    frame?.remove();
    explorerStore.reset();
  });

  it("rebuilds the canvas in each realm and preserves its interaction state", async () => {
    item = new ExplorerPane();
    lumine.workspace.getCenter().getActivePane().addItem(item);
    explorerStore.setPayload(payload());
    explorerStore.setViewMode("scatter");
    etch.updateSync(item.component);
    const primaryComponent = item.component;
    frame = document.createElement("iframe");
    document.body.appendChild(frame);
    const primarySurface = { document, window };
    const detachedSurface = {
      document: frame.contentDocument,
      window: frame.contentWindow,
    };
    const transition = item.beginWindowSurfaceTransition({
      item,
      from: primarySurface,
      to: detachedSurface,
    });
    detachedPane = lumine.workspace.getCenter().detachPaneItem(item);
    detachedSurface.document.body.appendChild(item.element);
    await transition.commit({ item, from: primarySurface, to: detachedSurface });

    expect(item.component).not.toBe(primaryComponent);
    expect(item.element.ownerDocument).toBe(detachedSurface.document);
    expect(item.component.element.ownerDocument).toBe(detachedSurface.document);
    expect(explorerStore.activeGrid.refs.canvas.ownerDocument).toBe(detachedSurface.document);

    explorerStore.activeGrid.startSelection({ r: 0, c: 0 });
    expect(explorerStore.activeGrid.captureState().selections.length).toBeGreaterThan(0);

    const detachedComponent = item.component;
    const attachTransition = item.beginWindowSurfaceTransition({
      item,
      from: detachedSurface,
      to: primarySurface,
    });
    lumine.workspace.getCenter().attachDetachedPane(detachedPane);
    document.body.appendChild(item.element);
    await attachTransition.commit({ item, from: detachedSurface, to: primarySurface });
    detachedPane = null;

    expect(item.component).not.toBe(detachedComponent);
    expect(item.element.ownerDocument).toBe(document);
    expect(item.component.element.ownerDocument).toBe(document);
    expect(explorerStore.activeGrid.refs.canvas.ownerDocument).toBe(document);
    expect(explorerStore.activeGrid.captureState().selections.length).toBeGreaterThan(0);
  });
});
