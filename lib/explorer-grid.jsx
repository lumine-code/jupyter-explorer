/** @jsx etch.dom */
const etch = require("@lumine-code/etch");
const { CanvasGrid } = require("@lumine-code/canvas-grid");

function normalizeRestoreState(state) {
  if (!state) return null;
  if (state.selection || state.selectionMode) return state;
  return {
    selection: state.sel || null,
    selections: state.selections || [],
    selectionMode: state.selMode === "col" ? "column" : state.selMode || "cell",
    scrollTop: state.scrollTop || 0,
    scrollLeft: state.scrollLeft || 0,
  };
}

class ExplorerCanvasGrid {
  constructor(props) {
    this.props = props;
    this.wrapRef = { current: null };
    etch.initialize(this);
    this.mountGrid();
  }

  mountGrid() {
    this.grid = new CanvasGrid(this.gridOptions());
    this.wrapRef.current = this.grid.element;
    this.element.appendChild(this.grid.element);
    this.applyDecorations();
    if (this.props.restoreState) {
      this.restoreState(this.props.restoreState);
      this.props.onRestored?.();
    } else if (this.props.selectedRow != null) {
      this.grid.scrollRowIntoView(this.props.selectedRow);
    }
  }

  gridOptions() {
    const payload = this.props.payload;
    return {
      className: "explorer-canvas-wrap",
      commandPrefix: "jupyter-explorer",
      ariaLabel: "Data explorer grid",
      columns: payload.columns.map((label, index) => ({ key: index, label })),
      rows: payload.rows,
      clipboard: lumine.clipboard,
      formatRowHeader: ({ windowRow }) => (payload.index ? payload.index[windowRow] : windowRow),
      onSelectionChange: () => {
        if (this.props.selectedRow != null) this.props.onClearSelected?.();
      },
      onConfirm: ({ windowRow }) => this.drillRow(windowRow),
      onError: (error) =>
        lumine.notifications.addError("Data Explorer grid failed", {
          description: error.message,
          dismissable: true,
        }),
    };
  }

  update(props) {
    const previous = this.props;
    this.props = props;
    if (previous.payload !== props.payload) {
      this.grid.options.formatRowHeader = ({ windowRow }) =>
        props.payload.index ? props.payload.index[windowRow] : windowRow;
      this.grid.setRows({
        columns: props.payload.columns.map((label, index) => ({ key: index, label })),
        rows: props.payload.rows,
      });
      if (props.restoreState) {
        this.restoreState(props.restoreState);
        props.onRestored?.();
      }
    }
    this.applyDecorations();
    if (previous.selectedRow !== props.selectedRow && props.selectedRow != null) {
      this.grid.scrollRowIntoView(props.selectedRow);
    }
    return Promise.resolve();
  }

  applyDecorations() {
    const matches = this.props.searchMatches || [];
    const current =
      this.props.searchCurrentIndex >= 0 ? matches[this.props.searchCurrentIndex] : null;
    this.grid.setHighlights(matches, current);
    this.grid.setHighlightRow(this.props.selectedRow);
  }

  drillRow(row) {
    const metadata = this.props.navMeta?.[row];
    if (metadata?.expandable) this.props.onDrill?.(row, this.captureState());
  }

  focus() {
    this.grid.focus();
  }

  hasSelection() {
    return Boolean(this.grid.selection);
  }

  activeCell() {
    const { row, column } = this.grid.activeCell();
    return { r: row, c: column };
  }

  revealSearchMatch(cell) {
    this.grid.revealCell(cell);
    this.applyDecorations();
  }

  selectCells(cells) {
    this.grid.selectCells(cells);
    this.applyDecorations();
  }

  copySelection() {
    return this.grid.copySelection();
  }

  captureState() {
    const state = this.grid.captureState();
    return {
      sel: state.selection,
      selections: state.selections,
      selMode: state.selectionMode === "column" ? "col" : state.selectionMode,
      scrollTop: state.scrollTop,
      scrollLeft: state.scrollLeft,
    };
  }

  restoreState(state) {
    this.grid.restoreState(normalizeRestoreState(state));
  }

  destroy() {
    this.wrapRef.current = null;
    this.grid?.destroy();
    return etch.destroy(this);
  }

  render() {
    return <div className="explorer-canvas-host" />;
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
      selectedRow={store.selectedRow}
      searchMatches={store.searchMatches}
      searchCurrentIndex={store.searchCurrentIndex}
      onClearSelected={() => store.setSelectedRow(null)}
    />
  );
}

module.exports = { ExplorerCanvasGrid, renderExplorerGrid };
