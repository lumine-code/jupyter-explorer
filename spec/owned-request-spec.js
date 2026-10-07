const { executeQuery } = require("../lib/kernel-query");
const { ExplorerStore } = require("../lib/explorer-store");
const { recordRequest, generationKernel, settle } = require("./request-fixture");
function kernel() {
  return generationKernel({
    language: "python",
    requests: [],
    request(specification) {
      return recordRequest(this, specification);
    },
  });
}
describe("owned explorer requests", () => {
  it("releases a cancelled query without interrupting the shared kernel", async () => {
    const source = kernel();
    source.interrupt = jasmine.createSpy("interrupt");
    const controller = new AbortController();
    const query = executeQuery(source, "data", { signal: controller.signal });
    controller.abort();
    await expectAsync(query).toBeRejectedWith(jasmine.objectContaining({ name: "AbortError" }));
    expect(source.requests[0].disposed).toBe(true);
    expect(source.interrupt).not.toHaveBeenCalled();
  });
  it("disposes a superseded load before observing its replacement", async () => {
    const source = kernel();
    const store = new ExplorerStore();
    store.load(source, "old");
    store.loadExpression("new");
    expect(source.requests[0].disposed).toBe(true);
    store.reset();
    await settle();
  });
  it("empties pinned data and cancels its requests on a generation change", async () => {
    const source = kernel();
    const store = new ExplorerStore();
    store.load(source, "data");
    source.advanceGeneration();
    await settle();
    expect(store.kernel).toBeNull();
    expect(store.payload).toBeNull();
    expect(store.loading).toBe(false);
    expect(source.requests[0].disposed).toBe(true);
    store.reset();
  });
});
