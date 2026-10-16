const { spawnSync } = require("node:child_process");

describe("Explorer bootstrap ownership", () => {
  it("publishes empty services without loading data queries or search and shares first-use state", () => {
    const script = `
const assert = require("node:assert/strict");
const Module = require("node:module");
const api = Module.createRequire(${JSON.stringify(require.resolve("lumine"))})("@lumine-code/event-kit");
const load = Module._load;
Module._load = function(name, ...args) { return name === "lumine" ? api : load.call(this, name, ...args); };
const subscribe = () => new api.Disposable();
global.lumine = {
  commands: { add: subscribe, invalidateAvailability() {} },
  packages: {},
  workspace: { addOpener: subscribe, getPaneItems: () => [] },
};
const main = require(${JSON.stringify(require.resolve("../lib/main"))});
main.activate();
const kernel = main.consumeJupyterKernel({ onDidRemoveKernel: subscribe, onDidChangeKernelState: subscribe });
const context = main.consumeJupyterContext({});
const watch = main.consumeAutocompleteWatchEditor(subscribe);
main.provideExplorer();
const search = main.provideSearchAdapter();
assert.equal(search.handlesItem({}), false);
kernel.dispose(); context.dispose(); watch.dispose(); main.deactivate();
for (const filename of ${JSON.stringify(["explorer-store", "explorer-search", "kernel-query"].map((name) => require.resolve("../lib/" + name)))}) {
  assert.equal(require.cache[filename], undefined, filename + " loaded without an explorer operation");
}
main.activate();
const { explorerStore } = require(${JSON.stringify(require.resolve("../lib/explorer-store"))});
assert.equal(main.provideSearchAdapter().getAdapterForItem({ getURI: () => main.EXPLORER_URI }), explorerStore.getSearchAdapter());
main.deactivate();
`;
    const result = spawnSync(process.execPath, ["-e", script], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      encoding: "utf8",
      timeout: 15000,
      windowsHide: true,
    });
    expect(result.status)
      .withContext(result.stderr || result.error?.message)
      .toBe(0);
  });
});
