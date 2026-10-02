const { Emitter } = require("lumine");
const { randomUUID } = require("node:crypto");
const ExplorerSearchAdapter = require("./explorer-search");
const { backendCode, requestCode, executeQuery, abortError } = require("./kernel-query");

const INDEX_COLUMN = "__index__";

/**
 * Build the Python code that serializes the given expression into a JSON
 * envelope on stdout. Mirrors the executeWatch + JSON.parse pattern used by the
 * Variable Explorer. The helper inspects the object, caps the number of rows /
 * columns, and coerces every cell to a JSON-safe scalar.
 */
function buildSerializerCode(expression, includeSummary = false, sessionId = null) {
  const exprLiteral = JSON.stringify(expression);
  return `${sessionId ? backendCode() : ""}
def _jupyter_explorer():
    import json, math, itertools
    MAX_ROWS = 1000
    MAX_COLS = 100
    INCLUDE_SUMMARY = ${includeSummary ? "True" : "False"}

    def _clean(v):
        try:
            import numpy as _np
            if isinstance(v, _np.generic):
                v = v.item()
        except Exception:
            pass
        if isinstance(v, bool):
            return v
        if isinstance(v, float):
            if math.isnan(v) or math.isinf(v):
                return None
            return v
        if v is None or isinstance(v, (int, str)):
            return v
        return str(v)

    _SCALAR = (type(None), bool, int, float, complex, str, bytes)

    def _expandable(v):
        # Can we drill into this value (does it hold inner structure)?
        if isinstance(v, _SCALAR):
            return False
        try:
            import numpy as _np
            if isinstance(v, _np.generic):
                return False
        except Exception:
            pass
        if isinstance(v, (list, tuple, set, frozenset, dict)):
            return len(v) > 0
        for b in type(v).__mro__:
            if getattr(b, "__name__", "") in ("DataFrame", "Series", "ndarray"):
                try:
                    return len(v) > 0
                except Exception:
                    return True
        try:
            return bool([n for n in dir(v) if not (n.startswith("__") and n.endswith("__"))])
        except Exception:
            return False

    def _key_accessor(k):
        # Subscript accessor "[<repr>]" that round-trips, for simple literal keys.
        if isinstance(k, _SCALAR):
            try:
                return "[%s]" % repr(k)
            except Exception:
                return None
        return None

    def _preview(v, limit=300):
        try:
            text = repr(v)
        except Exception as e:
            text = "<repr failed: %s>" % e
        text = text.replace("\\r", "\\\\r").replace("\\n", " ")
        if len(text) > limit:
            text = text[:limit - 1] + "..."
        return text

    def _doc_preview(v, limit=240):
        if v is None:
            return ""
        doc = getattr(v, "__doc__", None)
        if not doc:
            return ""
        text = " ".join(str(doc).strip().split())
        if len(text) > limit:
            text = text[:limit - 1] + "..."
        return text

    def _signature(v):
        try:
            import inspect
            return str(inspect.signature(v))
        except Exception:
            return ""

    def _member_category(static_value, runtime_value):
        try:
            import inspect
            if isinstance(static_value, property):
                return "property"
            if inspect.ismodule(runtime_value):
                return "module"
            if inspect.isclass(runtime_value):
                return "class"
            if inspect.ismethod(runtime_value):
                return "method"
            if inspect.isfunction(runtime_value):
                return "function"
            if inspect.isroutine(runtime_value):
                return "method"
            if callable(runtime_value):
                return "callable"
        except Exception:
            pass
        return "attribute"

    def _object_members(obj):
        import inspect
        rows = []
        navmeta = []
        names = []
        try:
            names = dir(obj)
        except Exception:
            names = []

        # Prefer the usable API surface. Dunder names are usually inherited
        # protocol noise, so hide them unless that is all the object exposes.
        non_dunder = [n for n in names if not (n.startswith("__") and n.endswith("__"))]
        if non_dunder:
            names = non_dunder
        names = sorted(names, key=lambda n: (n.startswith("_"), n.lower()))
        for name in names[:MAX_ROWS]:
            try:
                static_value = inspect.getattr_static(obj, name)
            except Exception:
                static_value = None
            try:
                runtime_value = getattr(obj, name)
                error = ""
            except Exception as e:
                runtime_value = None
                error = "%s: %s" % (type(e).__name__, e)

            type_name = type(runtime_value).__name__ if not error else type(static_value).__name__
            category = _member_category(static_value, runtime_value)
            signature = _signature(runtime_value) if not error and category in (
                "class", "method", "function", "callable"
            ) else ""
            value = error or _preview(runtime_value)
            if category == "property":
                doc_source = static_value
            elif category == "attribute":
                doc_source = None
            else:
                doc_source = runtime_value if not error else static_value
            rows.append([
                name,
                category,
                type_name,
                value,
                signature,
                _doc_preview(doc_source),
            ])
            accessor = ".%s" % name if name.isidentifier() else None
            navmeta.append({
                "accessor": accessor,
                "expandable": bool(accessor) and not error and _expandable(runtime_value),
            })
        return names, rows, navmeta

    # Run the input like a notebook cell: execute all statements, then take the
    # value of the trailing expression. Runs in a copy of globals so temporaries
    # (e.g. a = 1) don't leak into the user namespace.
    _src = ${exprLiteral}
    try:
        import ast
        _tree = ast.parse(_src)
        _ns = dict(globals())
        if _tree.body and isinstance(_tree.body[-1], ast.Expr):
            _last = ast.Expression(_tree.body.pop().value)
            exec(compile(_tree, "<jupyter-explorer>", "exec"), _ns)
            _obj = eval(compile(_last, "<jupyter-explorer>", "eval"), _ns)
        else:
            exec(compile(_tree, "<jupyter-explorer>", "exec"), _ns)
            _obj = None
    except Exception as e:
        if isinstance(e, ModuleNotFoundError) and (getattr(e, "name", None) or "").startswith("pyarrow"):
            return {"kind": "error", "message": "This file needs pyarrow in the selected kernel. Install it in that Python environment and refresh."}
        return {"kind": "error", "message": "Failed to evaluate: %s" % e}

    result = {"name": ${exprLiteral}}
${sessionId ? `    _paged = _jupyter_explorer_open(${JSON.stringify(sessionId)}, _obj, ${exprLiteral})\n    if _paged is not None:\n        return _paged` : ""}
    try:
        # Match by class hierarchy (MRO) so subclasses of DataFrame / Series /
        # ndarray are detected, not just the exact pandas / numpy classes.
        def _is(obj, name):
            return any(getattr(b, "__name__", "") == name for b in type(obj).__mro__)

        if _is(_obj, "DataFrame"):
            total_rows = int(_obj.shape[0])
            cols = list(_obj.columns)[:MAX_COLS]
            sub = _obj.iloc[:MAX_ROWS, :MAX_COLS]
            from pandas.api.types import is_numeric_dtype, is_bool_dtype
            numeric = [c for c, dtype in zip(cols, sub.dtypes)
                       if is_numeric_dtype(dtype) and not is_bool_dtype(dtype)]
            result.update({
                "kind": "dataframe",
                "shape": [int(_obj.shape[0]), int(_obj.shape[1])],
                "columns": [str(c) for c in cols],
                "dtypes": {str(c): str(dtype) for c, dtype in zip(cols, sub.dtypes)},
                "index": [str(i) for i in sub.index.tolist()],
                "rows": [[_clean(v) for v in row]
                         for row in sub.itertuples(index=False, name=None)],
                "total_rows": total_rows,
                "truncated": total_rows > MAX_ROWS,
                "numeric_columns": [str(c) for c in numeric if c in cols],
            })
            result["navmeta"] = [{"accessor": ".iloc[%d]" % i, "expandable": True}
                                 for i in range(int(sub.shape[0]))]
            if INCLUDE_SUMMARY:
                try:
                    desc = _obj.describe().T
                    result["summary"] = {
                        "stats": [str(s) for s in desc.columns],
                        "index": [str(i) for i in desc.index],
                        "rows": [[_clean(v) for v in row]
                                 for row in desc.itertuples(index=False, name=None)],
                    }
                except Exception:
                    pass
        elif _is(_obj, "Series"):
            total = int(len(_obj))
            sub = _obj.iloc[:MAX_ROWS]
            name = str(_obj.name) if _obj.name is not None else "value"
            from pandas.api.types import is_numeric_dtype, is_bool_dtype
            is_num = is_numeric_dtype(_obj.dtype) and not is_bool_dtype(_obj.dtype)
            result.update({
                "kind": "series",
                "shape": [total],
                "columns": [name],
                "dtypes": {name: str(_obj.dtype)},
                "index": [str(i) for i in sub.index.tolist()],
                "rows": [[_clean(v)] for v in sub.tolist()],
                "total_rows": total,
                "truncated": total > MAX_ROWS,
                "numeric_columns": [name] if is_num else [],
            })
            result["navmeta"] = [{"accessor": ".iloc[%d]" % i, "expandable": _expandable(v)}
                                 for i, v in enumerate(sub.tolist())]
            if INCLUDE_SUMMARY:
                try:
                    desc = _obj.describe()
                    result["summary"] = {
                        "stats": [str(i) for i in desc.index],
                        "index": [name],
                        "rows": [[_clean(v) for v in desc.tolist()]],
                    }
                except Exception:
                    pass
        elif _is(_obj, "ndarray"):
            import numpy as np
            shape = [int(s) for s in _obj.shape]
            dtype = str(_obj.dtype)
            is_num = np.issubdtype(_obj.dtype, np.number)
            if _obj.ndim == 0:
                result.update({"kind": "scalar", "shape": shape, "dtype": dtype,
                               "repr": _preview(_obj.item(), 2000)})
            elif _obj.ndim == 1:
                n = int(shape[0]) if shape else 0
                arr = _obj[:MAX_ROWS]
                result.update({
                    "kind": "ndarray", "shape": shape, "dtype": dtype,
                    "columns": ["value"],
                    "index": [str(i) for i in range(min(n, MAX_ROWS))],
                    "rows": [[_clean(v)] for v in arr.tolist()],
                    "total_rows": n, "truncated": n > MAX_ROWS,
                    "numeric_columns": ["value"] if is_num else [],
                })
                result["navmeta"] = [{"accessor": "[%d]" % i, "expandable": _expandable(v)}
                                     for i, v in enumerate(arr.tolist())]
            elif _obj.ndim == 2:
                ncols = min(int(_obj.shape[1]), MAX_COLS)
                arr = _obj[:MAX_ROWS, :ncols]
                cols = ["col%d" % i for i in range(ncols)]
                result.update({
                    "kind": "ndarray", "shape": shape, "dtype": dtype,
                    "columns": cols,
                    "index": [str(i) for i in range(min(int(_obj.shape[0]), MAX_ROWS))],
                    "rows": [[_clean(v) for v in row] for row in arr.tolist()],
                    "total_rows": int(_obj.shape[0]),
                    "truncated": int(_obj.shape[0]) > MAX_ROWS,
                    "numeric_columns": cols if is_num else [],
                })
                result["navmeta"] = [{"accessor": "[%d]" % r, "expandable": ncols > 0}
                                     for r in range(int(arr.shape[0]))]
            else:
                result.update({
                    "kind": "scalar", "shape": shape, "dtype": dtype,
                    "repr": "ndarray(shape=%s, dtype=%s)\\n%s" % (shape, dtype, repr(_obj)[:2000]),
                })
        elif isinstance(_obj, (list, tuple)):
            total = len(_obj)
            seq = _obj[:MAX_ROWS]
            navmeta = [{"accessor": "[%d]" % i, "expandable": _expandable(x)}
                       for i, x in enumerate(seq)]
            if seq and all(isinstance(x, dict) for x in seq):
                colset = []
                for d in seq:
                    for k in d.keys():
                        if k not in colset and len(colset) < MAX_COLS:
                            colset.append(k)
                rows = [[_clean(d.get(c)) for c in colset] for d in seq]
                result.update({
                    "kind": "list", "columns": [str(c) for c in colset],
                    "index": [str(i) for i in range(len(seq))],
                    "rows": rows, "navmeta": navmeta,
                    "total_rows": total, "truncated": total > MAX_ROWS,
                    "numeric_columns": [],
                })
            elif seq and all(isinstance(x, (list, tuple)) for x in seq):
                ncols = min(max(len(x) for x in seq), MAX_COLS)
                cols = ["col%d" % i for i in range(ncols)]
                rows = [[_clean(x[i]) if i < len(x) else None for i in range(ncols)] for x in seq]
                result.update({
                    "kind": "list", "columns": cols,
                    "index": [str(i) for i in range(len(seq))],
                    "rows": rows, "navmeta": navmeta,
                    "total_rows": total, "truncated": total > MAX_ROWS,
                    "numeric_columns": cols,
                })
            else:
                allnum = all(isinstance(x, (int, float)) and not isinstance(x, bool) for x in seq)
                result.update({
                    "kind": "list", "columns": ["value"],
                    "index": [str(i) for i in range(len(seq))],
                    "rows": [[_clean(x)] for x in seq], "navmeta": navmeta,
                    "total_rows": total, "truncated": total > MAX_ROWS,
                    "numeric_columns": ["value"] if allnum else [],
                })
        elif isinstance(_obj, dict):
            total = len(_obj)
            items = list(itertools.islice(_obj.items(), MAX_ROWS))
            navmeta = []
            for k, v in items:
                acc = _key_accessor(k)
                navmeta.append({"accessor": acc, "expandable": bool(acc) and _expandable(v)})
            result.update({
                "kind": "dict", "columns": ["key", "value"],
                "index": [str(i) for i in range(len(items))],
                "rows": [[_clean(k), _clean(v)] for k, v in items],
                "navmeta": navmeta,
                "total_rows": total, "truncated": total > MAX_ROWS,
                "numeric_columns": [],
            })
        else:
            scalar_types = (type(None), bool, int, float, complex, str, bytes)
            if isinstance(_obj, scalar_types):
                result.update({"kind": "scalar", "repr": _preview(_obj, 2000)})
            else:
                names, rows, navmeta = _object_members(_obj)
                if rows:
                    result.update({
                        "kind": "object",
                        "type": "%s.%s" % (type(_obj).__module__, type(_obj).__name__),
                        "repr": _preview(_obj, 2000),
                        "columns": ["name", "category", "type", "value", "signature", "doc"],
                        "index": [str(i) for i in range(len(rows))],
                        "rows": rows,
                        "navmeta": navmeta,
                        "total_rows": len(names),
                        "truncated": len(names) > MAX_ROWS,
                        "numeric_columns": [],
                    })
                else:
                    result.update({"kind": "scalar", "repr": _preview(_obj, 2000)})
    except Exception as e:
        return {"kind": "error", "message": str(e)}
    return result

print(__import__("json").dumps(_jupyter_explorer(), default=str))
del _jupyter_explorer
`;
}

/**
 * Singleton store backing the Data Explorer. It is fed explicitly with a kernel
 * and an expression (from the `explorer` command or the Variable Explorer),
 * and holds onto that data independently of the workspace focus / store.kernel.
 * This keeps the panel stable (and cheap) when the user switches editors.
 */
class ExplorerStore {
  _fetchGeneration = 0;
  kernel = null; // the kernel feeding the explorer (set on load)
  expression = "";
  loading = false;
  error = null;
  payload = null;
  _unsortedPayload = null;
  sortColumn = null;
  sortDirection = 0;
  session = null;
  filters = [];
  profile = null;
  profileLoading = false;
  profileError = null;
  profileColumn = 0;
  filterOperator = "contains";
  filterValue = "";
  queryGeneration = 0;
  queryController = null;
  profileController = null;
  searchLimited = false;
  searchTotal = 0;

  // view + plot config
  // grid | line | scatter | bar | area | histogram | box | heatmap | parallel | summary
  viewMode = "grid";
  xColumn = INDEX_COLUMN; // X axis
  yColumn = null; // Y axis (single numeric)
  zColumn = null; // Z axis (numeric, optional -> 3D when set for scatter/line)
  yColumns = []; // multi-select metrics, used by parallel coordinates
  colorColumn = null; // categorical dimension to color / group by
  selectedRow = null; // row index to highlight in the grid (e.g. from a plot click)
  // Drill-down breadcrumb. Each segment is { label, expression }; segment 0 is
  // the root expression, later segments append accessors (e.g. ["k"], [0], .attr).
  path = [];
  // Bumped on each drill navigation so the panel can refocus the grid once the
  // new level has rendered (drilling unmounts the old grid while loading).
  focusToken = 0;
  // Grid state (selection + scroll) to restore when stepping back to a level we
  // previously drilled out of; consumed by the grid once it has re-rendered.
  pendingRestore = null;
  // Search (search-panel adapter) state: matching cells and the current match.
  searchMatches = [];
  searchCurrentIndex = -1;
  // The live grid instance (set by the grid on mount) and the lazily-created
  // search adapter, both plain (non-observable) references.
  activeGrid = null;
  searchAdapter = null;

  constructor() {
    this.emitter = new Emitter();
  }

  /**
   * Invoke the callback whenever the explored expression, its payload, the
   * drill path, the plot configuration, or the loading/error state changes.
   * @param {Function} callback
   * @returns {Disposable}
   */
  onDidUpdate(callback) {
    return this.emitter.on("did-update", callback);
  }

  _emitUpdate() {
    this.emitter.emit("did-update");
  }

  get isPython() {
    return Boolean(
      this.kernel && this.kernel.language && this.kernel.language.toLowerCase() === "python",
    );
  }

  // The expression actually evaluated / shown in the grid. This is the tail of
  // the drill path, which may be deeper than `expression` (what the editor
  // shows). The editor keeps the root the user typed; the breadcrumb conveys the
  // current depth, so drilling never rewrites the editor.
  get currentExpression() {
    return this.path.length > 0 ? this.path[this.path.length - 1].expression : this.expression;
  }

  setExpression = (text) => {
    this.expression = text;
    this._emitUpdate();
  };

  /**
   * Bind a kernel without fetching anything, so the in-panel expression
   * editor works the moment the panel opens.
   * @param {JupyterKernel} kernel
   */
  adoptKernel = (kernel) => {
    if (!kernel || this.kernel === kernel) {
      return;
    }
    this._fetchGeneration++;
    this.releaseSession();
    this.kernel = kernel;
    this.loading = false;
    this.error = null;
    this.payload = null;
    this._unsortedPayload = null;
    this.filters = [];
    this.profile = null;
    this.refreshSearchResults();
    this._emitUpdate();
  };

  // Feed the explorer with a kernel + expression (command / jupyter-variables).
  load = (kernel, expression) => {
    if (!kernel || !expression) {
      return;
    }
    this.releaseSession();
    this.kernel = kernel;
    this.expression = String(expression).trim();
    this.path = [{ label: this.expression, expression: this.expression }];
    this.pendingRestore = null;
    this._emitUpdate();
    this._fetch();
  };

  // Re-run using the currently fed kernel (in-panel editor confirm). A manual
  // expression resets the drill breadcrumb to a new root.
  loadExpression = (expression) => {
    this.expression = String(expression).trim();
    this.path = [{ label: this.expression, expression: this.expression }];
    this.pendingRestore = null;
    this._emitUpdate();
    this._fetch();
  };

  // Drill into the value at `rowIndex`, appending its accessor to the current
  // expression and re-fetching. The editor expression is left untouched (the
  // breadcrumb shows the depth). `gridState` is the position being left behind,
  // stored on the current level so stepping back can restore it. No-op for rows
  // that aren't expandable.
  drillInto = (rowIndex, gridState) => {
    const payload = this.payload;
    const meta = payload?.paged
      ? this.activeGrid?.rowState?.(rowIndex)?.row?._explorer?.navigation
      : payload && payload.navmeta && payload.navmeta[rowIndex];
    if (!meta || !meta.expandable || !meta.accessor) {
      return;
    }
    const expression = `${this.currentExpression}${meta.accessor}`;
    const path = this.path.slice();
    if (path.length > 0) {
      path[path.length - 1] = { ...path[path.length - 1], gridState };
    }
    path.push({ label: meta.accessor, expression });
    this.path = path;
    this.focusToken += 1;
    this._emitUpdate();
    this._fetch();
  };

  // Jump to a breadcrumb segment (truncating everything below it). Also the path
  // used by drillUp, so it covers Backspace navigation too. The grid position
  // saved when leaving that level is queued for restore.
  navigateTo = (index) => {
    const segment = this.path[index];
    if (!segment) {
      return;
    }
    this.path = this.path.slice(0, index + 1);
    this.pendingRestore = segment.gridState || null;
    this.focusToken += 1;
    this._emitUpdate();
    this._fetch();
  };

  // Climb one level out of the current drill path.
  drillUp = () => {
    if (this.path.length > 1) {
      this.navigateTo(this.path.length - 2);
    }
  };

  // Consumed by the grid once it has applied a restored position.
  clearPendingRestore = () => {
    this.pendingRestore = null;
    this._emitUpdate();
  };

  // --- search (search.adapter service) -------------------------------------

  setSearchMatches = (matches, currentIndex) => {
    this.searchMatches = matches || [];
    this.searchCurrentIndex = currentIndex == null ? -1 : currentIndex;
    this._emitUpdate();
  };

  refreshSearchResults = () => {
    if (this.searchAdapter) {
      this.searchAdapter.dataChanged();
    } else {
      this.setSearchMatches([], -1);
    }
  };

  // The grid registers/unregisters itself so the search adapter can read its
  // active cell and drive scrolling/selection.
  setActiveGrid = (grid) => {
    this.activeGrid = grid;
  };

  // Lazily created search adapter, surfaced through the search.adapter service.
  getSearchAdapter = () => {
    if (!this.searchAdapter) {
      this.searchAdapter = new ExplorerSearchAdapter(this);
    }
    return this.searchAdapter;
  };

  refresh = () => {
    if (this.currentExpression) {
      this._fetch();
    }
  };

  // Clear the explorer, e.g. when its kernel is shut down.
  reset = () => {
    this._fetchGeneration++;
    this.releaseSession();
    this.kernel = null;
    this.expression = "";
    this.path = [];
    this.pendingRestore = null;
    this.payload = null;
    this._unsortedPayload = null;
    this.sortColumn = null;
    this.sortDirection = 0;
    this.filters = [];
    this.profile = null;
    this.profileError = null;
    this.refreshSearchResults();
    this.error = null;
    this.loading = false;
    this._emitUpdate();
  };

  _fetch = () => {
    const generation = ++this._fetchGeneration;
    const kernel = this.kernel;
    if (!kernel || kernel.destroyed) {
      this.setError(
        "No kernel running. Run “jupyter-explorer:explore” from an editor or notebook cell.",
      );
      return;
    }
    if (!this.isPython) {
      this.setError("Data Explorer only works with Python kernels");
      return;
    }

    this.loading = true;
    this.error = null;
    this._emitUpdate();

    this.releaseSession();
    const session = { id: randomUUID(), kernel };
    this.session = session;
    this.filters = [];
    this.profile = null;
    this.profileError = null;
    this.profileColumn = 0;
    const code = buildSerializerCode(
      this.currentExpression,
      this.viewMode === "summary",
      session.id,
    );
    let stdout = "";
    let settled = false;
    const receive = (result) => {
      if (settled || generation !== this._fetchGeneration || this.kernel !== kernel) return;
      if (result.output_type === "stream" && result.name === "stdout") {
        stdout += Array.isArray(result.text) ? result.text.join("") : result.text || "";
      } else if (result.output_type === "status" && result.execution_state === "idle") {
        settled = true;
        const text = stdout.trim();
        try {
          // The helper prints its JSON on one final line; output produced by
          // the evaluated expression or a custom repr may precede it.
          const payload = JSON.parse(text.slice(text.lastIndexOf("\n") + 1));
          if (!payload || typeof payload.kind !== "string") throw new Error("Invalid payload");
          this.setPayload(payload);
        } catch {
          this.setError("The kernel did not return a complete data snapshot. Try refreshing.");
        }
      } else if (result.output_type === "error") {
        settled = true;
        const message = `${result.ename || "Error"}: ${result.evalue || ""}`.trim();
        this.setError(message);
      }
    };
    try {
      kernel.executeWatch(code, receive);
    } catch (error) {
      settled = true;
      this.setError(error.message || String(error));
    }
  };

  setPayload = (payload) => {
    this.loading = false;
    this._unsortedPayload = payload;
    this.sortColumn = null;
    this.sortDirection = 0;
    if (payload && payload.kind === "error") {
      this.releaseSession();
      this.error = payload.message || "Failed to load data";
      this.payload = null;
      this.refreshSearchResults();
      this._emitUpdate();
      return;
    }
    this.error = null;
    this.payload = payload;
    if (!payload?.paged) this.session = null;
    this.selectedRow = null;
    this._initPlotConfig();
    // Re-run the active search against the new data (or clear if none).
    if (this.searchAdapter) {
      this.searchAdapter.dataChanged();
    }
    this._emitUpdate();
  };

  setError = (message) => {
    this.releaseSession();
    this.loading = false;
    this.error = message;
    this.payload = null;
    this._unsortedPayload = null;
    this.refreshSearchResults();
    this._emitUpdate();
  };

  _initPlotConfig = () => {
    const payload = this.payload;
    if (!payload || !Array.isArray(payload.columns)) {
      this.xColumn = INDEX_COLUMN;
      this.yColumn = null;
      this.zColumn = null;
      this.yColumns = [];
      this.colorColumn = null;
      return;
    }
    const numeric = payload.numeric_columns || [];
    const columns = payload.columns || [];
    this.xColumn = INDEX_COLUMN;
    // Prefer a numeric column for the value axis, but fall back to any column so
    // DataFrames with non-numeric (e.g. object-dtype) columns are still plottable.
    this.yColumn = numeric[0] || columns[0] || null;
    this.zColumn = null;
    this.yColumns = numeric.slice(0, Math.min(numeric.length, 4));
    this.colorColumn = null;
  };

  sortByColumn = (_column, column, { direction = "cycle" } = {}) => {
    const source = this._unsortedPayload;
    if (!Array.isArray(source?.rows) || column < 0 || column >= source.columns.length) return;
    let order = direction === "ascending" ? 1 : direction === "descending" ? -1 : 0;
    if (direction === "cycle") {
      order =
        this.sortColumn !== column
          ? 1
          : this.sortDirection === 1
            ? -1
            : this.sortDirection === -1
              ? 0
              : 1;
    }
    this.sortColumn = order ? column : null;
    this.sortDirection = order;
    if (source.paged) {
      this.runQuery();
      return;
    }
    if (!order) {
      this.payload = source;
    } else {
      const indices = source.rows.map((_, index) => index);
      indices.sort((left, right) => {
        const a = source.rows[left][column];
        const b = source.rows[right][column];
        if (a == null || b == null)
          return a == null && b == null ? left - right : a == null ? 1 : -1;
        const comparison =
          typeof a === "number" && typeof b === "number"
            ? a - b
            : String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
        return comparison * order || left - right;
      });
      this.payload = {
        ...source,
        rows: indices.map((index) => source.rows[index]),
        ...(source.index ? { index: indices.map((index) => source.index[index]) } : null),
        ...(source.navmeta ? { navmeta: indices.map((index) => source.navmeta[index]) } : null),
      };
    }
    this.selectedRow = null;
    this.refreshSearchResults();
    this._emitUpdate();
  };

  setViewMode = (mode) => {
    this.viewMode = mode;
    this._emitUpdate();
    if (mode === "summary" && this.payload?.paged) {
      this.loadProfile();
    } else if (
      mode === "summary" &&
      !this.payload?.summary &&
      this.kernel &&
      this.currentExpression
    ) {
      this._fetch();
    }
  };

  setXColumn = (column) => {
    this.xColumn = column;
    this._emitUpdate();
  };

  setYColumn = (column) => {
    this.yColumn = column || null;
    this._emitUpdate();
  };

  setZColumn = (column) => {
    this.zColumn = column || null;
    this._emitUpdate();
  };

  setColorColumn = (column) => {
    this.colorColumn = column || null;
    this._emitUpdate();
  };

  setSelectedRow = (rowIndex) => {
    // The highlight persists until the user dismisses it (clicking in the grid)
    // or a new plot point is clicked; no auto-hide timer.
    this.selectedRow = rowIndex;
    this._emitUpdate();
  };

  toggleYColumn = (column) => {
    if (this.yColumns.includes(column)) {
      this.yColumns = this.yColumns.filter((c) => c !== column);
    } else {
      this.yColumns = [...this.yColumns, column];
    }
    this._emitUpdate();
  };

  releaseSession() {
    this.queryGeneration++;
    this.queryController?.abort();
    this.profileController?.abort();
    this.queryController = this.profileController = null;
    this.profileLoading = false;
    const session = this.session;
    this.session = null;
    if (session && !session.kernel.destroyed) {
      // Closing also runs after an obsolete open, on the same shell queue, so
      // an expression superseded before it answers cannot leak a dataset.
      executeQuery(session.kernel, requestCode({ session: session.id, action: "close" })).catch(
        () => {},
      );
    }
  }

  request(action, args = {}, { signal } = {}) {
    const session = this.session;
    if (!session || !this.payload?.paged) return Promise.reject(new Error("No paged data loaded"));
    const generation = this.queryGeneration;
    const isCurrent = () =>
      this.session === session && generation === this.queryGeneration && !signal?.aborted;
    return executeQuery(session.kernel, requestCode({ session: session.id, action, ...args }), {
      signal,
    }).then(
      (reply) => {
        if (!isCurrent()) throw abortError();
        return reply;
      },
      (error) => {
        // A reply may already have rejected before a synchronous load, filter
        // or column change aborts it. Gate rejection at the promise boundary
        // too, so its consumer cannot apply an old error to the current view.
        if (!isCurrent()) throw abortError();
        throw error;
      },
    );
  }

  fetchRows = async ({ offset, limit, signal }) => {
    if (this.loading) throw abortError();
    const page = await this.request("page", { offset, limit }, { signal });
    return page.rows.map((row, index) => {
      Object.defineProperty(row, "_explorer", {
        value: { index: page.index[index], navigation: page.navmeta[index] },
      });
      return row;
    });
  };

  runQuery = () => {
    if (!this.payload?.paged) return;
    this.queryController?.abort();
    this.profileController?.abort();
    const controller = (this.queryController = new AbortController());
    this.queryGeneration++;
    this.loading = true;
    this.profile = null;
    this.profileLoading = false;
    this.profileError = null;
    this._emitUpdate();
    const sort = this.sortDirection
      ? { column: this.sortColumn, direction: this.sortDirection }
      : null;
    void this.request("query", { filters: this.filters, sort }, { signal: controller.signal })
      .then((payload) => {
        if (controller.signal.aborted) return;
        this.loading = false;
        this.error = null;
        this.payload = this._unsortedPayload = payload;
        this.selectedRow = null;
        this.refreshSearchResults();
        this._emitUpdate();
        if (this.viewMode === "summary") this.loadProfile();
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        if (error.name !== "AbortError") {
          this.loading = false;
          this.error = error.message;
          this._emitUpdate();
        }
      });
  };

  addFilter = (filter) => {
    this.filters = [...this.filters.filter((current) => current.column !== filter.column), filter];
    this.runQuery();
  };

  removeFilter = (column) => {
    this.filters = this.filters.filter((filter) => filter.column !== column);
    this.runQuery();
  };

  clearFilters = () => {
    this.filters = [];
    this.runQuery();
  };

  applyFilter = () => {
    const filter = {
      column: this.profileColumn,
      operator: this.filterOperator,
      value: this.filterValue,
    };
    if (filter.operator === "range") {
      const bounds = this.filterValue.split("..");
      if (
        bounds.length !== 2 ||
        bounds.every((bound) => !bound.trim()) ||
        bounds.some((bound) => bound.trim() && !Number.isFinite(Number(bound)))
      ) {
        this.profileError = "Enter a numeric range as min..max; either bound may be empty.";
        this._emitUpdate();
        return;
      }
      filter.min = bounds[0].trim() ? Number(bounds[0]) : null;
      filter.max = bounds[1].trim() ? Number(bounds[1]) : null;
    }
    this.addFilter(filter);
  };

  setProfileColumn = (column) => {
    this.profileController?.abort();
    this.profileColumn = column;
    this.profile = null;
    this.profileError = null;
    this.profileLoading = false;
    this._emitUpdate();
  };

  loadProfile = () => {
    if (!this.payload?.paged || !this.payload.columns.length) return;
    this.profileController?.abort();
    const controller = (this.profileController = new AbortController());
    this.profileLoading = true;
    this.profileError = null;
    this._emitUpdate();
    void this.request("profile", { column: this.profileColumn }, { signal: controller.signal })
      .then((profile) => {
        if (controller.signal.aborted) return;
        this.profile = profile;
        this.profileLoading = false;
        this._emitUpdate();
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        if (error.name === "AbortError") return;
        this.profileError = error.message;
        this.profileLoading = false;
        this._emitUpdate();
      });
  };
}

// Single shared instance for the whole package.
const explorerStore = new ExplorerStore();

module.exports = { explorerStore, ExplorerStore, INDEX_COLUMN, buildSerializerCode };
