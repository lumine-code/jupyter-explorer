const main = require("../lib/main");
const { dataExplorerStore } = require("../lib/data-explorer-store");

// The Variables panel lives in another package and hands a name over through
// `jupyter.explorer`. These pin the shape that seam depends on.

function fakeKernel(language = "python") {
  return {
    displayName: "Python 3",
    language,
    grammar: { name: "Python", scopeName: "source.python" },
    executed: [],
    executeWatch(code) {
      this.executed.push(code);
    },
  };
}

function fakeProvider(kernel, expression) {
  return {
    removed: [],
    getActiveKernel: () => kernel,
    getExpressionAtCursor: () => expression,
    onDidRemoveKernel(callback) {
      this.removed.push(callback);
      return { dispose: () => {} };
    },
  };
}

describe("jupyter.explorer", () => {
  afterEach(() => {
    dataExplorerStore.reset();
    for (const item of atom.workspace.getPaneItems()) {
      if (item.getURI?.() === main.DATA_EXPLORER_URI) {
        item.destroy();
      }
    }
  });

  it("shows what a consumer hands over", async () => {
    main.activate();
    const kernel = fakeKernel();

    const item = await main.provideDataExplorer().explore(kernel, "df.head()");

    expect(dataExplorerStore.kernel).toBe(kernel);
    expect(dataExplorerStore.expression).toBe("df.head()");
    expect(item.getURI()).toBe(main.DATA_EXPLORER_URI);
    main.deactivate();
  });

  it("open picks up the cursor context the old command used to", async () => {
    main.activate();
    const kernel = fakeKernel();
    main.consumeJupyterKernel(fakeProvider(kernel, "df.head()"));

    await atom.commands.dispatch(atom.views.getView(atom.workspace), "jupyter-explorer:open");

    expect(dataExplorerStore.kernel).toBe(kernel);
    expect(dataExplorerStore.expression).toBe("df.head()");
    main.deactivate();
  });

  it("open with no expression still binds the kernel, so the editor works", async () => {
    main.activate();
    const kernel = fakeKernel();
    main.consumeJupyterKernel(fakeProvider(kernel, ""));

    await atom.commands.dispatch(atom.views.getView(atom.workspace), "jupyter-explorer:open");

    expect(dataExplorerStore.kernel).toBe(kernel);
    expect(dataExplorerStore.expression).toBe("");
    main.deactivate();
  });

  it("reports the kernel it is showing to whoever asks the pane item", async () => {
    main.activate();
    const kernel = fakeKernel();

    const item = await main.provideDataExplorer().explore(kernel, "df");

    expect(item.getJupyterKernel()).toBe(kernel);
    main.deactivate();
  });

  it("empties itself when the kernel it was showing goes away", async () => {
    main.activate();
    const kernel = fakeKernel();
    const provider = fakeProvider(kernel, "df");
    main.consumeJupyterKernel(provider);

    await main.provideDataExplorer().explore(kernel, "df");
    expect(dataExplorerStore.kernel).toBe(kernel);

    provider.removed[0](kernel);

    expect(dataExplorerStore.kernel).toBe(null);
    main.deactivate();
  });

  it("refuses a kernel that is not Python rather than running code on it", async () => {
    main.activate();
    const kernel = fakeKernel("julia");
    main.consumeJupyterKernel(fakeProvider(kernel, "df"));
    spyOn(atom.notifications, "addWarning");

    await atom.commands.dispatch(atom.views.getView(atom.workspace), "jupyter-explorer:explore");

    expect(atom.notifications.addWarning).toHaveBeenCalled();
    expect(kernel.executed).toEqual([]);
    main.deactivate();
  });
});
