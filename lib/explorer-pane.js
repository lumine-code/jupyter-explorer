const { CompositeDisposable, Disposable, Emitter } = require("atom");
const Explorer = require("./explorer");
const { explorerStore } = require("./explorer-store");

const EXPLORER_URI = "lumine://jupyter-explorer";

class ExplorerPane {
  constructor() {
    this.emitter = new Emitter();
    this.destroyed = false;
    this.element = document.createElement("div");
    this.element.classList.add("jupyter-explorer");
    this.element.tabIndex = -1;

    this.component = new Explorer({ store: explorerStore });
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

  getTitle = () => "Explorer";
  getIconName = () => "graph";
  getURI = () => EXPLORER_URI;
  getDefaultLocation = () => "center";
  getAllowedLocations = () => ["center"];

  // The data on screen came from one particular kernel, not necessarily the
  // last focused editor's, so `jupyter-repl` asks this pane which one it shows.
  getJupyterKernel() {
    return explorerStore.kernel || null;
  }

  onDidChangeJupyterKernel(callback) {
    return explorerStore.onDidUpdate(callback);
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
      this.element.querySelector("atom-text-editor.explorer-expression") ||
      this.element.querySelector(".explorer-grid-view:not(.is-hidden) .explorer-canvas-wrap") ||
      this.element.querySelector(".explorer-grid-view:not(.is-hidden) .explorer-scalar") ||
      this.element.querySelector(".explorer-table-wrapper") ||
      this.element.querySelector(".explorer-plot") ||
      this.element.querySelector(".explorer-body") ||
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
      requestAnimationFrame(() => {
        // Stand down when focus moved on while this was pending: an explicit
        // focusExpression() — or the user clicking anywhere — must not be
        // overridden by a deferred hand-off from an earlier focus.
        if (document.activeElement === this.element) {
          target.focus?.({ preventScroll: true });
        }
      });
    }
  };

  focus = () => {
    this.getFocusTarget().focus?.({ preventScroll: true });
  };

  // Explicitly focus the expression editor. The explore command uses this, so
  // running it always lands ready to type, even if the grid had the focus.
  focusExpression = () => {
    const editor = this.element.querySelector("atom-text-editor.explorer-expression");
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

module.exports = ExplorerPane;
module.exports.EXPLORER_URI = EXPLORER_URI;
