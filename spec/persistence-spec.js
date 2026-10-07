const { recordRequest, settle } = require("./request-fixture");
const path = require("path");
const manifest = require("../package.json");
let main = require("../lib/main");
let explorerStore = require("../lib/explorer-store").explorerStore;
let ExplorerPane = require("../lib/explorer-pane");
const DESERIALIZER = "jupyter-explorer/ExplorerPane";
const STATE = {
  deserializer: DESERIALIZER,
};
function fakeKernel() {
  return {
    displayName: "Python 3",
    language: "python",
    grammar: {
      name: "Python",
      scopeName: "source.python",
    },
    request(specification) {
      return recordRequest(this, specification);
    },
    generation: 0,
    onDidChangeGeneration: () => ({
      dispose() {},
    }),
  };
}
function fakeProvider(kernel) {
  return {
    getActiveKernel: () => kernel,
    onDidRemoveKernel: () => ({
      dispose() {},
    }),
  };
}
describe("jupyter explorer pane persistence", () => {
  let loadedPackage = null;
  beforeEach(() => {
    main = require("../lib/main");
    explorerStore = require("../lib/explorer-store").explorerStore;
    ExplorerPane = require("../lib/explorer-pane");
  });
  afterEach(async () => {
    if (loadedPackage && lumine.packages.isPackageActive(loadedPackage.name)) {
      await lumine.packages.deactivatePackage(loadedPackage.name);
    } else {
      main.deactivate();
    }
    if (loadedPackage && lumine.packages.isPackageLoaded(loadedPackage.name)) {
      await lumine.packages.unloadPackage(loadedPackage.name);
    }
    loadedPackage = null;
    explorerStore.reset();
  });
  it("declares the namespaced deserializer and serializes only its identity", async () => {
    expect(manifest.deserializers).toEqual({
      [DESERIALIZER]: "deserializeExplorerPane",
    });
    main.initialize();
    await settle();
    const restored = main.deserializeExplorerPane();
    expect(restored.serialize()).toEqual(STATE);
  });
  it("round-trips through the manifest-registered proxy before activation", async () => {
    const source = new ExplorerPane();
    const state = source.serialize();
    source.destroy();
    await settle();
    loadedPackage = lumine.packages.loadPackage(path.resolve(__dirname, ".."));
    const restored = lumine.deserializers.deserialize(state);
    expect(restored).toBeTruthy();
    expect(restored.serialize()).toEqual(state);
    expect(lumine.deserializers.deserialize(restored.serialize())).toBe(restored);
    expect(loadedPackage.mainInitialized).toBe(true);
    // The deserializer runs before the initial package batch. It may restore
    // the singleton from the facade, but the live activate hook waits for the
    // normal bootstrap to finish.
    expect(loadedPackage.mainActivated).toBe(false);
    await settle();
  });
  it("keeps the restored singleton through activation and recreates it after close", async () => {
    main.initialize();
    await settle();
    const restored = main.deserializeExplorerPane();
    main.activate();
    await settle();
    const opened = await lumine.workspace.open(main.EXPLORER_URI, {
      searchAllPanes: true,
    });
    expect(opened).toBe(restored);
    expect(
      lumine.workspace.getPaneItems().filter((item) => item.getURI?.() === main.EXPLORER_URI)
        .length,
    ).toBe(1);
    restored.destroy();
    await settle();
    const reopened = await lumine.workspace.open(main.EXPLORER_URI, {
      searchAllPanes: true,
    });
    expect(reopened).not.toBe(restored);
  });
  it("connects a late kernel provider to the pane restored before activation", async () => {
    main.initialize();
    await settle();
    const restored = main.deserializeExplorerPane();
    main.activate();
    await settle();
    const kernel = fakeKernel();
    const service = main.consumeJupyterKernel(fakeProvider(kernel));
    const opened = await main.provideExplorer().explore(kernel, "frame");
    expect(opened).toBe(restored);
    expect(restored.getJupyterKernel()).toBe(kernel);
    service.dispose();
    await settle();
  });
});
