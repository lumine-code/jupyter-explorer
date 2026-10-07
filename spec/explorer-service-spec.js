const { recordRequest, settle } = require("./request-fixture");
const main = require("../lib/main");
const { explorerStore } = require("../lib/explorer-store");

// The Variables panel lives in another package and hands a name over through
// `jupyter.explorer`. These pin the shape that seam depends on.

function fakeKernel(language = "python") {
  return {
    displayName: "Python 3",
    language,
    grammar: {
      name: "Python",
      scopeName: "source.python",
    },
    executed: [],
    request(specification) {
      return recordRequest(this, specification);
    },
    generation: 0,
    onDidChangeGeneration: () => ({
      dispose() {},
    }),
  };
}
function fakeProvider(kernel, expression) {
  return {
    removed: [],
    getActiveKernel: () => kernel,
    getExpressionAtCursor: () => expression,
    onDidRemoveKernel(callback) {
      this.removed.push(callback);
      return {
        dispose: () => {},
      };
    },
  };
}
describe("jupyter.explorer", () => {
  afterEach(() => {
    explorerStore.reset();
    for (const item of lumine.workspace.getPaneItems()) {
      if (item.getURI?.() === main.EXPLORER_URI) {
        item.destroy();
      }
    }
  });
  it("shows what a consumer hands over", async () => {
    main.activate();
    await settle();
    const kernel = fakeKernel();
    const item = await main.provideExplorer().explore(kernel, "df.head()");
    expect(explorerStore.kernel).toBe(kernel);
    expect(explorerStore.expression).toBe("df.head()");
    expect(item.getURI()).toBe(main.EXPLORER_URI);
    main.deactivate();
    await settle();
  });
  it("open picks up the cursor context the old command used to", async () => {
    main.activate();
    await settle();
    const kernel = fakeKernel();
    main.consumeJupyterKernel(fakeProvider(kernel, "df.head()"));
    main.consumeJupyterContext({
      getFocusedEditor: () => null,
      getExpressionAtCursor: () => "df.head()",
    });
    await settle();
    await lumine.commands.dispatch(lumine.views.getView(lumine.workspace), "jupyter-explorer:open");
    expect(explorerStore.kernel).toBe(kernel);
    expect(explorerStore.expression).toBe("df.head()");
    main.deactivate();
    await settle();
  });
  it("open with no expression still binds the kernel, so the editor works", async () => {
    main.activate();
    await settle();
    const kernel = fakeKernel();
    main.consumeJupyterKernel(fakeProvider(kernel, ""));
    await settle();
    await lumine.commands.dispatch(lumine.views.getView(lumine.workspace), "jupyter-explorer:open");
    expect(explorerStore.kernel).toBe(kernel);
    expect(explorerStore.expression).toBe("");
    main.deactivate();
    await settle();
  });
  it("reports the kernel it is showing to whoever asks the pane item", async () => {
    main.activate();
    await settle();
    const kernel = fakeKernel();
    const item = await main.provideExplorer().explore(kernel, "df");
    expect(item.getJupyterKernel()).toBe(kernel);
    main.deactivate();
    await settle();
  });
  it("empties itself when the kernel it was showing goes away", async () => {
    main.activate();
    await settle();
    const kernel = fakeKernel();
    const provider = fakeProvider(kernel, "df");
    main.consumeJupyterKernel(provider);
    await settle();
    await main.provideExplorer().explore(kernel, "df");
    expect(explorerStore.kernel).toBe(kernel);
    provider.removed[0](kernel);
    await settle();
    expect(explorerStore.kernel).toBe(null);
    main.deactivate();
    await settle();
  });
  it("refuses a kernel that is not Python rather than running code on it", async () => {
    main.activate();
    await settle();
    const kernel = fakeKernel("julia");
    main.consumeJupyterKernel(fakeProvider(kernel, "df"));
    await settle();
    spyOn(lumine.notifications, "addWarning");
    await settle();
    await lumine.commands.dispatch(
      lumine.views.getView(lumine.workspace),
      "jupyter-explorer:explore",
    );
    expect(lumine.notifications.addWarning).toHaveBeenCalled();
    expect(kernel.executed).toEqual([]);
    main.deactivate();
    await settle();
  });
});
