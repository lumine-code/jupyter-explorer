const { CompositeDisposable, Disposable } = require("lumine");
const { explorerStore } = require("./explorer-store");
const { autocompleteConsumer } = require("./autocomplete");
const { fileExpression } = require("./kernel-query");

const EXPLORER_URI = "lumine://jupyter-explorer";

let subscriptions = null;
let lifecycleGeneration = 0;
let context = null;
let contextConnection = null;
let provider = null;
let kernelConnection = null;
let kernelSubscription = null;
let pane;

function initialPackageBatchPending() {
  const packages = lumine.packages;
  return Boolean(
    packages?.activatePromise ||
    (packages?.hasLoadedInitialPackages?.() && !packages?.hasActivatedInitialPackages?.()),
  );
}

// Keep the singleton slot explicit so pane restoration and cold opens share it.
function initialize() {
  pane ??= null;
}

// Service publication is synchronous; the grid and plotly bundle stay lazy and
// are required only when a pane is opened.
function activate() {
  initialize();
  subscriptions = new CompositeDisposable(
    lumine.commands.add("lumine-text-editor:not([mini])", {
      "jupyter-explorer:explore": {
        description: "Open the variable explorer for the active kernel.",
        isAvailable: (event) => canExplore(event),
        didDispatch: (event) => explore(event),
      },
    }),
    lumine.commands.add("lumine-workspace", {
      "jupyter-explorer:open": {
        description: "Open the selected value in a tab of its own.",
        didDispatch: () => open(),
      },
      "jupyter-explorer:open-data-file": {
        description: "Open Parquet, Feather or Arrow data with the current Python kernel.",
        isAvailable: (event) => hasPythonKernel(dataFileTarget(event)),
        didDispatch: (event) => openDataFileForEvent(event),
      },
    }),
    lumine.workspace.addOpener((uri) => (uri === EXPLORER_URI ? getExplorerPane() : undefined)),
    new Disposable(() => destroyPane()),
  );
}

function deactivate() {
  lifecycleGeneration++;
  subscriptions?.dispose();
  subscriptions = null;
  context = null;
  contextConnection = null;
  destroyPane();
  explorerStore.reset();
  provider = null;
  kernelConnection = null;
  kernelSubscription?.dispose();
  kernelSubscription = null;
  autocompleteConsumer.revoke();
}

function consumeJupyterContext(service) {
  const connection = (contextConnection = {});
  context = service;
  lumine.commands.invalidateAvailability();
  return new Disposable(() => {
    if (contextConnection !== connection) return;
    contextConnection = null;
    context = null;
    lumine.commands.invalidateAvailability();
  });
}

function consumeJupyterKernel(jupyterProvider) {
  const connection = (kernelConnection = {});
  let disposed = false;
  let removed = null;
  const connect = () => {
    if (disposed || kernelConnection !== connection) return;
    kernelSubscription?.dispose();
    if (provider && provider !== jupyterProvider) explorerStore.reset();
    provider = jupyterProvider;
    lumine.commands.invalidateAvailability();

    // Every method on a wrapper throws once its kernel is gone, so data left on
    // screen after a shutdown is a panel holding a reference it must not use.
    removed = kernelSubscription = new CompositeDisposable(
      provider.onDidChangeKernelState?.(() => lumine.commands.invalidateAvailability()) ??
        new Disposable(),
      provider.onDidRemoveKernel((kernel) => {
        if (explorerStore.kernel === kernel) {
          explorerStore.reset();
        }
      }),
    );
  };
  if (initialPackageBatchPending()) queueMicrotask(connect);
  else connect();

  return new Disposable(() => {
    disposed = true;
    removed?.dispose();
    if (kernelConnection === connection) {
      kernelConnection = null;
      kernelSubscription = null;
      provider = null;
      lumine.commands.invalidateAvailability();
      explorerStore.reset();
      destroyPane();
    }
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
    canReplaceItem: () => false,
    getAdapterForItem(item) {
      return handlesItem(item) ? explorerStore.getSearchAdapter() : null;
    },
  };
}

function getExplorerPane() {
  initialize();
  if (!pane) {
    require("@lumine-code/etch").setScheduler(lumine.views);
    const ExplorerPane = require("./explorer-pane");
    const created = new ExplorerPane();
    created.onDidDestroy(() => {
      if (pane === created) {
        pane = null;
      }
    });
    pane = created;
  }
  return pane;
}

function destroyPane() {
  pane?.destroy();
  pane = null;
}

function deserializeExplorerPane() {
  return getExplorerPane();
}

function warn(description) {
  lumine.notifications.addWarning("jupyter-explorer", { description });
}

/**
 * Explore whatever the cursor is on. The expression comes from the provider
 * rather than being parsed here, so it is the same one the REPL would run.
 */
function hasPythonKernel(target) {
  const state = provider?.peekKernelState?.(target);
  return Boolean(
    state &&
    state.language?.toLowerCase() === "python" &&
    !["loading", "recovering", "unresponsive", "restarting", "shutting-down"].includes(
      state.connectionState,
    ),
  );
}

function canExplore(event) {
  const editor = lumine.workspace.getTextEditorForElement(event?.target, { includeMini: false });
  return Boolean(
    editor &&
    context &&
    hasPythonKernel({ item: event.context?.item ?? editor, editor, window: event.context?.window }),
  );
}

async function explore(event) {
  if (!provider) {
    warn("Waiting for `jupyter-repl` to provide a kernel.");
    return;
  }

  const editor = lumine.workspace.getTextEditorForElement(event?.target, { includeMini: false });
  if (!editor) return;
  const kernel = provider.getKernelForEditor(editor);
  if (!kernel) {
    warn("No running kernel for the current file.");
    return;
  }
  if (!kernel.language || kernel.language.toLowerCase() !== "python") {
    warn("jupyter-explorer only works with Python kernels.");
    return;
  }

  const expression = context?.getExpressionAtCursor(editor) || "";
  if (!expression) {
    warn("Select an expression or place the cursor on a variable to explore.");
    return;
  }

  await load(kernel, expression);
}

/**
 * Show an expression, opening the panel if it is not open yet. This is the
 * entry point another package uses — `jupyter-variables` calls it to
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

function dataFileTarget(event) {
  const context = event?.context;
  return context
    ? {
        item: context.documentItem ?? null,
        editor: context.embeddedEditor ?? context.editor ?? null,
        window: context.window,
      }
    : {
        item: lumine.workspace.getActivePaneItem(),
        editor: lumine.workspace.getActiveEmbeddedTextEditor(),
        window: lumine.workspace.getMainWindow(),
      };
}

function openDataFileForEvent(event) {
  const target = dataFileTarget(event);
  const kernel = target.item
    ? provider?.getKernelForItem?.(target.item)
    : target.editor
      ? provider?.getKernelForEditor?.(target.editor)
      : null;
  if (!kernel) return;
  return openDataFile(kernel, null, target.window);
}

async function openDataFile(kernel = null, filePath = null, window = null) {
  const generation = lifecycleGeneration;
  kernel ??= provider?.getActiveKernel();
  if (!kernel || kernel.language?.toLowerCase() !== "python") {
    warn(
      "Start a Python kernel before opening a data file. Install pyarrow in that kernel's environment.",
    );
    return;
  }
  if (!filePath) {
    const result = await (window ?? lumine.window).showOpenDialog({
      title: "Open Data File",
      properties: ["openFile"],
      filters: [{ name: "Columnar Data", extensions: ["parquet", "feather", "arrow", "ipc"] }],
    });
    filePath = result.filePaths?.[0];
  }
  if (!filePath || generation !== lifecycleGeneration || kernel.destroyed) return;
  return load(kernel, fileExpression(filePath));
}

async function open() {
  const generation = lifecycleGeneration;
  // Opening an empty panel picks up whatever context is there — the kernel of
  // the active editor, and the expression under its cursor when one exists —
  // because that is what the single command did before the split, and a panel
  // with a kernel bound has a working expression editor. Unlike explore(),
  // nothing here warns: open is allowed to open empty.
  if (!explorerStore.kernel && provider) {
    const kernel = provider.getActiveKernel();
    if (kernel && kernel.language && kernel.language.toLowerCase() === "python") {
      const expression = context?.getExpressionAtCursor(context.getFocusedEditor()) || "";
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
  if (generation !== lifecycleGeneration) return;
  item?.focusExpression?.();
  return item;
}

/**
 * The `jupyter.explorer` service.
 * @returns {Object}
 */
function provideExplorer() {
  const generation = lifecycleGeneration;
  return {
    explore: async (kernel, expression) =>
      generation === lifecycleGeneration ? load(kernel, expression) : undefined,
    openFile: async (kernel, filePath) =>
      generation === lifecycleGeneration ? openDataFile(kernel, filePath) : undefined,
  };
}

module.exports = {
  provideBackgroundTips() {
    return {
      packageName: "jupyter-explorer",
      tips: [
        "You can explore whatever the cursor is on with {{ 'jupyter-explorer:explore' | keystroke }}",
      ],
    };
  },

  initialize,
  activate,
  deactivate,
  deserializeExplorerPane,
  consumeJupyterKernel,
  consumeJupyterContext,
  consumeAutocompleteWatchEditor,
  provideSearchAdapter,
  provideExplorer,
  EXPLORER_URI,
};
