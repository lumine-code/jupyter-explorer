const { Disposable } = require("lumine");
const { recordRequest, generationKernel, settle } = require("./request-fixture");
describe("explorer provider ownership", () => {
  let main;
  let store;
  beforeEach(() => {
    main = require("../lib/main");
    store = require("../lib/explorer-store").explorerStore;
    main.initialize();
    main.activate();
  });
  afterEach(() => main.deactivate());
  function provider() {
    return { getActiveKernel: () => null, onDidRemoveKernel: () => new Disposable() };
  }
  it("cancels the previous provider's pinned query and ignores its old disposer", async () => {
    const first = main.consumeJupyterKernel(provider());
    await settle();
    const kernel = generationKernel({
      language: "python",
      requests: [],
      request(specification) {
        return recordRequest(this, specification);
      },
    });
    store.load(kernel, "value");
    const replacement = main.consumeJupyterKernel(provider());
    await settle();
    expect(kernel.requests[0].disposed).toBe(true);
    expect(store.kernel).toBeNull();
    const pane = main.deserializeExplorerPane();
    first.dispose();
    expect(pane.destroyed).not.toBe(true);
    replacement.dispose();
    expect(pane.destroyed).toBe(true);
  });
  it("does not reopen a retired explorer provider", async () => {
    const service = main.provideExplorer();
    main.deactivate();
    expect(await service.explore(null, "value")).toBeUndefined();
    expect(
      lumine.workspace.getPaneItems().some((item) => item.getURI?.() === main.EXPLORER_URI),
    ).toBe(false);
  });
  it("does not load a file after its dialog outlives the explorer package", async () => {
    let finish;
    spyOn(lumine.window, "showOpenDialog").and.returnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const kernel = generationKernel({
      language: "python",
      requests: [],
      request(specification) {
        return recordRequest(this, specification);
      },
    });
    const opening = main.provideExplorer().openFile(kernel, null);
    main.deactivate();
    finish({ filePaths: ["data.parquet"] });
    expect(await opening).toBeUndefined();
    expect(kernel.requests.length).toBe(0);
  });
});
