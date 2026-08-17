const { CompositeDisposable, Disposable } = require("lumine");
const { explorerStore } = require("./explorer-store");
const { autocompleteConsumer } = require("./autocomplete");
const etch = require("@lumine-code/etch");

// Etch holds its scheduler per copy of the library, and this package resolves
// its own copy — so the assignment the editor makes on core's copy never
// reaches it. Point it at the view registry before anything renders, or this
// package's DOM writes land on an animation frame of their own alongside the
// editor's and force a synchronous reflow.
etch.setScheduler(lumine.views);

const EXPLORER_URI = "lumine://jupyter-explorer";

let subscriptions = null;
let provider = null;

// This package activates at startup rather than on one of its own commands,
// because it provides services: `activateServices` runs inside `activateNow`,
// so a package waiting on an activation command has published nothing and a
// consumer never hears from it. Activation stays cheap — the grid, and the
// plotly bundle behind it, are required when a pane is first opened.
function activate() {
  subscriptions = new CompositeDisposable(
    lumine.commands.add("lumine-workspace", {
      "jupyter-explorer:explore": {
        description: "Open the variable explorer for the active kernel.",
        didDispatch: () => explore(),
      },
      "jupyter-explorer:open": {
        description: "Open the selected value in a tab of its own.",
        didDispatch: () => open(),
      },
    }),
    lumine.workspace.addOpener((uri) => (uri === EXPLORER_URI ? createPane() : undefined)),
    new Disposable(() => destroyPane()),
  );
}

function deactivate() {
  subscriptions?.dispose();
  subscriptions = null;
  explorerStore.reset();
}

function consumeJupyterKernel(jupyterProvider) {
  provider = jupyterProvider;

  // Every method on a wrapper throws once its kernel is gone, so data left on
  // screen after a shutdown is a panel holding a reference it must not use.
  const removed = provider.onDidRemoveKernel((kernel) => {
    if (explorerStore.kernel === kernel) {
      explorerStore.reset();
    }
  });

  return new Disposable(() => {
    removed.dispose();
    provider = null;
    explorerStore.reset();
    destroyPane();
  });
}

function consumeAutocompleteWatchEditor(watchEditor) {
  return autocompleteConsumer.consume(watchEditor);
}

/**
 * The grid answers the search panel's queries while it is the active item.
 * @returns {Object} A `search.adapter` provider
 */
function provideSearchAdapter() {
  const handlesItem = (item) => item?.getURI?.() === EXPLORER_URI;
  return {
    handlesItem,
    getAdapterForItem(item) {
      return handlesItem(item) ? explorerStore.getSearchAdapter() : null;
    },
  };
}

function createPane() {
  const ExplorerPane = require("./explorer-pane");
  return new ExplorerPane();
}

function destroyPane() {
  lumine.workspace
    .getPaneItems()
    .find((item) => item.getURI?.() === EXPLORER_URI)
    ?.destroy();
}

function warn(description) {
  lumine.notifications.addWarning("jupyter-explorer", { description });
}

/**
 * Explore whatever the cursor is on. The expression comes from the provider
 * rather than being parsed here, so it is the same one the REPL would run.
 */
async function explore() {
  if (!provider) {
    warn("Waiting for `jupyter-repl` to provide a kernel.");
    return;
  }

  const kernel = provider.getActiveKernel();
  if (!kernel) {
    warn("No running kernel for the current file.");
    return;
  }
  if (!kernel.language || kernel.language.toLowerCase() !== "python") {
    warn("jupyter-explorer only works with Python kernels.");
    return;
  }

  const expression = provider.getExpressionAtCursor();
  if (!expression) {
    warn("Select an expression or place the cursor on a variable to explore.");
    return;
  }

  await load(kernel, expression);
}

/**
 * Show an expression, opening the panel if it is not open yet. This is the
 * entry point another package uses — `jupyter-variable-explorer` calls it to
 * hand over a name the user picked out of the kernel's namespace.
 *
 * @param {JupyterKernel} kernel
 * @param {String} expression
 * @returns {Promise<Object>} The pane item
 */
async function load(kernel, expression) {
  explorerStore.load(kernel, expression);
  return open();
}

async function open() {
  // Opening an empty panel picks up whatever context is there — the kernel of
  // the active editor, and the expression under its cursor when one exists —
  // because that is what the single command did before the split, and a panel
  // with a kernel bound has a working expression editor. Unlike explore(),
  // nothing here warns: open is allowed to open empty.
  if (!explorerStore.kernel && provider) {
    const kernel = provider.getActiveKernel();
    if (kernel && kernel.language && kernel.language.toLowerCase() === "python") {
      const expression = provider.getExpressionAtCursor();
      if (expression) {
        explorerStore.load(kernel, expression);
      } else {
        explorerStore.adoptKernel(kernel);
      }
    }
  }
  const item = await lumine.workspace.open(EXPLORER_URI, { searchAllPanes: true });
  // The editor is the landing place however the panel was opened — a link
  // from jupyter-variables included. The grid draws no selection until the
  // keyboard reaches it, so nothing flashes on the way.
  item?.focusExpression?.();
  return item;
}

/**
 * The `jupyter.explorer` service.
 * @returns {Object}
 */
function provideExplorer() {
  return { explore: (kernel, expression) => load(kernel, expression) };
}

module.exports = {
  activate,
  deactivate,
  consumeJupyterKernel,
  consumeAutocompleteWatchEditor,
  provideSearchAdapter,
  provideExplorer,
  EXPLORER_URI,
};
