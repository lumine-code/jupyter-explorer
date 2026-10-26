const { TextBuffer } = require("lumine");
const etch = require("@lumine-code/etch");
function hugeSource() {
  let source = TextBuffer.createTextSnapshot("x".repeat(65536));
  while (source.length < 1024 * 1024 * 1024)
    source = source.replace(source.length, source.length, source);
  return source;
}
const Explorer = require("../lib/explorer");
const { ExplorerStore } = require("../lib/explorer-store");
describe("explorer expression input budget", () => {
  let store, view;
  beforeEach(() => {
    store = new ExplorerStore();
    view = new Explorer({ store });
  });
  afterEach(() => {
    view?.destroy();
    store.reset();
  });
  it("retains a beyond-string-limit draft through rerender and remount without reading text", () => {
    const source = hugeSource();
    const editor = view.refs.expression.editor;
    const read = spyOn(editor, "getText").and.throwError("whole input read");
    editor.setText(source);
    etch.updateSync(view);
    expect(store.expressionError).toContain("65,536");
    expect(store.expressionSource.length).toBe(source.length);
    expect(editor.getBuffer().getLength()).toBe(source.length);
    const confirm = spyOn(store, "loadExpression");
    lumine.commands.dispatch(editor.element, "core:confirm");
    store.refresh();
    expect(confirm).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
    read.and.callThrough();
    view.destroy();
    view = new Explorer({ store });
    expect(view.refs.expression.editor.getBuffer().getLength()).toBe(source.length);
    view.refs.expression.editor.setText("recovered");
    etch.updateSync(view);
    expect(store.expression).toBe("recovered");
    expect(store.expressionError).toBeNull();
    expect(view.element.querySelector(".input-budget-error").hidden).toBeTrue();
  });
  it("cancels pending evaluation and blocks refresh of the old expression until recovery", () => {
    store.expression = "old";
    store.fetchController = new AbortController();
    store.loading = true;
    store.setExpression("x".repeat(65537));
    expect(store.fetchController.signal.aborted).toBeTrue();
    expect(store.loading).toBeFalse();
    const build = spyOn(store, "setError");
    store.refresh();
    expect(build).toHaveBeenCalledWith(store.expressionError);
    expect(store.setExpression("x".repeat(65536))).toBeTrue();
    expect(store.expression.length).toBe(65536);
  });
});
