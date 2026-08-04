const { CompositeDisposable, Disposable } = require("atom");
const { dataExplorerStore } = require("./data-explorer-store");
const { autocompleteConsumer } = require("./autocomplete");

const DATA_EXPLORER_URI = "lumine://jupyter-explorer";

let subscriptions = null;
let provider = null;

// This package activates at startup rather than on one of its own commands,
// because it provides services: `activateServices` runs inside `activateNow`,
// so a package waiting on an activation command has published nothing and a
// consumer never hears from it. Activation stays cheap — the grid, and the
// plotly bundle behind it, are required when a pane is first opened.
function activate() {
  subscriptions = new CompositeDisposable(
    atom.commands.add("atom-workspace", {
      "jupyter-explorer:explore": () => explore(),
      "jupyter-explorer:open": () => open(),
    }),
    atom.workspace.addOpener((uri) => (uri === DATA_EXPLORER_URI ? createPane() : undefined)),
    new Disposable(() => destroyPane()),
  );
}

function deactivate() {
  subscriptions?.dispose();
  subscriptions = null;
  dataExplorerStore.reset();
}

function consumeJupyterKernel(jupyterProvider) {
  provider = jupyterProvider;

  // Every method on a wrapper throws once its kernel is gone, so data left on
  // screen after a shutdown is a panel holding a reference it must not use.
  const removed = provider.onDidRemoveKernel((kernel) => {
    if (dataExplorerStore.kernel === kernel) {
      dataExplorerStore.reset();
    }
  });

  return new Disposable(() => {
    removed.dispose();
    provider = null;
    dataExplorerStore.reset();
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
  const handlesItem = (item) => item?.getURI?.() === DATA_EXPLORER_URI;
  return {
    handlesItem,
    getAdapterForItem(item) {
      return handlesItem(item) ? dataExplorerStore.getSearchAdapter() : null;
    },
  };
}

function createPane() {
  const DataExplorerPane = require("./data-explorer-pane");
  return new DataExplorerPane();
}

function destroyPane() {
  atom.workspace
    .getPaneItems()
    .find((item) => item.getURI?.() === DATA_EXPLORER_URI)
    ?.destroy();
}

function warn(description) {
  atom.notifications.addWarning("jupyter-explorer", { description });
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
    warn("The Data Explorer only works with Python kernels.");
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
  dataExplorerStore.load(kernel, expression);
  return open();
}

async function open() {
  // Opening an empty panel picks up whatever context is there — the kernel of
  // the active editor, and the expression under its cursor when one exists —
  // because that is what the single command did before the split, and a panel
  // with a kernel bound has a working expression editor. Unlike explore(),
  // nothing here warns: open is allowed to open empty.
  if (!dataExplorerStore.kernel && provider) {
    const kernel = provider.getActiveKernel();
    if (kernel && kernel.language && kernel.language.toLowerCase() === "python") {
      const expression = provider.getExpressionAtCursor();
      if (expression) {
        dataExplorerStore.load(kernel, expression);
      } else {
        dataExplorerStore.adoptKernel(kernel);
      }
    }
  }
  const item = await atom.workspace.open(DATA_EXPLORER_URI, { searchAllPanes: true });
  item?.focusExpression?.();
  return item;
}

/**
 * The `jupyter.explorer` service.
 * @returns {Object}
 */
function provideDataExplorer() {
  return { explore: (kernel, expression) => load(kernel, expression) };
}

module.exports = {
  activate,
  deactivate,
  consumeJupyterKernel,
  consumeAutocompleteWatchEditor,
  provideSearchAdapter,
  provideDataExplorer,
  DATA_EXPLORER_URI,
};
