const { ExplorerStore } = require("../lib/explorer-store");
const { executeQuery, fileExpression } = require("../lib/kernel-query");
const { startLiveKernel } = require("./fixtures/live-kernel");

const liveSuite = process.env.LUMINE_TEST_LIVE_PYTHON === "true" ? describe : () => {};

function waitForStore(store, ready) {
  if (ready()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      subscription.dispose();
      reject(new Error("The live explorer did not finish its request"));
    }, 15000);
    const subscription = store.onDidUpdate(() => {
      if (!ready()) return;
      clearTimeout(timer);
      subscription.dispose();
      resolve();
    });
  });
}

liveSuite("explorer sessions in a real Python notebook kernel", () => {
  let kernel;
  let fixture;
  let store;

  beforeAll(async () => {
    fixture = await startLiveKernel(process.env.LUMINE_TEST_PYTHON || "python");
    kernel = fixture.kernel;
  }, 40000);

  beforeEach(() => {
    store = new ExplorerStore();
  });

  afterEach(async () => {
    store.reset();
    if (!kernel) return;
    const remaining = await executeQuery(
      kernel,
      "import json\nprint(json.dumps(len(globals().get('_jupyter_explorer_sessions', {}))))",
    );
    expect(remaining).toBe(0);
  }, 20000);

  afterAll(async () => {
    await fixture?.close();
  }, 20000);

  async function load(expression) {
    store.load(kernel, expression);
    await waitForStore(store, () => !store.loading);
    expect(store.error).toBeNull();
    expect(store.payload?.paged).toBe(true);
  }

  it("pages, filters and refreshes one persistent dataframe session without reevaluating it", async () => {
    const environment = await executeQuery(
      kernel,
      `import sys, json, numpy as np, pandas as pd, pyarrow as pa, ipykernel
calls = []
def notebook_data():
    calls.append(1)
    return pd.DataFrame({'n': np.arange(12000), 'tag': ['even', 'odd'] * 6000})
print(json.dumps({'python': '.'.join(map(str, sys.version_info[:3])), 'ipykernel': ipykernel.__version__}))`,
    );
    expect(environment.python).toBe("3.15.1");
    expect(environment.ipykernel).toBe("7.4.0");

    await load("notebook_data()");
    const originalSession = store.session.id;
    expect(store.payload.row_count).toBe(12000);
    expect(store.payload.rows.length).toBe(1000);
    const page = await store.fetchRows({ offset: 11500, limit: 2 });
    expect(page).toEqual([
      [11500, "even"],
      [11501, "odd"],
    ]);
    expect(page[0]._explorer.navigation.accessor).toBe(".iloc[11500]");

    store.addFilter({ column: 0, operator: "range", min: 10000, max: 10099 });
    await waitForStore(store, () => !store.loading);
    expect(store.payload.row_count).toBe(100);
    store.sortByColumn("n", 0, { direction: "descending" });
    await waitForStore(store, () => !store.loading);
    expect(await store.fetchRows({ offset: 0, limit: 2 })).toEqual([
      [10099, "odd"],
      [10098, "even"],
    ]);
    store.loadProfile();
    await waitForStore(store, () => !store.profileLoading);
    expect(store.profileError).toBeNull();
    expect(store.profile.total).toBe(100);
    expect(store.profile.distinct).toBe(100);
    const search = await store.request("search", { source: "^10087$" });
    expect(search.matches).toEqual([{ row: 12, column: 0 }]);
    expect(
      await executeQuery(
        kernel,
        "print(json.dumps({'calls': len(calls), 'sessions': len(_jupyter_explorer_sessions)}))",
      ),
    ).toEqual({ calls: 1, sessions: 1 });

    store.refresh();
    await waitForStore(store, () => !store.loading);
    expect(store.error).toBeNull();
    expect(store.payload.row_count).toBe(12000);
    expect(store.filters).toEqual([]);
    expect(store.session.id).not.toBe(originalSession);
    expect(
      await executeQuery(
        kernel,
        "print(json.dumps({'calls': len(calls), 'sessions': len(_jupyter_explorer_sessions)}))",
      ),
    ).toEqual({ calls: 2, sessions: 1 });
  }, 60000);

  it("opens Arrow tables and all supported data files inside the running kernel", async () => {
    await executeQuery(
      kernel,
      `import json, numpy as np, pyarrow as pa, pyarrow.parquet as pq, pyarrow.feather as feather
table = pa.table({'n': np.arange(2500), 'tag': ['x'] * 2500})
pq.write_table(table, 'data.parquet')
feather.write_feather(table, 'data.feather')
with pa.OSFile('data.arrow', 'wb') as sink:
    with pa.ipc.new_file(sink, table.schema) as writer:
        writer.write_table(table)
with pa.OSFile('data.ipc', 'wb') as sink:
    with pa.ipc.new_stream(sink, table.schema) as writer:
        writer.write_table(table)
print(json.dumps(True))`,
    );
    for (const expression of [
      "table",
      ...["parquet", "feather", "arrow", "ipc"].map((extension) =>
        fileExpression(`data.${extension}`),
      ),
    ]) {
      await load(expression);
      expect(store.payload.kind).toBe("arrow");
      expect(store.payload.row_count).toBe(2500);
      const page = await store.fetchRows({ offset: 2400, limit: 1 });
      expect(page).toEqual([[2400, "x"]]);
      expect(page[0]._explorer.navigation.accessor).toBe(".slice(2400, 1)");
    }
    expect(await executeQuery(kernel, "print(json.dumps(len(_jupyter_explorer_sessions)))")).toBe(
      1,
    );
  }, 60000);
});
