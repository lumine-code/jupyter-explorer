const { Disposable } = require("lumine");
describe("explorer passive kernel availability", () => {
  it("reads the saved target through the passive kernel port without loading an explorer", () => {
    const main = require("../lib/main");
    main.initialize();
    main.activate();
    const editor = lumine.workspace.buildTextEditor();
    const lookup = jasmine.createSpy("runtime lookup");
    let state = null;
    const peek = jasmine.createSpy("cached lookup").and.callFake(() => state);
    const changed = spyOn(lumine.commands, "invalidateAvailability").and.callThrough();
    let notify;
    const kernel = main.consumeJupyterKernel({
      peekKernelState: peek,
      getKernelForEditor: lookup,
      onDidRemoveKernel: () => new Disposable(),
      onDidChangeKernelState: (callback) => {
        notify = callback;
        return new Disposable();
      },
    });
    const context = main.consumeJupyterContext({ getExpressionAtCursor: lookup });
    const available = () => lumine.commands.canDispatch(editor.element, "jupyter-explorer:explore");
    try {
      expect(available()).toBe(false);
      state = { language: "python", connectionState: "ready" };
      expect(available()).toBe(true);
      expect(peek.calls.mostRecent().args[0].editor).toBe(editor);
      expect(lookup).not.toHaveBeenCalled();
      notify();
      expect(changed).toHaveBeenCalled();
      state = { language: "julia" };
      expect(available()).toBe(false);
      expect(main.provideSearchAdapter().canReplaceItem({})).toBe(false);
    } finally {
      context.dispose();
      kernel.dispose();
      editor.destroy();
      main.deactivate();
    }
  });
});
