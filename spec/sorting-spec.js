const { recordRequest, settle } = require("./request-fixture");
const etch = require("@lumine-code/etch");
const Explorer = require("../lib/explorer");
const { ExplorerStore } = require("../lib/explorer-store");
describe("explorer grid sorting", () => {
  it("sorts and clears loaded rows while keeping labels, search, and drill targets aligned", async () => {
    const requests = [];
    const store = new ExplorerStore();
    store.load(
      {
        language: "python",
        request(specification) {
          requests.push(specification.code);
          return recordRequest(this, specification);
        },
        generation: 0,
        onDidChangeGeneration: () => ({
          dispose() {},
        }),
      },
      "rows",
    );
    await settle();
    store.setPayload({
      kind: "list",
      columns: ["value"],
      rows: [[3], [1], [2], [null]],
      index: ["third", "first", "second", "missing"],
      navmeta: [0, 1, 2, 3].map((index) => ({
        accessor: `[${index}]`,
        expandable: true,
      })),
    });
    await settle();
    const component = new Explorer({
      store,
    });
    try {
      const grid = store.activeGrid;
      expect(grid.requestSort(0, "ascending", "command")).toBe(true);
      etch.updateSync(component);
      await settle();
      expect(grid.windowRows).toEqual([[1], [2], [3], [null]]);
      expect(store.payload.index).toEqual(["first", "second", "third", "missing"]);
      expect(grid.columns[0].sortDirection).toBe(1);
      const search = store.getSearchAdapter();
      search.search({
        findPattern: "1",
        getFindPatternRegex: () => /^1$/,
      });
      await settle();
      expect(search.matches).toEqual([
        {
          row: 0,
          column: 0,
        },
      ]);
      grid.requestSort(0, "descending", "command");
      await settle();
      etch.updateSync(component);
      await settle();
      expect(grid.windowRows).toEqual([[3], [2], [1], [null]]);
      expect(search.matches).toEqual([
        {
          row: 2,
          column: 0,
        },
      ]);
      grid.requestSort(0, "clear", "command");
      await settle();
      etch.updateSync(component);
      await settle();
      expect(grid.windowRows).toEqual([[3], [1], [2], [null]]);
      grid.requestSort(0, "ascending", "command");
      await settle();
      etch.updateSync(component);
      await settle();
      grid.options.onConfirm({
        windowRow: 0,
      });
      await settle();
      expect(store.currentExpression).toBe("rows[1]");
      expect(requests.at(-1)).toContain('"rows[1]"');
    } finally {
      component.destroy();
      await settle();
      store.reset();
      await settle();
    }
  });
});
