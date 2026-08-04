const { CompositeDisposable, Disposable, Emitter } = require("atom");
const DataExplorer = require("./data-explorer");
const { dataExplorerStore } = require("./data-explorer-store");

const DATA_EXPLORER_URI = "lumine://jupyter-explorer";

class DataExplorerPane {
  constructor() {
    this.emitter = new Emitter();
    this.destroyed = false;
    this.element = document.createElement("div");
    this.element.classList.add("jupyter-explorer");
    this.element.tabIndex = -1;

    this.component = new DataExplorer({ des: dataExplorerStore });
    this.element.appendChild(this.component.element);

    this.element.addEventListener("focus", this.redirectFocus);
    // Remember the last element focused inside the pane, so re-focusing it
    // (e.g. window:focus-pane-on-right) restores where the user was instead of
    // always jumping back to the expression editor.
    this.element.addEventListener("focusin", this.rememberFocus);
    this.disposer = new CompositeDisposable(
      new Disposable(() => {
        this.element.removeEventListener("focus", this.redirectFocus);
        this.element.removeEventListener("focusin", this.rememberFocus);
      }),
      new Disposable(() => this.component.destroy()),
    );
  }

  getTitle = () => "Data Explorer";
  getIconName = () => "graph";
  getURI = () => DATA_EXPLORER_URI;
  getDefaultLocation = () => "center";
  getAllowedLocations = () => ["center"];

  // The data on screen came from one particular kernel, not necessarily the
  // last focused editor's, so `jupyter-repl` asks this pane which one it shows.
  getJupyterKernel() {
    return dataExplorerStore.kernel || null;
  }

  onDidChangeJupyterKernel(callback) {
    return dataExplorerStore.onDidUpdate(callback);
  }

  rememberFocus = (event) => {
    const target = event.target;
    if (target && target !== this.element && this.element.contains(target)) {
      this._lastFocused = target;
    }
  };

  // The element to focus on the first focus, before the user has interacted.
  getDefaultFocusTarget() {
    return (
      this.element.querySelector("atom-text-editor.data-explorer-expression") ||
      this.element.querySelector(
        ".data-explorer-grid-view:not(.is-hidden) .data-explorer-canvas-wrap",
      ) ||
      this.element.querySelector(
        ".data-explorer-grid-view:not(.is-hidden) .data-explorer-scalar",
      ) ||
      this.element.querySelector(".data-explorer-table-wrapper") ||
      this.element.querySelector(".data-explorer-plot") ||
      this.element.querySelector(".data-explorer-body") ||
      this.element
    );
  }

  // Prefer the last focused inner element, if it is still there and visible, so
  // the pane restores where the user was; otherwise fall back to the default.
  getFocusTarget() {
    const last = this._lastFocused;
    if (last && this.element.contains(last) && last.offsetParent !== null) {
      return last;
    }
    return this.getDefaultFocusTarget();
  }

  redirectFocus = (event) => {
    if (event.target !== this.element) {
      return;
    }
    const target = this.getFocusTarget();
    if (target !== this.element) {
      requestAnimationFrame(() => target.focus?.({ preventScroll: true }));
    }
  };

  focus = () => {
    this.getFocusTarget().focus?.({ preventScroll: true });
  };

  // Explicitly focus the expression editor. The explore command uses this, so
  // running it always lands ready to type, even if the grid had the focus.
  focusExpression = () => {
    const editor = this.element.querySelector("atom-text-editor.data-explorer-expression");
    (editor || this.getDefaultFocusTarget())?.focus?.({ preventScroll: true });
  };

  /**
   * A pane only drops an item it is told about. Destroying the item directly —
   * which is what happens when the kernel service goes away — leaves the tab
   * behind without this.
   *
   * @param {Function} callback
   * @returns {Disposable}
   */
  onDidDestroy(callback) {
    return this.emitter.on("did-destroy", callback);
  }

  destroy() {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.disposer.dispose();
    this.element.remove();
    this.emitter.emit("did-destroy");
    this.emitter.dispose();
  }
}

module.exports = DataExplorerPane;
module.exports.DATA_EXPLORER_URI = DATA_EXPLORER_URI;
