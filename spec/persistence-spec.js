const path = require("path");
const manifest = require("../package.json");
const main = require("../lib/main");
const { explorerStore } = require("../lib/explorer-store");
const ExplorerPane = require("../lib/explorer-pane");

const DESERIALIZER = "jupyter-explorer/ExplorerPane";
const STATE = { deserializer: DESERIALIZER };

function fakeKernel() {
  return {
    displayName: "Python 3",
    language: "python",
    grammar: { name: "Python", scopeName: "source.python" },
    executeWatch() {},
  };
}

function fakeProvider(kernel) {
  return {
    getActiveKernel: () => kernel,
    getExpressionAtCursor: () => "frame",
    onDidRemoveKernel: () => ({ dispose() {} }),
  };
}

describe("jupyter explorer pane persistence", () => {
  let loadedPackage = null;

  afterEach(async () => {
    if (loadedPackage && lumine.packages.isPackageActive(loadedPackage.name)) {
      await lumine.packages.deactivatePackage(loadedPackage.name);
    } else {
      main.deactivate();
    }
    if (loadedPackage && lumine.packages.isPackageLoaded(loadedPackage.name)) {
      lumine.packages.unloadPackage(loadedPackage.name);
    }
    loadedPackage = null;
    explorerStore.reset();
  });

  it("declares the namespaced deserializer and serializes only its identity", () => {
    expect(manifest.deserializers).toEqual({
      [DESERIALIZER]: "deserializeExplorerPane",
    });

    main.initialize();
    const restored = main.deserializeExplorerPane();

    expect(restored.serialize()).toEqual(STATE);
  });

  it("round-trips through the manifest-registered proxy before activation", () => {
    const source = new ExplorerPane();
    const state = source.serialize();
    source.destroy();

    spyOn(lumine.packages, "hasActivatedInitialPackages").and.returnValue(false);
    loadedPackage = lumine.packages.loadPackage(path.resolve(__dirname, ".."));

    const restored = lumine.deserializers.deserialize(state);

    expect(restored).toBeTruthy();
    expect(restored.serialize()).toEqual(state);
    expect(lumine.deserializers.deserialize(restored.serialize())).toBe(restored);
    expect(loadedPackage.mainInitialized).toBe(true);
    expect(loadedPackage.mainActivated).toBe(false);
  });

  it("keeps the restored singleton through activation and recreates it after close", async () => {
    main.initialize();
    const restored = main.deserializeExplorerPane();

    main.activate();
    const opened = await lumine.workspace.open(main.EXPLORER_URI, { searchAllPanes: true });

    expect(opened).toBe(restored);
    expect(
      lumine.workspace.getPaneItems().filter((item) => item.getURI?.() === main.EXPLORER_URI)
        .length,
    ).toBe(1);

    restored.destroy();
    const reopened = await lumine.workspace.open(main.EXPLORER_URI, { searchAllPanes: true });
    expect(reopened).not.toBe(restored);
  });

  it("connects a late kernel provider to the pane restored before activation", async () => {
    main.initialize();
    const restored = main.deserializeExplorerPane();
    main.activate();
    const kernel = fakeKernel();
    const service = main.consumeJupyterKernel(fakeProvider(kernel));

    const opened = await main.provideExplorer().explore(kernel, "frame");

    expect(opened).toBe(restored);
    expect(restored.getJupyterKernel()).toBe(kernel);
    service.dispose();
  });
});
