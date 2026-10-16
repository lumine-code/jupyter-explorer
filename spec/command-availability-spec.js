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
      state = { language: "python", connectionState: "unresponsive" };
      expect(available()).toBe(false);
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
  it("opens a data-file dialog for the saved window's kernel, without borrowing the main document", async () => {
    jasmine.attachToDOM(lumine.workspace.getElement());
    const main = require("../lib/main");
    main.initialize();
    main.activate();
    const first = await lumine.workspace.open();
    const extra = await lumine.workspace.openEditorWindow({ show: false });
    const second = lumine.workspace.buildTextEditor();
    extra.getEditorContainer().getActivePane().activateItem(second, { activatePane: true });
    const targetKernel = { language: "python" };
    const lookup = jasmine.createSpy("target kernel").and.returnValue(targetKernel);
    const peek = jasmine
      .createSpy("cached target kernel")
      .and.callFake(({ item }) =>
        item === second ? { language: "python", connectionState: "ready" } : null,
      );
    const lease = main.consumeJupyterKernel({
      peekKernelState: peek,
      getKernelForItem: lookup,
      onDidRemoveKernel: () => new Disposable(),
    });
    const dialog = spyOn(extra, "showOpenDialog").and.resolveTo({ filePaths: [] });
    try {
      expect(
        lumine.commands.canDispatch(second.getElement(), "jupyter-explorer:open-data-file"),
      ).toBe(true);
      expect(lookup).not.toHaveBeenCalled();
      await lumine.commands.dispatch(second.getElement(), "jupyter-explorer:open-data-file");
      expect(lookup).toHaveBeenCalledOnceWith(second);
      expect(dialog).toHaveBeenCalledTimes(1);
      second.destroy();
      expect(
        lumine.commands.canDispatch(extra.getElement(), "jupyter-explorer:open-data-file"),
      ).toBe(false);
      expect(first.isDestroyed()).toBe(false);
    } finally {
      lease.dispose();
      first.destroy();
      await lumine.workspace.discardEditorWindows();
      main.deactivate();
    }
  });
});
