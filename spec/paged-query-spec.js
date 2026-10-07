const { recordRequest, settle } = require("./request-fixture");
const { execFileSync } = require("node:child_process");
const { backendCode, requestCode, fileExpression } = require("../lib/kernel-query");
const { buildSerializerCode, ExplorerStore } = require("../lib/explorer-store");
const { ExplorerCanvasGrid } = require("../lib/explorer-grid");
const ExplorerSearchAdapter = require("../lib/explorer-search");
const etch = require("@lumine-code/etch");
const Explorer = require("../lib/explorer");
function findPython() {
  for (const command of [process.env.LUMINE_EXPLORER_TEST_PYTHON, "python", "python3"].filter(
    Boolean,
  )) {
    try {
      execFileSync(command, ["-c", "import sys; assert sys.version_info.major == 3"], {
        timeout: 10000,
      });
      return command;
    } catch {}
  }
  return null;
}
const python = findPython();
const pythonSuite = python ? describe : () => {};
function requireModule(module) {
  try {
    execFileSync(python, ["-c", `import ${module}`], {
      timeout: 10000,
    });
    return true;
  } catch {
    pending(`${module} is not installed in the selected Python interpreter`);
    return false;
  }
}
function evaluate(setup, body) {
  const code = `${backendCode()}\n${setup}\nimport json\n${body}\n`;
  return JSON.parse(runPython(code));
}
function runPython(code) {
  return execFileSync(python, ["-"], {
    input: code,
    encoding: "utf8",
    timeout: 30000,
  });
}
pythonSuite("full-data explorer sessions in Python", () => {
  it("pages beyond the former row limit without evaluating the expression again", async () => {
    const code = `import json\ncalls = []\ndef make_data():\n    calls.append(1)\n    return list(range(12000))\n${buildSerializerCode("make_data()", false, "test")}\n${requestCode(
      {
        session: "test",
        action: "page",
        offset: 11500,
        limit: 200,
      },
    )}\nprint(json.dumps(len(calls)))\n`;
    const lines = runPython(code)
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(lines[0].row_count).toBe(12000);
    expect(lines[0].rows.length).toBe(1000);
    expect(lines[0].rows.at(-1)).toEqual([11999]);
    expect(lines[1].rows[0]).toEqual([11500]);
    expect(lines[1].rows.length).toBe(200);
    expect(lines[1].navmeta[0].accessor).toBe("[11500]");
    expect(lines[2]).toBe(1);
  });
  it("sorts all dataframe rows and keeps duplicate column positions and original drill targets", async () => {
    if (!requireModule("pandas")) return;
    const result = evaluate(
      "import pandas as pd\ndata = pd.DataFrame([[i, 3000-i] for i in range(3000)], columns=['value','value'])\n_jupyter_explorer_open('test', data, 'data')",
      `query = _jupyter_explorer_query({'session':'test','action':'query','sort':{'column':1,'direction':1}})\npage = _jupyter_explorer_query({'session':'test','action':'page','offset':0,'limit':2})\nprint(json.dumps({'query':query,'page':page}))`,
    );
    expect(result.query.row_count).toBe(3000);
    expect(result.query.columns).toEqual(["value", "value"]);
    expect(result.page.rows).toEqual([
      [2999, 1],
      [2998, 2],
    ]);
    expect(result.page.index).toEqual(["2999", "2998"]);
    expect(result.page.navmeta[0].accessor).toBe(".iloc[2999]");
  });
  it("combines full-data filters and computes exact null, distinct and histogram counts", async () => {
    if (!requireModule("pandas")) return;
    const result = evaluate(
      "import pandas as pd\ndata = pd.DataFrame({'n': range(5000), 'label': ['even' if i%2 == 0 else 'odd' for i in range(5000)], 'optional': [None if i%4 == 0 else i for i in range(5000)]})\n_jupyter_explorer_open('test', data, 'data')",
      `query = _jupyter_explorer_query({'session':'test','action':'query','filters':[{'column':0,'operator':'range','min':2000,'max':3999},{'column':1,'operator':'equals','value':'even'}]})\nprofile = _jupyter_explorer_query({'session':'test','action':'profile','column':2})\nprint(json.dumps({'query':query,'profile':profile}))`,
    );
    expect(result.query.row_count).toBe(1000);
    expect(result.query.rows[0]).toEqual([2000, "even", null]);
    expect(result.profile.total).toBe(1000);
    expect(result.profile.nulls).toBe(500);
    expect(result.profile.distinct).toBe(500);
    expect(result.profile.scope).toBe("all-filtered-rows");
    expect(result.profile.histogram.reduce((sum, bin) => sum + bin.count, 0)).toBe(500);
  });
  it("pages NumPy arrays and searches rows outside the chart sample", async () => {
    if (!requireModule("numpy")) return;
    const result = evaluate(
      "import numpy as np\ndata = np.arange(16000).reshape(8000,2)\n_jupyter_explorer_open('test', data, 'data')",
      `page = _jupyter_explorer_query({'session':'test','action':'page','offset':7000,'limit':2})\nsearch = _jupyter_explorer_query({'session':'test','action':'search','source':'^14002$'})\nprint(json.dumps({'page':page,'search':search}))`,
    );
    expect(result.page.rows).toEqual([
      [14000, 14001],
      [14002, 14003],
    ]);
    expect(result.search.matches).toEqual([
      {
        row: 7001,
        column: 0,
      },
    ]);
  });
  it("keeps empty filtered views, null sorting, and session release well-defined", async () => {
    const result = evaluate(
      "_jupyter_explorer_open('test', [3,None,1,2], 'data')",
      `ordered = _jupyter_explorer_query({'session':'test','action':'query','sort':{'column':0,'direction':-1}})\nempty = _jupyter_explorer_query({'session':'test','action':'query','filters':[{'column':0,'operator':'range','min':50}]})\nprofile = _jupyter_explorer_query({'session':'test','action':'profile','column':0})\n_jupyter_explorer_query({'session':'test','action':'close'})\nprint(json.dumps({'ordered':ordered,'empty':empty,'profile':profile,'released':'test' not in _jupyter_explorer_sessions}))`,
    );
    expect(result.ordered.rows).toEqual([[3], [2], [1], [null]]);
    expect(result.empty.row_count).toBe(0);
    expect(result.empty.rows).toEqual([]);
    expect(result.profile.total).toBe(0);
    expect(result.profile.distinct).toBe(0);
    expect(result.released).toBe(true);
  });
  it("drops dataframe references across repeated drill-sized sessions", async () => {
    if (!requireModule("pandas")) return;
    const result = evaluate(
      "import pandas as pd, weakref, gc\nrefs = []",
      `for depth in range(20):\n    obj = pd.DataFrame({'n': range(2000)})\n    refs.append(weakref.ref(obj))\n    _jupyter_explorer_open(str(depth), obj, 'data')\n    del obj\n    _jupyter_explorer_query({'session':str(depth),'action':'page','offset':1500,'limit':2})\n    _jupyter_explorer_query({'session':str(depth),'action':'close'})\ngc.collect()\nprint(json.dumps({'live':sum(ref() is not None for ref in refs),'sessions':len(_jupyter_explorer_sessions)}))`,
    );
    expect(result.live).toBe(0);
    expect(result.sessions).toBe(0);
  });
  it("opens Parquet, Feather, Arrow IPC files and streams without editor-side decoding", async () => {
    if (!requireModule("pyarrow")) return;
    const setup = `import pyarrow as pa, pyarrow.parquet as pq, pyarrow.feather as feather, tempfile, os\nfolder = tempfile.TemporaryDirectory()\ndata = pa.table({'n': list(range(2500)), 'tag': ['x']*2500})\npq.write_table(data, os.path.join(folder.name, 'data.parquet'))\nfeather.write_feather(data, os.path.join(folder.name, 'data.feather'))\nwith pa.OSFile(os.path.join(folder.name,'data.arrow'),'wb') as sink:\n    with pa.ipc.new_file(sink, data.schema) as writer:\n        writer.write_table(data)\nwith pa.OSFile(os.path.join(folder.name,'data.ipc'),'wb') as sink:\n    with pa.ipc.new_stream(sink, data.schema) as writer:\n        writer.write_table(data)\n`;
    const source = ["parquet", "feather", "arrow", "ipc"]
      .map((extension) => {
        const expression = fileExpression(`data.${extension}`).replaceAll(
          JSON.stringify(`data.${extension}`),
          `os.path.join(folder.name, 'data.${extension}')`,
        );
        return `exec(${JSON.stringify(buildSerializerCode(expression, false, extension))})\nprint(json.dumps(_jupyter_explorer_query({'session':'${extension}','action':'page','offset':2400,'limit':1})))`;
      })
      .join("\n");
    const lines = runPython(`${setup}\nimport json\n${source}`)
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    for (let index = 0; index < lines.length; index += 2) {
      expect(lines[index].kind).toBe("arrow");
      expect(lines[index].row_count).toBe(2500);
      expect(lines[index + 1].rows).toEqual([[2400, "x"]]);
    }
  });
});
function kernel() {
  const requests = [];
  return {
    language: "python",
    requests,
    request(specification) {
      return recordRequest(this, specification);
    },
    generation: 0,
    onDidChangeGeneration: () => ({
      dispose() {},
    }),
  };
}
function finish(request, value) {
  request.receive({
    output_type: "stream",
    name: "stdout",
    text: JSON.stringify(value) + "\n",
  });
  request.receive({
    output_type: "status",
    execution_state: "idle",
  });
}
async function flushQueries() {
  for (let index = 0; index < 4; index++) await Promise.resolve();
}
function payload() {
  return {
    kind: "dataframe",
    paged: true,
    columns: ["n"],
    row_count: 10000,
    total_rows: 10000,
    rows: [[0], [9999]],
    row_slots: [0, 9999],
    sample_rows: 2,
    sampled: true,
    numeric_columns: ["n"],
  };
}
describe("paged explorer lifecycle", () => {
  let store;
  beforeEach(() => {
    store = new ExplorerStore();
  });
  afterEach(() => {
    store.reset();
  });
  it("adapts paging and row labels without mistaking the chart sample for the whole grid", async () => {
    const source = kernel();
    store.load(source, "data");
    await settle();
    finish(source.requests[0], payload());
    await settle();
    const grid = new ExplorerCanvasGrid({
      payload: store.payload,
      fetchRows: store.fetchRows,
    });
    try {
      expect(grid.rowCount).toBe(10000);
      expect(grid.memoryMode).toBe(false);
      const row = grid.rowAt(9200);
      await Promise.resolve();
      await Promise.resolve();
      finish(source.requests.at(-1), {
        rows: [[9200]],
        index: ["original-row"],
        navmeta: [
          {
            expandable: true,
            accessor: ".iloc[9200]",
          },
        ],
      });
      await settle();
      const record = await row;
      expect(record).toEqual([9200]);
      expect(
        grid.options.formatRowHeader({
          windowRow: 9200,
          record,
        }),
      ).toBe("original-row");
    } finally {
      grid.destroy();
      await settle();
    }
  });
  it("ignores obsolete filter replies and releases the old kernel session", async () => {
    const source = kernel();
    store.load(source, "data");
    await settle();
    finish(source.requests[0], payload());
    await settle();
    store.addFilter({
      column: 0,
      operator: "range",
      min: 100,
    });
    await settle();
    const old = source.requests.at(-1);
    store.addFilter({
      column: 0,
      operator: "range",
      min: 9000,
    });
    await settle();
    const current = source.requests.at(-1);
    finish(current, {
      ...payload(),
      row_count: 1000,
    });
    await settle();
    await Promise.resolve();
    await Promise.resolve();
    finish(old, {
      ...payload(),
      row_count: 9900,
    });
    await settle();
    await Promise.resolve();
    await Promise.resolve();
    expect(store.payload.row_count).toBe(1000);
    store.reset();
    await settle();
    expect(source.requests.at(-1).code).toContain('\\"action\\":\\"close\\"');
  });
  it("does not apply an already-rejected filter error after a new expression starts loading", async () => {
    const source = kernel();
    store.load(source, "data");
    await settle();
    finish(source.requests[0], payload());
    await settle();
    store.addFilter({
      column: 0,
      operator: "range",
      min: 100,
    });
    await settle();
    source.requests.at(-1).receive({
      output_type: "error",
      ename: "ValueError",
      evalue: "old filter",
    });
    // The transport promise has rejected, but its catch has not run yet.
    await settle();
    store.load(source, "newData");
    await settle();
    await flushQueries();
    expect(store.currentExpression).toBe("newData");
    expect(store.loading).toBe(true);
    expect(store.error).toBeNull();
    finish(source.requests.at(-1), {
      ...payload(),
      row_count: 25,
    });
    await settle();
    expect(store.payload.row_count).toBe(25);
    expect(store.error).toBeNull();
  });
  it("does not apply a filter rejection when context changes after the request gate", async () => {
    const source = kernel();
    store.load(source, "data");
    await settle();
    finish(source.requests[0], payload());
    await settle();
    store.addFilter({
      column: 0,
      operator: "range",
      min: 100,
    });
    await settle();
    source.requests.at(-1).receive({
      output_type: "error",
      ename: "ValueError",
      evalue: "old filter",
    });
    await settle();
    await Promise.resolve();
    store.load(source, "newData");
    await settle();
    await flushQueries();
    expect(store.loading).toBe(true);
    expect(store.error).toBeNull();
  });
  it("does not apply an already-rejected profile error after changing the profile column", async () => {
    const source = kernel();
    store.load(source, "data");
    await settle();
    finish(source.requests[0], {
      ...payload(),
      columns: ["n", "m"],
    });
    await settle();
    store.loadProfile();
    await settle();
    source.requests.at(-1).receive({
      output_type: "error",
      ename: "ValueError",
      evalue: "old profile",
    });
    await settle();
    store.setProfileColumn(1);
    await settle();
    store.loadProfile();
    await settle();
    await flushQueries();
    expect(store.profileColumn).toBe(1);
    expect(store.profileLoading).toBe(true);
    expect(store.profileError).toBeNull();
    finish(source.requests.at(-1), {
      column: 1,
      label: "m",
      total: 10000,
    });
    await settle();
    await flushQueries();
    expect(store.profile.label).toBe("m");
    expect(store.profileError).toBeNull();
  });
  it("does not apply an already-resolved profile after changing the profile column", async () => {
    const source = kernel();
    store.load(source, "data");
    await settle();
    finish(source.requests[0], {
      ...payload(),
      columns: ["n", "m"],
    });
    await settle();
    store.loadProfile();
    await settle();
    finish(source.requests.at(-1), {
      column: 0,
      label: "n",
      total: 10000,
    });
    // The request's gate sees the old column as current. Its consumer still
    // must stand down if the user changes columns in the next microtask.
    await settle();
    await Promise.resolve();
    store.setProfileColumn(1);
    await settle();
    await flushQueries();
    expect(store.profile).toBeNull();
    expect(store.profileColumn).toBe(1);
    expect(store.profileLoading).toBe(false);
  });
  it("still reports a current filter failure", async () => {
    const source = kernel();
    store.load(source, "data");
    await settle();
    finish(source.requests[0], payload());
    await settle();
    store.addFilter({
      column: 0,
      operator: "range",
      min: 100,
    });
    await settle();
    source.requests.at(-1).receive({
      output_type: "error",
      ename: "ValueError",
      evalue: "current filter",
    });
    await settle();
    await flushQueries();
    expect(store.error).toBe("ValueError: current filter");
    expect(store.loading).toBe(false);
  });
  it("searches the kernel and drives grid navigation to matches beyond the sample", async () => {
    const source = kernel();
    store.load(source, "data");
    await settle();
    finish(source.requests[0], payload());
    await settle();
    const search = new ExplorerSearchAdapter(store);
    const reveal = jasmine.createSpy("revealCell");
    store.activeGrid = {
      revealCell: reveal,
    };
    search.search({
      findPattern: "9200",
      getFindPatternRegex: () => /^9200$/,
    });
    await settle();
    finish(source.requests.at(-1), {
      matches: [
        {
          row: 9200,
          column: 0,
        },
      ],
      total: 1,
      limited: false,
    });
    await settle();
    await Promise.resolve();
    await Promise.resolve();
    expect(search.getResultCount()).toBe(1);
    search.selectNext();
    await settle();
    expect(reveal).toHaveBeenCalledWith({
      row: 9200,
      column: 0,
    });
    search.destroy();
    await settle();
  });
  it("does not restore obsolete search matches after clearing the find field", async () => {
    const source = kernel();
    store.load(source, "data");
    await settle();
    finish(source.requests[0], payload());
    await settle();
    const search = new ExplorerSearchAdapter(store);
    search.search({
      findPattern: "9200",
      getFindPatternRegex: () => /^9200$/,
    });
    await settle();
    const previous = source.requests.at(-1);
    search.search({
      findPattern: "",
    });
    await settle();
    finish(previous, {
      matches: [
        {
          row: 9200,
          column: 0,
        },
      ],
      total: 1,
      limited: false,
    });
    await settle();
    await Promise.resolve();
    await Promise.resolve();
    expect(search.matches).toEqual([]);
    search.destroy();
    await settle();
  });
  it("shows full-data profile controls and labels chart sampling", async () => {
    store.setPayload(payload());
    await settle();
    const component = new Explorer({
      store,
    });
    try {
      expect(component.element.querySelector(".explorer-filter-form")).toBeTruthy();
      store.setViewMode("scatter");
      await settle();
      etch.updateSync(component);
      await settle();
      expect(component.element.textContent).toContain("(sample)");
      store.viewMode = "summary";
      store.profile = {
        column: 0,
        label: "n",
        total: 10000,
        nulls: 0,
        distinct: 10000,
        histogram: [],
        top: [],
      };
      etch.updateSync(component);
      await settle();
      expect(component.element.textContent).toContain("exact profile of all 10000 matching rows");
    } finally {
      component.destroy();
      await settle();
    }
  });
});
