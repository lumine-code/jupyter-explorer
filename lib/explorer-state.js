let explorerStore = null;

function getExplorerStore() {
  return explorerStore ?? require("./explorer-store").explorerStore;
}

function peekExplorerStore() {
  return explorerStore;
}

function setExplorerStore(store) {
  explorerStore = store;
}

module.exports = { getExplorerStore, peekExplorerStore, setExplorerStore };
