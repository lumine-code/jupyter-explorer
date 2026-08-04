const etch = require("@lumine-code/etch");
const { INDEX_COLUMN } = require("./explorer-store");
const { renderExplorerGrid } = require("./explorer-grid");
const { autocompleteConsumer: AutocompleteConsumer } = require("./autocomplete");

// View modes, inspired by the nteract explorer's view toolbar. "grid" and
// "summary" are tabular; the rest are Plotly charts.
const VIEWS = [
  { id: "grid", label: "Grid", icon: "icon-list-unordered" },
  { id: "line", label: "Line", icon: "icon-graph" },
  { id: "scatter", label: "Scatter", icon: "icon-primitive-dot" },
  { id: "heatmap", label: "Heatmap", icon: "icon-server" },
];

// Per-view control spec. `x`/`y`/`z` are single-select axes (z optional -> 3D),
// `color` is a categorical group-by, `metrics` is a multi-select used only by
// parallel coordinates. Labels override the default control titles.
const VIEW_SPEC = {
  scatter: { x: true, y: true, z: true, color: true },
  line: { x: true, y: true, z: true, color: true },
  bar: { x: true, y: true, color: true },
  area: { x: true, y: true, color: true },
  histogram: { y: true, color: true, yLabel: "Value" },
  box: { x: true, xOptional: true, xLabel: "Group", y: true, yLabel: "Value", color: true },
  heatmap: { x: true, y: true },
  parallel: { metrics: true },
};

/**
 * In-flow message used inside the body (below the controls). Unlike
 * `background-tips`/`.centered`, this does not absolutely position itself, so it
 * never overlaps the header controls.
 */
function renderMessage(children) {
  return <div className="explorer-message">{children}</div>;
}

function clearExpressionOrAbortMultiCursor(editor, onChange, event) {
  if ((editor.getCursors?.().length || 0) > 1 || (editor.getSelections?.().length || 0) > 1) {
    event?.abortKeyBinding?.();
    return;
  }
  editor.setText("");
  onChange("");
}

function formatCell(value) {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "number") {
    return String(value);
  }
  return String(value);
}

// Small footer note shown when the kernel capped the number of fetched rows.
function renderGridFooter({ store }) {
  const payload = store.payload;
  if (!payload || !payload.truncated) {
    return null;
  }
  return (
    <div className="explorer-pager">
      <span className="output-truncated">
        showing first {payload.rows.length} of {payload.total_rows} rows
      </span>
    </div>
  );
}

function toNum(v) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

// Coerce an axis range bound to a number (date strings -> ms) so a range can be
// scaled around its center.
function toMs(v) {
  if (typeof v === "number") {
    return v;
  }
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? Number(v) : t;
}

function colValues(payload, col) {
  if (col === INDEX_COLUMN) {
    return payload.index || [];
  }
  const i = payload.columns.indexOf(col);
  return payload.rows.map((row) => row[i]);
}

// Values for a numeric value-axis: coerce so numeric-as-text columns (common in
// object-dtype DataFrame columns) still plot; non-numeric cells become gaps.
function numValues(payload, col) {
  return colValues(payload, col).map(toNum);
}

// True when the array has finite numbers spanning a non-zero range, i.e. it can
// be binned. histogram2d produces NaN image dimensions otherwise.
function hasNumericRange(arr) {
  let min = Infinity;
  let max = -Infinity;
  for (const v of arr) {
    if (v !== null && Number.isFinite(v)) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  return max > min;
}

function pick(arr, indices) {
  return indices.map((i) => arr[i]);
}

// Original row index for each row, attached to traces as customdata so a clicked
// point can be mapped back to its grid row.
function rowIndices(payload) {
  return payload.rows.map((_, i) => i);
}

// Group row indices by the (stringified) value of a categorical column.
function groupByColor(payload, colorCol) {
  const vals = colValues(payload, colorCol);
  const groups = new Map();
  vals.forEach((v, i) => {
    const key = v === null || v === undefined ? "(null)" : String(v);
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(i);
  });
  return [...groups.entries()].map(([key, indices]) => ({ key, indices }));
}

const BASE_LAYOUT = {
  autosize: true,
  margin: { l: 50, r: 20, t: 30, b: 40 },
  showlegend: false,
  font: { color: "#9da5b4" },
  paper_bgcolor: "rgba(0,0,0,0)",
  plot_bgcolor: "rgba(0,0,0,0)",
  xaxis: {},
  yaxis: {},
};

// Is this a 3D plot? Only scatter / line with a Z axis selected.
function is3D(view, zColumn) {
  return (view === "scatter" || view === "line") && Boolean(zColumn);
}

function axisTitle(col) {
  return col === INDEX_COLUMN ? "index" : col;
}

function buildFigure(payload, view, axes) {
  const { x, y, z, color, metrics } = axes;

  if (view === "heatmap") {
    // 2D density of the two selected columns. Bail out on degenerate data
    // (no finite values or zero range) which would make Plotly compute NaN bins.
    const xs = numValues(payload, x);
    const ys = numValues(payload, y);
    if (!hasNumericRange(xs) || !hasNumericRange(ys)) {
      return null;
    }
    return {
      data: [{ type: "histogram2d", x: xs, y: ys, colorscale: "YlOrRd" }],
      layout: {
        ...BASE_LAYOUT,
        showlegend: false,
        xaxis: { title: axisTitle(x) },
        yaxis: { title: axisTitle(y) },
      },
    };
  }

  if (view === "parallel") {
    const dimensions = metrics.map((c) => ({
      label: c,
      values: colValues(payload, c).map(toNum),
    }));
    return {
      data: [{ type: "parcoords", dimensions }],
      layout: { ...BASE_LAYOUT, showlegend: false },
    };
  }

  if (view === "histogram") {
    const data = [];
    const yv = numValues(payload, y);
    if (color) {
      for (const g of groupByColor(payload, color)) {
        data.push({ type: "histogram", x: pick(yv, g.indices), name: g.key, opacity: 0.7 });
      }
    } else {
      data.push({ type: "histogram", x: yv });
    }
    return {
      data,
      layout: { ...BASE_LAYOUT, barmode: "overlay", xaxis: { title: axisTitle(y) } },
    };
  }

  if (view === "box") {
    const yv = numValues(payload, y);
    const groupX = x && x !== INDEX_COLUMN ? colValues(payload, x).map(String) : null;
    const data = [];
    if (color) {
      for (const g of groupByColor(payload, color)) {
        data.push({
          type: "box",
          y: pick(yv, g.indices),
          x: groupX ? pick(groupX, g.indices) : undefined,
          name: g.key,
        });
      }
    } else {
      data.push({ type: "box", y: yv, x: groupX || undefined, name: axisTitle(y) });
    }
    return { data, layout: { ...BASE_LAYOUT, boxmode: "group" } };
  }

  // scatter / line / bar / area. Y is always a numeric value axis; X stays raw
  // in 2D so categorical / datetime axes work, but is numeric in 3D space.
  const yVals = numValues(payload, y);

  if (is3D(view, z)) {
    const xVals = numValues(payload, x);
    const zVals = numValues(payload, z);
    const base = {
      type: "scatter3d",
      mode: view === "line" ? "lines" : "markers",
      marker: { size: 3 },
    };
    const data = [];
    if (color) {
      for (const g of groupByColor(payload, color)) {
        data.push({
          ...base,
          x: pick(xVals, g.indices),
          y: pick(yVals, g.indices),
          z: pick(zVals, g.indices),
          customdata: g.indices,
          name: g.key,
        });
      }
    } else {
      data.push({ ...base, x: xVals, y: yVals, z: zVals, customdata: rowIndices(payload) });
    }
    return {
      data,
      layout: {
        ...BASE_LAYOUT,
        scene: {
          dragmode: "turntable",
          xaxis: { title: axisTitle(x) },
          yaxis: { title: axisTitle(y) },
          zaxis: { title: axisTitle(z) },
        },
      },
    };
  }

  const xVals = colValues(payload, x);
  const base = {
    line: { type: "scatter", mode: "lines" },
    scatter: { type: "scatter", mode: "markers" },
    bar: { type: "bar" },
    area: { type: "scatter", mode: "lines", stackgroup: "one" },
  }[view];

  const data = [];
  if (color) {
    for (const g of groupByColor(payload, color)) {
      data.push({
        ...base,
        x: pick(xVals, g.indices),
        y: pick(yVals, g.indices),
        customdata: g.indices,
        name: g.key,
      });
    }
  } else {
    data.push({ ...base, x: xVals, y: yVals, customdata: rowIndices(payload), name: axisTitle(y) });
  }

  const extra = view === "bar" ? { barmode: "group" } : {};
  return {
    data,
    layout: {
      ...BASE_LAYOUT,
      ...extra,
      xaxis: { title: axisTitle(x) },
      yaxis: { title: axisTitle(y) },
    },
  };
}

/**
 * Plotly chart that fills its container and resizes with it. Unlike the shared
 * PlotlyTransform (used by inline outputs with a fixed min-height), this is meant
 * to occupy the full Data Explorer panel, so it sets width/height 100% and uses a
 * ResizeObserver to keep the plot sized to the pane.
 */
class ResponsivePlot {
  // Plotly throws on some degenerate figures. React had an error boundary above
  // this component; without one, the failure is caught where it happens and
  // reported in place of the chart.
  error = null;

  constructor(props) {
    this.props = props;
    etch.initialize(this);
    this.didMount();
  }

  // Plotly uses the right mouse button to orbit 3D plots, so the browser context
  // menu must be suppressed. A native capture-phase listener is used because
  // Plotly's inner DOM (incl. the WebGL canvas) doesn't reliably reach React's
  // delegated onContextMenu handler.
  preventContextMenu = (e) => {
    e.preventDefault();
    // Stop propagation so the editor's document-level context-menu manager doesn't show
    // its menu either (preventDefault only blocks the native browser menu).
    e.stopPropagation();
    e.stopImmediatePropagation();
  };

  // Stretch (+, factor < 1) or compress (−, factor > 1) one axis by scaling its
  // range around its center.
  stretchAxis = (axisKey, factor) => {
    const gd = this.refs.container;
    if (!gd || !gd._fullLayout || !this.Plotly) {
      return;
    }
    const layout = this.props.is3D ? gd._fullLayout.scene : gd._fullLayout;
    const axis = layout && layout[axisKey];
    if (!axis || !axis.range) {
      return;
    }
    const a = toMs(axis.range[0]);
    const b = toMs(axis.range[1]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) {
      return;
    }
    const center = (a + b) / 2;
    const half = ((b - a) / 2) * factor;
    const path = this.props.is3D ? `scene.${axisKey}.range` : `${axisKey}.range`;
    this.Plotly.relayout(gd, { [path]: [center - half, center + half] });
  };

  downloadImage = (gd) => {
    this.Plotly.toImage(gd).then((dataUrl) => {
      const remote = require(
        require("path").join(
          atom.getLoadSettings().resourcePath,
          "node_modules",
          "@electron/remote",
        ),
      );
      remote.getCurrentWebContents().downloadURL(dataUrl);
    });
  };

  // Draw only once the container has a real size. Plotly throws (e.g.
  // createImageData with zero width) if it renders into a 0-sized element, which
  // happens when the pane/plot is laid out but not yet visible.
  tryDraw() {
    const gd = this.refs.container;
    if (!gd || !this.Plotly || gd.clientWidth === 0 || gd.clientHeight === 0) {
      return;
    }
    if (this._drawn) {
      this.draw("react");
    } else {
      this.draw("newPlot");
      this._drawn = true;
      gd.on("plotly_click", this.handlePlotClick);
    }
  }

  draw(method) {
    const { data, layout } = this.props.figure;
    this.Plotly[method](this.refs.container, data, layout, {
      responsive: true,
      displaylogo: false,
      scrollZoom: true,
      modeBarButtonsToRemove: ["toImage"],
      modeBarButtonsToAdd: [
        {
          name: "Download plot as a png",
          icon: this.Plotly.Icons.camera,
          click: this.downloadImage,
        },
      ],
    });
  }

  // Right-drag pans 2D plots (matching the right-button move on 3D, which Plotly
  // handles natively). Converts pixel movement to axis-range shifts.
  handleMouseDown = (e) => {
    if (e.button !== 2 || this.props.is3D) {
      return;
    }
    const fl = this.refs.container && this.refs.container._fullLayout;
    if (!fl || !fl.xaxis || !fl.yaxis || !fl.xaxis.range || !fl.yaxis.range) {
      return;
    }
    this._pan = {
      startX: e.clientX,
      startY: e.clientY,
      xRange: fl.xaxis.range.map(toMs),
      yRange: fl.yaxis.range.map(toMs),
      xLen: fl.xaxis._length,
      yLen: fl.yaxis._length,
    };
    // Stop Plotly's own drag layer from seeing this (otherwise it box-zooms on
    // release). Capture phase + stopPropagation keeps it from starting a drag.
    e.preventDefault();
    e.stopPropagation();
    window.addEventListener("mousemove", this.handleMouseMove);
    window.addEventListener("mouseup", this.handleMouseUp);
  };

  handleMouseMove = (e) => {
    const p = this._pan;
    const gd = this.refs.container;
    if (!p || !gd || !this.Plotly) {
      return;
    }
    const dx = ((e.clientX - p.startX) / p.xLen) * (p.xRange[1] - p.xRange[0]);
    const dy = ((e.clientY - p.startY) / p.yLen) * (p.yRange[1] - p.yRange[0]);
    this.Plotly.relayout(gd, {
      "xaxis.range": [p.xRange[0] - dx, p.xRange[1] - dx],
      "yaxis.range": [p.yRange[0] + dy, p.yRange[1] + dy],
    });
  };

  handleMouseUp = () => {
    this._pan = null;
    window.removeEventListener("mousemove", this.handleMouseMove);
    window.removeEventListener("mouseup", this.handleMouseUp);
  };

  // Escape clears any active box/lasso selection (un-dims all points).
  handleKeyDown = (e) => {
    if (e.key !== "Escape") {
      return;
    }
    const gd = this.refs.container;
    if (gd && this.Plotly) {
      this.Plotly.restyle(gd, { selectedpoints: [null] });
    }
  };

  // A clicked point carries its original row index in customdata; report it so
  // the grid can jump to that row.
  handlePlotClick = (event) => {
    const point = event && event.points && event.points[0];
    if (!point || point.customdata == null) {
      return;
    }
    if (this.props.onPointClick) {
      this.props.onPointClick(point.customdata);
    }
  };

  didMount() {
    this.Plotly = require("plotly.js-dist");
    this.refs.container.addEventListener("contextmenu", this.preventContextMenu, true);
    this.refs.container.addEventListener("mousedown", this.handleMouseDown, true);
    document.addEventListener("keydown", this.handleKeyDown);
    this.resizeObserver = new ResizeObserver(() => {
      const gd = this.refs.container;
      if (!gd) {
        return;
      }
      // Draw lazily once the container has a real size, then just resize.
      if (!this._drawn) {
        this.tryDraw();
      } else if (gd.clientWidth > 0 && gd.clientHeight > 0) {
        this.Plotly.Plots.resize(gd);
      }
    });
    this.resizeObserver.observe(this.refs.container);
    this.tryDraw();
  }

  update(props) {
    const previous = this.props;
    this.props = props;
    if (previous.figure !== props.figure) {
      this.error = null;
      return etch.update(this).then(() => this.tryDraw());
    }
    return etch.update(this);
  }

  destroy() {
    this.teardown();
    return etch.destroy(this);
  }

  teardown() {
    document.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("mousemove", this.handleMouseMove);
    window.removeEventListener("mouseup", this.handleMouseUp);
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
    if (this.refs.container) {
      this.refs.container.removeEventListener("contextmenu", this.preventContextMenu, true);
      this.refs.container.removeEventListener("mousedown", this.handleMouseDown, true);
    }
    if (this._drawn && this.Plotly && this.refs.container) {
      this.Plotly.purge(this.refs.container);
    }
  }

  render() {
    if (this.error) {
      return renderMessage("Could not render this plot. Try different axes or another view.");
    }
    return <div ref="container" className="explorer-plotly" />;
  }
}

// Single-select axis dropdown. `optional` adds a "(none)" entry. When `axisKey`
// + `onStretch` are given, the label also carries −/+ buttons that stretch /
// compress that plot axis.
function renderAxisSelect({ label, value, options, optional, onChange, axisKey, onStretch }) {
  return (
    <div className="explorer-control">
      <span className="explorer-control-label">{label}</span>
      <div className="explorer-axis-group">
        {onStretch ? (
          <>
            <button
              type="button"
              className="btn"
              title={`Compress ${label} axis`}
              onClick={() => onStretch(axisKey, 1.25)}
            >
              −
            </button>
            <button
              type="button"
              className="btn"
              title={`Stretch ${label} axis`}
              onClick={() => onStretch(axisKey, 0.8)}
            >
              +
            </button>
          </>
        ) : null}
        <select
          className="input-select"
          value={value || ""}
          onChange={(e) => onChange(e.target.value)}
        >
          {optional ? <option value="">(none)</option> : null}
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

function renderChartControls({ store, view, onStretch }) {
  const payload = store.payload;
  const spec = VIEW_SPEC[view] || {};
  const numeric = payload.numeric_columns || [];
  const categorical = payload.columns.filter((c) => !numeric.includes(c));

  const columnOptions = payload.columns.map((c) => ({ value: c, label: c }));
  const allOptions = [{ value: INDEX_COLUMN, label: "(index)" }, ...columnOptions];
  const categoricalOptions = categorical.map((c) => ({ value: c, label: c }));

  return (
    <div className="explorer-plot-controls">
      {spec.x
        ? renderAxisSelect({
            label: spec.xLabel || "X",
            value: store.xColumn,
            options: allOptions,
            optional: spec.xOptional,
            onChange: store.setXColumn,
            axisKey: "xaxis",
            onStretch: onStretch,
          })
        : null}

      {spec.y
        ? renderAxisSelect({
            label: spec.yLabel || "Y",
            value: store.yColumn,
            options: columnOptions,
            onChange: store.setYColumn,
            axisKey: "yaxis",
            onStretch: onStretch,
          })
        : null}

      {spec.z
        ? renderAxisSelect({
            label: "Z",
            value: store.zColumn,
            options: columnOptions,
            optional: true,
            onChange: store.setZColumn,
            axisKey: "zaxis",
            onStretch: onStretch,
          })
        : null}

      {spec.color && categorical.length > 0
        ? renderAxisSelect({
            label: "Color",
            value: store.colorColumn,
            options: categoricalOptions,
            optional: true,
            onChange: store.setColorColumn,
          })
        : null}

      {spec.metrics ? (
        <div className="explorer-control explorer-ycols">
          <span>Dimensions</span>
          <div className="explorer-ycol-list">
            {numeric.map((col) => (
              <label key={col} className="input-label">
                <input
                  className="input-checkbox"
                  type="checkbox"
                  checked={store.yColumns.includes(col)}
                  onChange={() => store.toggleYColumn(col)}
                />
                <span>{col}</span>
              </label>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// The plot body only; axis controls live in the header (ChartControls).
function renderChartPlot({ store, view, plotRef, onPointClick }) {
  const payload = store.payload;
  if (!payload || !Array.isArray(payload.columns) || payload.columns.length === 0) {
    return renderMessage("No columns available to plot");
  }

  const spec = VIEW_SPEC[view] || {};
  const numeric = payload.numeric_columns || [];
  // Parallel coordinates can only use the auto-detected numeric columns.
  if (view === "parallel" && numeric.length === 0) {
    return renderMessage("No numeric columns available for this view");
  }

  const axes = {
    x: store.xColumn,
    y: store.yColumn,
    z: store.zColumn,
    color: store.colorColumn,
    metrics: store.yColumns,
  };

  // Readiness: views that need a Y axis require it; parallel needs >=1 metric.
  const ready = spec.metrics ? store.yColumns.length > 0 : !spec.y || Boolean(store.yColumn);
  const figure = ready ? buildFigure(payload, view, axes) : null;

  // Remount Plotly when the chart type or its dimensionality changes so 2D<->3D
  // switches do a clean newPlot instead of a redraw with stale axes.
  const threeD = is3D(view, store.zColumn);
  const plotKey = `${view}-${threeD ? "3d" : "2d"}`;

  return (
    <div className="explorer-plot" tabIndex={0}>
      <div className="explorer-plot-area">
        {figure ? (
          <ResponsivePlot
            ref={plotRef}
            key={plotKey}
            figure={figure}
            is3D={threeD}
            onPointClick={onPointClick}
          />
        ) : ready ? (
          renderMessage("Not enough numeric data to plot the selected axes")
        ) : (
          renderMessage("Select the axes to plot")
        )}
      </div>
    </div>
  );
}

function renderSummaryView({ store }) {
  const summary = store.payload && store.payload.summary;
  if (!summary || !Array.isArray(summary.rows)) {
    return renderMessage("No summary statistics available for this data");
  }
  return (
    <div className="explorer-table-wrapper native-key-bindings" tabIndex={0}>
      <table className="explorer-table">
        <thead>
          <tr>
            <th className="explorer-index-head"></th>
            {summary.stats.map((s, i) => (
              <th key={i}>{s}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {summary.rows.map((row, r) => (
            <tr key={r}>
              <td className="explorer-index-cell">{summary.index[r]}</td>
              {row.map((cell, c) => (
                <td key={c}>{formatCell(cell)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Drill-down trail. Each segment re-evaluates its stored expression; the last
// segment is the current level (non-clickable). Only shown once the user has
// drilled at least one level deep.
function renderBreadcrumb({ store }) {
  const path = store.path;
  if (!Array.isArray(path) || path.length <= 1) {
    return null;
  }
  return (
    <div className="explorer-breadcrumb">
      {path.map((segment, i) => (
        <>
          {i > 0 ? <span className="explorer-breadcrumb-sep">›</span> : null}
          <button
            type="button"
            className="explorer-breadcrumb-item"
            disabled={i === path.length - 1}
            title={segment.expression}
            onClick={() => store.navigateTo(i)}
          >
            {segment.label}
          </button>
        </>
      ))}
    </div>
  );
}

function renderViewToolbar({ store }) {
  return (
    <div className="btn-group explorer-view-toggle">
      {VIEWS.map((v) => (
        <button
          key={v.id}
          className={`btn icon ${v.icon} ${store.viewMode === v.id ? "selected" : ""}`}
          onClick={() => store.setViewMode(v.id)}
        >
          {v.label}
        </button>
      ))}
    </div>
  );
}

function payloadMeta(payload) {
  const kind = payload.kind || "data";
  const details = [];

  if (payload.type) {
    details.push(payload.type);
  }
  if (Array.isArray(payload.shape)) {
    details.push(`shape ${payload.shape.join(" x ")}`);
  }
  if (payload.dtype) {
    details.push(`dtype ${payload.dtype}`);
  }
  if (payload.total_rows != null) {
    details.push(`${payload.total_rows} rows`);
  }
  if (payload.truncated) {
    details.push("truncated");
  }
  if (payload.repr && kind !== "scalar") {
    details.push(payload.repr);
  }

  return { kind, detail: details.join(" | ") };
}

function renderPayloadMeta({ store, view }) {
  const payload = store.payload;
  if (!payload || view !== "grid") {
    return null;
  }
  const meta = payloadMeta(payload);
  return (
    <div className="explorer-object-meta">
      <span className="explorer-object-type">{meta.kind}</span>
      <span className="explorer-object-repr">{meta.detail}</span>
      {store.loading ? <span className="loading loading-spinner-tiny" /> : null}
    </div>
  );
}

/**
 * Multi-line expression editor, built the same way as the watch editor
 * (atom.workspace.buildTextEditor + assignLanguageMode, no textEditors.add which
 * would reset the grammar to plain text). Live edits update the stored
 * expression; Enter confirms / loads, Shift+Enter inserts a newline (keymaps).
 */
class ExpressionEditor {
  constructor(props) {
    this.props = props;
    etch.initialize(this);
    this.didMount();
  }

  didMount() {
    this.editor = atom.workspace.buildTextEditor({
      softWrapped: true,
      lineNumberGutterVisible: false,
      placeholderText: "Expression to load (e.g. df)",
    });
    this.editor.element.classList.add("explorer-expression");
    // A form control, not a document: the editor draws the shared input box.
    this.editor.element.setAttribute("input", "");
    if (this.props.grammar) {
      atom.grammars.assignLanguageMode(this.editor.getBuffer(), this.props.grammar.scopeName);
    }
    if (this.props.value) {
      this.editor.setText(this.props.value);
    }
    this.element.appendChild(this.editor.element);
    AutocompleteConsumer.watchPanelEditor(this.editor);
    this._changeDisposable = this.editor.onDidChange(() => {
      // Programmatic setText in update() must not echo back into the store:
      // the emit would re-enter the parent's patch that is applying the very
      // change being echoed.
      if (this._settingText) return;
      this.props.onChange(this.editor.getText());
    });
    this._commands = atom.commands.add(this.editor.element, {
      "core:confirm": () => this.props.onConfirm(this.editor.getText()),
      "core:cancel": (event) =>
        clearExpressionOrAbortMultiCursor(this.editor, this.props.onChange, event),
      "jupyter-explorer:focus-toolbar": () => this.props.onFocusToolbar?.(),
      "jupyter-explorer:focus-body": () => this.props.onFocusBody?.(),
    });
  }

  update(props) {
    this.props = props;
    if (this.editor && this.editor.getText() !== props.value) {
      this._settingText = true;
      try {
        this.editor.setText(props.value || "");
      } finally {
        this._settingText = false;
      }
    }
    return etch.update(this);
  }

  destroy() {
    this._changeDisposable?.dispose();
    this._commands?.dispose();
    this.editor?.destroy();
    return etch.destroy(this);
  }

  focus() {
    this.editor?.element?.focus();
  }

  render() {
    return <div className="explorer-expression-editor" />;
  }
}

class Explorer {
  constructor(props) {
    this.props = props;
    etch.initialize(this);
    this.didMount();
    this.storeSubscription = this.props.store.onDidUpdate(() => this.update());
  }

  didMount() {
    this._lastFocusToken = this.props.store.focusToken;
    this._bodyCommands = atom.commands.add(this.refs.body, {
      "jupyter-explorer:focus-expression": () => this.focusExpression(),
      "jupyter-explorer:focus-toolbar": () => this.focusToolbar(),
      "jupyter-explorer:drill-up": () => this.props.store.drillUp(),
    });
    this._toolbarCommands = atom.commands.add(this.refs.toolbar, {
      "jupyter-explorer:toolbar-left": (event) => this.focusToolbarItem(event, -1),
      "jupyter-explorer:toolbar-right": (event) => this.focusToolbarItem(event, 1),
      "jupyter-explorer:toolbar-confirm": (event) => this.confirmToolbarItem(event),
      "jupyter-explorer:focus-expression": () => this.focusExpression(),
      "jupyter-explorer:focus-body": () => this.focusBody(),
    });
  }

  // After a drill (Enter) / drill-up (Backspace), the new level replaces the
  // grid; once it has rendered (loading done, payload present) move focus back
  // to it so keyboard navigation continues without an extra click.
  update() {
    return etch.update(this).then(() => this.didUpdate());
  }

  didUpdate() {
    const store = this.props.store;
    if (store.focusToken !== this._lastFocusToken && !store.loading && store.payload) {
      this._lastFocusToken = store.focusToken;
      requestAnimationFrame(() => this.focusBody());
    }
  }

  destroy() {
    this.storeSubscription?.dispose();
    this._bodyCommands?.dispose();
    this._toolbarCommands?.dispose();
    return etch.destroy(this);
  }

  focusExpression = () => {
    this.refs.expression?.focus();
  };

  getToolbarItems() {
    const toolbar = this.refs.toolbar;
    if (!toolbar) {
      return [];
    }

    return Array.from(
      toolbar.querySelectorAll(
        "button:not([disabled]), select:not([disabled]), input:not([disabled])",
      ),
    ).filter((item) => item.offsetParent !== null);
  }

  focusToolbar = () => {
    const toolbar = this.refs.toolbar;
    if (!toolbar) {
      return;
    }

    const target =
      toolbar.querySelector(".explorer-view-toggle .btn.selected") ||
      this.getToolbarItems()[0] ||
      toolbar;
    target.focus?.({ preventScroll: true });
  };

  focusToolbarItem(event, direction) {
    event?.stopPropagation?.();
    const items = this.getToolbarItems();
    if (items.length === 0) {
      this.refs.toolbar?.focus({ preventScroll: true });
      return;
    }

    const active = document.activeElement;
    const currentIndex = items.indexOf(active);
    const nextIndex =
      currentIndex === -1
        ? direction > 0
          ? 0
          : items.length - 1
        : (currentIndex + direction + items.length) % items.length;
    items[nextIndex].focus({ preventScroll: true });
  }

  confirmToolbarItem(event) {
    event?.stopPropagation?.();
    const active = document.activeElement;
    if (!this.refs.toolbar?.contains(active)) {
      this.focusToolbar();
      return;
    }

    if (
      active instanceof HTMLButtonElement ||
      active instanceof HTMLSelectElement ||
      active instanceof HTMLInputElement
    ) {
      active.click();
    }
  }

  focusBody = () => {
    const body = this.refs.body;
    if (!body) {
      return;
    }

    const target =
      body.querySelector(".explorer-grid-view:not(.is-hidden) .explorer-canvas-wrap") ||
      body.querySelector(".explorer-grid-view:not(.is-hidden) .explorer-scalar") ||
      body.querySelector(".explorer-table-wrapper") ||
      body.querySelector(".explorer-plot") ||
      body;
    target.focus?.({ preventScroll: true });
  };

  handleStretch = (axisKey, factor) => {
    if (this.refs.plot) {
      this.refs.plot.stretchAxis(axisKey, factor);
    }
  };

  handlePointClick = (rowIndex) => {
    const store = this.props.store;
    store.setSelectedRow(rowIndex);
    store.setViewMode("grid");
  };

  renderBody(store, view, isChart) {
    // One message at most; rendered as a keyed sibling of the data slots
    // rather than replacing them. The body's child used to swap between this
    // fragment and a bare message div, and a fragment replaced by a non-
    // fragment and back corrupts etch's child bookkeeping — the second swap
    // died in insertBefore. The fragment is permanent now; only its keyed
    // children come and go.
    let message = null;
    if (store.loading && !store.payload) {
      // Only the very first load has nothing to show. A reload or a drill
      // keeps the current table on screen — swapping it for a loading screen
      // reads as a flicker when the kernel answers quickly; the toolbar
      // spinner is the loading cue instead.
      message = renderMessage("Loading...");
    } else if (store.error) {
      message = renderMessage(<span className="text-error">{store.error}</span>);
    } else if (!store.payload) {
      message = renderMessage([
        <div>No data loaded.</div>,
        <div className="text-subtle">
          Put the cursor on a variable (or select an expression) and run “jupyter-explorer:explore”,
          or use Variables.
        </div>,
      ]);
    }
    const hasData = !message;

    // The slot list is CONSTANT: three keyed divs that are always present and
    // hide via a class. Adding or removing a keyed child next to keyed
    // siblings — and swapping the whole fragment for a message div, which is
    // what this body did first — both corrupt etch's keyed diff and die in
    // insertBefore on a later update. Contents may come and go; slots do not.
    return (
      <>
        <div key="message" className={`explorer-message-view${message ? "" : " is-hidden"}`}>
          {message}
        </div>
        {/* Grid stays mounted and is just hidden when another view is
            active, so switching back doesn't rebuild the whole table. */}
        <div
          key="grid"
          className={`explorer-grid-view${hasData && view === "grid" ? "" : " is-hidden"}`}
        >
          {hasData ? renderExplorerGrid(store) : null}
          {hasData ? renderGridFooter({ store }) : null}
        </div>
        <div
          key="alt"
          className={`explorer-alt-view${hasData && (view === "summary" || isChart) ? "" : " is-hidden"}`}
        >
          {hasData && view === "summary" ? renderSummaryView({ store }) : null}
          {hasData && isChart
            ? renderChartPlot({
                store,
                view,
                plotRef: (component) => {
                  this.plot = component;
                },
                onPointClick: this.handlePointClick,
              })
            : null}
        </div>
      </>
    );
  }

  render() {
    // Singleton store, fed explicitly via the explorer command /
    // jupyter-variables. It is intentionally decoupled from jupyter-repl's
    // current-kernel tracking so switching the focused editor never re-renders
    // or reloads the panel.
    const store = this.props.store;
    const view = store.viewMode;
    const isChart = view !== "grid" && view !== "summary";
    const hasTable = store.payload && Array.isArray(store.payload.columns);

    return (
      <div className="explorer" tabIndex={-1}>
        <div className="explorer-controls">
          <div className="explorer-expression">
            <ExpressionEditor
              ref="expression"
              value={store.expression}
              onChange={store.setExpression}
              onConfirm={store.loadExpression}
              grammar={store.kernel && store.kernel.grammar}
              onFocusToolbar={this.focusToolbar}
              onFocusBody={this.focusBody}
            />
          </div>
          <div className="explorer-toolbar-row" ref="toolbar" tabIndex={0}>
            {renderViewToolbar({ store })}
            {renderBreadcrumb({ store })}
            {renderPayloadMeta({ store, view })}
            {isChart && hasTable
              ? renderChartControls({ store, view, onStretch: this.handleStretch })
              : null}
          </div>
        </div>

        <div className="explorer-body" ref="body" tabIndex={0}>
          {this.renderBody(store, view, isChart)}
        </div>
      </div>
    );
  }
}

module.exports = Explorer;
