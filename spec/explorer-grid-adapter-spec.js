const { ExplorerCanvasGrid, gridOptions } = require("../lib/explorer-grid");
const ExplorerSearchAdapter = require("../lib/explorer-search");

function payload(overrides = {}) {
  return {
    columns: ["name", "value"],
    index: ["first", "second"],
    rows: [
      ["a", 1],
      ["b", 2],
    ],
    ...overrides,
  };
}

function props(overrides = {}) {
  const value = payload();
  return {
    payload: value,
    navMeta: [{ expandable: true }, {}],
    searchMatches: [],
    searchCurrentIndex: -1,
    selectedRow: null,
    ...overrides,
  };
}

describe("Explorer CanvasGrid adapter", () => {
  let grid;

  afterEach(() => {
    grid?.destroy();
    grid = null;
  });

  it("reveals its actual scrollport for a visible navigation target and retires the subscription", () => {
    const reveal = spyOn(lumine.scrollbars, "reveal");
    grid = new ExplorerCanvasGrid(props());
    grid.moveActiveSelectionTo(0, 0);
    expect(reveal).toHaveBeenCalledOnceWith(grid.scrollElement);
    const element = grid.scrollElement;
    grid.destroy();
    reveal.calls.reset();
    grid.navigate(1, 0);
    expect(reveal).not.toHaveBeenCalled();
    expect(element.isConnected).toBeFalse();
  });

  for (const paged of [false, true]) {
    it(`signals expandable Enter drill-down once through the current ${paged ? "paged" : "in-memory"} callback`, async () => {
      const firstDrill = jasmine.createSpy("first drill");
      const nextDrill = jasmine.createSpy("updated drill");
      const record = { 0: "a", 1: 1, _explorer: { navigation: { expandable: true } } };
      grid = new ExplorerCanvasGrid(
        props({
          payload: payload({ paged, row_count: 1 }),
          fetchRows: async () => [record],
          onDrill: firstDrill,
        }),
      );
      jasmine.attachToDOM(grid.element);
      grid.moveActiveSelectionTo(0, 0);
      await grid.update({ ...grid.props, onDrill: nextDrill });
      const reveal = spyOn(lumine.scrollbars, "reveal");
      const confirm = spyOn(grid, "confirmActiveCell").and.callThrough();
      const before = grid.getScrollState();
      const captured = grid.captureState();
      lumine.commands.dispatch(grid.element, "core:confirm");
      await confirm.calls.mostRecent().returnValue;
      expect(firstDrill).not.toHaveBeenCalled();
      expect(nextDrill).toHaveBeenCalledOnceWith(0, captured);
      expect(reveal).toHaveBeenCalledOnceWith(grid.scrollElement);
      expect(grid.getScrollState()).toEqual(before);
    });
  }

  for (const reason of ["non-expandable", "no drill callback"]) {
    it(`keeps ${reason} confirmation outside navigation activity`, async () => {
      const onDrill = jasmine.createSpy("drill");
      grid = new ExplorerCanvasGrid(
        props({
          navMeta: [{ expandable: reason !== "non-expandable" }],
          onDrill: reason === "no drill callback" ? undefined : onDrill,
        }),
      );
      jasmine.attachToDOM(grid.element);
      grid.moveActiveSelectionTo(0, 0);
      const reveal = spyOn(lumine.scrollbars, "reveal");
      const confirm = spyOn(grid, "confirmActiveCell").and.callThrough();
      lumine.commands.dispatch(grid.element, "core:confirm");
      await confirm.calls.mostRecent().returnValue;
      expect(onDrill).not.toHaveBeenCalled();
      expect(reveal).not.toHaveBeenCalled();
    });
  }

  it("maps an explorer payload without copying its row array", () => {
    const input = props();
    const options = gridOptions(input);

    expect(options.columns).toEqual([
      { key: 0, label: "name" },
      { key: 1, label: "value" },
    ]);
    expect(options.rows).toBe(input.payload.rows);
    expect(options.copyRows).toBe(false);
    expect(options.formatRowHeader({ windowRow: 1 })).toBe("second");
  });

  it("is the shared grid element rather than an Etch host around one", () => {
    grid = new ExplorerCanvasGrid(props());

    expect(grid.element.classList.contains("explorer-canvas-wrap")).toBe(true);
    expect(grid.element.querySelectorAll("canvas").length).toBe(2);
    expect(grid.element.querySelector(".explorer-canvas-host")).toBeNull();
    expect(grid.windowRows).toBe(grid.props.payload.rows);
  });

  it("uses canonical CanvasGrid cells and state for selection, search, and drill-down", () => {
    const onDrill = jasmine.createSpy("onDrill");
    const onRestored = jasmine.createSpy("onRestored");
    const restoreState = {
      selection: { r0: 1, c0: 1, r1: 1, c1: 1 },
      selections: [{ r0: 1, c0: 1, r1: 1, c1: 1 }],
      selectionMode: "cell",
      active: { row: 1, column: 1 },
      scrollTop: 12,
      scrollLeft: 8,
    };
    grid = new ExplorerCanvasGrid(props({ onDrill, onRestored, restoreState }));

    expect(onRestored).toHaveBeenCalledTimes(1);
    expect(grid.activeCell()).toEqual({ row: 1, column: 1 });
    expect(grid.captureState()).toEqual(
      jasmine.objectContaining({
        selection: restoreState.selection,
        selections: restoreState.selections,
        selectionMode: "cell",
        active: { row: 1, column: 1 },
      }),
    );

    grid.options.onConfirm({ windowRow: 0 });
    const [row, state] = onDrill.calls.mostRecent().args;
    expect(row).toBe(0);
    expect(state.selectionMode).toBe("cell");
    expect(state.active).toEqual({ row: 1, column: 1 });
  });

  it("updates payload callbacks and decorations through one lifecycle", async () => {
    const clearSelected = jasmine.createSpy("clearSelected");
    const nextClearSelected = jasmine.createSpy("nextClearSelected");
    const firstPayload = payload();
    const nextPayload = payload({ rows: [["c", 3]], index: ["third"] });
    grid = new ExplorerCanvasGrid(
      props({ payload: firstPayload, selectedRow: 0, onClearSelected: clearSelected }),
    );

    await grid.update(
      props({
        payload: nextPayload,
        selectedRow: 0,
        onClearSelected: nextClearSelected,
        searchMatches: [{ row: 0, column: 1 }],
        searchCurrentIndex: 0,
      }),
    );
    grid.startSelection({ zone: "body", row: 0, column: 0 });

    expect(grid.windowRows).toBe(nextPayload.rows);
    expect(grid.highlights).toEqual([{ row: 0, column: 1 }]);
    expect(grid.currentHighlight).toEqual({ row: 0, column: 1 });
    expect(clearSelected).not.toHaveBeenCalled();
    expect(nextClearSelected).toHaveBeenCalledTimes(1);
  });

  it("keeps the search seam on canonical row and column coordinates", () => {
    const value = payload();
    grid = new ExplorerCanvasGrid(props({ payload: value }));
    const store = {
      payload: value,
      activeGrid: grid,
      setSearchMatches(matches, currentIndex) {
        this.searchMatches = matches;
        this.searchCurrentIndex = currentIndex;
      },
    };
    const search = new ExplorerSearchAdapter(store);

    search.search({
      findPattern: "2",
      getFindPatternRegex: () => /2/,
    });
    expect(search.matches).toEqual([{ row: 1, column: 1 }]);

    search.selectNext();
    expect(grid.activeCell()).toEqual({ row: 1, column: 1 });
    expect(search.hasSelectionMatchingResult()).toBe(true);
    expect(search.getSelectedText()).toBe("2");
    expect(search.getWrapIconHost()).toBe(grid.element);

    search.destroy();
  });

  it("clears its owner reference and tears down idempotently", async () => {
    const onDestroy = jasmine.createSpy("onDestroy");
    grid = new ExplorerCanvasGrid(props({ onDestroy }));
    const element = grid.element;
    jasmine.attachToDOM(element);

    await grid.destroy();
    await expectAsync(grid.destroy()).toBeResolved();

    expect(onDestroy).toHaveBeenCalledTimes(1);
    expect(onDestroy).toHaveBeenCalledWith(grid);
    expect(grid.destroyed).toBe(true);
    expect(element.isConnected).toBe(false);
  });
});
