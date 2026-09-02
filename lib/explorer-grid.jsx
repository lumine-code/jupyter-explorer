/** @jsx etch.dom */
const etch = require("@lumine-code/etch");
const { CanvasGrid } = require("@lumine-code/canvas-grid");

function columnsForPayload(payload) {
  return payload.columns.map((label, index) => ({ key: index, label }));
}

function rowHeaderFormatter(payload) {
  return ({ windowRow }) => (payload.index ? payload.index[windowRow] : windowRow);
}

function callbacks(props, grid = null) {
  return {
    formatRowHeader: rowHeaderFormatter(props.payload),
    onSelectionChange: (...args) => {
      if (props.selectedRow != null) props.onClearSelected?.();
      props.onSelectionChange?.(...args);
    },
    onConfirm: ({ windowRow }) => {
      const metadata = props.navMeta?.[windowRow];
      if (metadata?.expandable) props.onDrill?.(windowRow, grid?.captureState() || null);
    },
    onSort: props.onSort,
    onError: (error) =>
      lumine.notifications.addError("Data Explorer grid failed", {
        description: error.message,
        dismissable: true,
      }),
  };
}

function gridOptions(props) {
  return {
    className: "explorer-canvas-wrap",
    commandPrefix: "jupyter-explorer",
    ariaLabel: "Data explorer grid",
    columns: columnsForPayload(props.payload),
    rows: props.payload.rows,
    copyRows: false,
    clipboard: lumine.clipboard,
    ...callbacks(props),
  };
}

/**
 * Etch-compatible mapping between explorer payloads and the host-neutral grid.
 * CanvasGrid remains the sole owner of DOM, selection, scrolling, and teardown.
 */
class ExplorerCanvasGrid extends CanvasGrid {
  constructor(props) {
    super(gridOptions(props));
    this.props = props;
    this.consumedRestoreState = null;
    this.updateOptions(callbacks(props, this));
    this.applyExternalState(null);
  }

  update(props) {
    const previous = this.props;
    this.props = props;
    this.updateOptions(callbacks(props, this));

    if (previous.payload !== props.payload) {
      this.setRows({
        columns: columnsForPayload(props.payload),
        rows: props.payload.rows,
      });
    }
    this.applyDecorations();
    this.applyExternalState(previous);
    return Promise.resolve();
  }

  applyDecorations() {
    const matches = this.props.searchMatches || [];
    const current =
      this.props.searchCurrentIndex >= 0 ? matches[this.props.searchCurrentIndex] : null;
    this.setHighlights(matches, current);
    this.setHighlightRow(this.props.selectedRow);
  }

  applyExternalState(previous) {
    const restoreState = this.props.restoreState;
    if (!restoreState) this.consumedRestoreState = null;
    if (restoreState && restoreState !== this.consumedRestoreState) {
      this.consumedRestoreState = restoreState;
      this.restoreState(restoreState);
      this.props.onRestored?.();
      return;
    }
    if (
      this.props.selectedRow != null &&
      (!previous || previous.selectedRow !== this.props.selectedRow)
    ) {
      this.scrollRowIntoView(this.props.selectedRow);
    }
  }

  destroy() {
    const props = this.props;
    this.props = null;
    props?.onDestroy?.(this);
    super.destroy();
    return Promise.resolve();
  }
}

function renderExplorerGrid(store) {
  const payload = store.payload;
  if (!payload) return null;
  if (!Array.isArray(payload.rows) || !Array.isArray(payload.columns)) {
    return (
      <div className="explorer-scalar native-key-bindings" tabIndex={0}>
        <pre>{payload.repr || "No tabular representation"}</pre>
      </div>
    );
  }
  return (
    <ExplorerCanvasGrid
      ref={store.setActiveGrid}
      payload={payload}
      navMeta={payload.navmeta}
      onDrill={(row, state) => store.drillInto(row, state)}
      restoreState={store.pendingRestore}
      onRestored={() => store.clearPendingRestore()}
      onDestroy={(grid) => {
        if (store.activeGrid === grid) store.setActiveGrid(null);
      }}
      selectedRow={store.selectedRow}
      searchMatches={store.searchMatches}
      searchCurrentIndex={store.searchCurrentIndex}
      onClearSelected={() => store.setSelectedRow(null)}
    />
  );
}

module.exports = { ExplorerCanvasGrid, gridOptions, renderExplorerGrid };
