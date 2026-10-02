"""Kernel-side explorer sessions. Only requested pages cross the connection."""
import math as _jupyter_math


class _JupyterExplorerData:
    def __init__(self, obj, name):
        self.obj, self.name = obj, name
        self.positions = None
        self.filters, self.sort = [], None
        self.kind = None
        self.keys = None
        self.columns, self.numeric, self.dtypes = [], [], {}
        self.shape = None
        hierarchy = [b.__name__ for b in type(obj).__mro__]
        if "DataFrame" in hierarchy:
            from pandas.api.types import is_numeric_dtype, is_bool_dtype, is_complex_dtype
            self.kind = "dataframe"
            self.count = len(obj)
            self.columns = [str(c) for c in obj.columns]
            self.numeric = [i for i, d in enumerate(obj.dtypes)
                            if is_numeric_dtype(d) and not is_bool_dtype(d) and not is_complex_dtype(d)]
            self.dtypes = {str(i): str(d) for i, d in enumerate(obj.dtypes)}
            self.shape = list(obj.shape)
        elif "Series" in hierarchy:
            from pandas.api.types import is_numeric_dtype, is_bool_dtype, is_complex_dtype
            self.kind = "series"
            self.count = len(obj)
            self.columns = [str(obj.name) if obj.name is not None else "value"]
            self.numeric = [0] if is_numeric_dtype(obj.dtype) and not is_bool_dtype(obj.dtype) and not is_complex_dtype(obj.dtype) else []
            self.dtypes = {"0": str(obj.dtype)}
            self.shape = [self.count]
        elif "ndarray" in hierarchy and obj.ndim in (1, 2):
            import numpy as np
            self.kind, self.count = "ndarray", len(obj)
            self.columns = ["value"] if obj.ndim == 1 else ["col%d" % i for i in range(obj.shape[1])]
            self.numeric = list(range(len(self.columns))) if np.issubdtype(obj.dtype, np.integer) or np.issubdtype(obj.dtype, np.floating) else []
            self.dtypes = {str(i): str(obj.dtype) for i in range(len(self.columns))}
            self.shape = list(obj.shape)
        elif type(obj).__module__.startswith("pyarrow") and any(name in hierarchy for name in ("Table", "RecordBatch")):
            import pyarrow as pa
            self.kind, self.count = "arrow", obj.num_rows
            self.columns = obj.column_names
            self.numeric = [i for i, f in enumerate(obj.schema)
                            if pa.types.is_integer(f.type) or pa.types.is_floating(f.type) or pa.types.is_decimal(f.type)]
            self.dtypes = {str(i): str(f.type) for i, f in enumerate(obj.schema)}
            self.shape = [obj.num_rows, obj.num_columns]
        elif isinstance(obj, (list, tuple)):
            self.kind, self.count = "list", len(obj)
            self.layout = "scalar"
            if obj and all(isinstance(v, dict) for v in obj):
                self.layout = "dicts"
                self.keys = list(dict.fromkeys(k for row in obj for k in row))
                self.columns = [str(k) for k in self.keys]
            elif obj and all(isinstance(v, (tuple, list)) for v in obj):
                self.layout = "rows"
                self.columns = ["col%d" % i for i in range(max(map(len, obj)))]
            else:
                self.columns = ["value"]
            self.numeric = [i for i in range(len(self.columns)) if all(
                v is None or isinstance(v, (float, int)) and not isinstance(v, bool)
                for v in self.column(i))]
        elif isinstance(obj, dict):
            self.kind, self.count = "dict", len(obj)
            self.keys = list(obj)
            self.columns = ["key", "value"]
        else:
            self.count = 0

    @staticmethod
    def clean(value):
        if value is None:
            return None
        if hasattr(value, "item"):
            try:
                value = value.item()
            except (ValueError, AttributeError):
                pass
        if isinstance(value, float) and not _jupyter_math.isfinite(value):
            return None
        if isinstance(value, (str, int, float, bool)):
            return value
        try:
            import pandas as pd
            if pd.isna(value) is True:
                return None
        except (ImportError, ValueError, TypeError):
            pass
        return str(value)

    @staticmethod
    def expandable(value):
        return value is not None and not isinstance(value, (str, bytes, int, float, bool, complex))

    def indices(self):
        return range(self.count) if self.positions is None else self.positions

    def value(self, row, column):
        if self.kind == "dataframe":
            return self.obj.iloc[row, column]
        if self.kind == "series":
            return self.obj.iloc[row]
        if self.kind == "ndarray":
            return self.obj[row] if self.obj.ndim == 1 else self.obj[row, column]
        if self.kind == "arrow":
            return self.obj.column(column)[row].as_py()
        if self.kind == "dict":
            key = self.keys[row]
            return key if column == 0 else self.obj[key]
        value = self.obj[row]
        if self.layout == "dicts":
            return value.get(self.keys[column])
        if self.layout == "rows":
            return value[column] if column < len(value) else None
        return value

    def column(self, column, positions=None):
        positions = range(self.count) if positions is None else positions
        if self.kind == "dataframe":
            return self.obj.iloc[positions, column].reset_index(drop=True)
        if self.kind == "series":
            return self.obj.iloc[positions].reset_index(drop=True)
        if self.kind == "ndarray":
            return self.obj[positions] if self.obj.ndim == 1 else self.obj[positions, column]
        return [self.value(int(row), column) for row in positions]

    def label(self, row):
        return str(self.obj.index[row]) if self.kind in ("dataframe", "series") else str(row)

    def navigation(self, row):
        if self.kind == "dataframe":
            return {"accessor": ".iloc[%d]" % row, "expandable": True}
        if self.kind == "series":
            return {"accessor": ".iloc[%d]" % row, "expandable": self.expandable(self.obj.iloc[row])}
        if self.kind == "arrow":
            return {"accessor": ".slice(%d, 1)" % row, "expandable": True}
        if self.kind == "dict":
            key = self.keys[row]
            valid = isinstance(key, (type(None), bool, int, float, complex, str, bytes))
            return {"accessor": "[%r]" % key if valid else None,
                    "expandable": valid and self.expandable(self.obj[key])}
        return {"accessor": "[%d]" % row, "expandable": self.expandable(self.obj[row])}

    def page(self, offset=0, limit=200, sample=False):
        indexes = self.indices()
        size = len(indexes)
        offset, limit = max(0, int(offset)), max(0, min(int(limit), 1000))
        if sample and size > limit > 0:
            slots = [(i * (size - 1)) // (limit - 1) for i in range(limit)] if limit > 1 else [0]
        else:
            slots = range(offset, min(size, offset + limit))
        selected = [int(indexes[i]) for i in slots]
        # iloc/NumPy/Arrow slice only the page, then convert to JSON scalars.
        if self.kind == "dataframe":
            values = self.obj.iloc[selected].itertuples(index=False, name=None)
        elif self.kind == "ndarray" and self.obj.ndim == 2:
            values = self.obj[selected].tolist()
        else:
            values = ([self.value(row, col) for col in range(len(self.columns))] for row in selected)
        return {"rows": [[self.clean(v) for v in row] for row in values],
                "index": [self.label(row) for row in selected], "offset": offset,
                "navmeta": [self.navigation(row) for row in selected], "row_slots": list(slots),
                "sampled": sample and size > limit, "sample_rows": len(selected), "row_count": size}

    def metadata(self):
        result = {"kind": self.kind, "name": self.name, "paged": True,
                  "columns": self.columns, "dtypes": self.dtypes,
                  "numeric_columns": [self.columns[i] for i in self.numeric],
                  "total_rows": self.count, "row_count": len(self.indices()),
                  "shape": self.shape, "truncated": False}
        result.update(self.page(limit=1000, sample=True))
        return result

    def query(self, filters, sort):
        positions = range(self.count)
        # Vectorized masks when pandas is available; NumPy also supplies the
        # same route through a Series. Python-only collections keep working.
        for rule in filters:
            column = int(rule["column"])
            if not 0 <= column < len(self.columns):
                raise ValueError("Filter column is no longer available")
            values = self.column(column, positions)
            operation = rule.get("operator", "contains")
            try:
                import pandas as pd
                series = pd.Series(values).reset_index(drop=True)
                if operation == "missing":
                    mask = series.isna()
                elif operation == "present":
                    mask = series.notna()
                elif operation == "range":
                    number = pd.to_numeric(series, errors="coerce")
                    mask = number.notna()
                    if rule.get("min") is not None:
                        mask &= number >= float(rule["min"])
                    if rule.get("max") is not None:
                        mask &= number < float(rule["max"]) if rule.get("maxExclusive") else number <= float(rule["max"])
                else:
                    text = series.astype("string")
                    target = str(rule.get("value", ""))
                    if operation == "equals" and not isinstance(rule.get("value"), str):
                        mask = series.eq(rule.get("value")).fillna(False)
                    else:
                        mask = text.eq(target).fillna(False) if operation == "equals" else text.str.contains(target, case=False, regex=False, na=False)
                positions = [int(positions[i]) for i in mask[mask].index]
            except ImportError:
                selected = []
                for i, value in enumerate(values):
                    value = self.clean(value)
                    match = value is None if operation == "missing" else value is not None
                    if operation == "range":
                        match = isinstance(value, (int, float)) and not isinstance(value, bool)
                        if match and rule.get("min") is not None:
                            match = value >= float(rule["min"])
                        if match and rule.get("max") is not None:
                            match = value < float(rule["max"]) if rule.get("maxExclusive") else value <= float(rule["max"])
                    elif operation in ("contains", "equals"):
                        target, text = str(rule.get("value", "")), str(value) if value is not None else ""
                        match = value is not None and ((value == rule.get("value") if not isinstance(rule.get("value"), str) else text == target) if operation == "equals" else target.casefold() in text.casefold())
                    if match:
                        selected.append(int(positions[i]))
                positions = selected
        if sort and sort.get("direction"):
            column = int(sort["column"])
            values = self.column(column, positions)
            try:
                import pandas as pd
                order = pd.Series(values).sort_values(ascending=sort["direction"] > 0, kind="stable", na_position="last").index
                positions = [int(positions[i]) for i in order]
            except (ImportError, TypeError):
                good, missing = [], []
                for index, value in zip(positions, values):
                    value = self.clean(value)
                    (missing if value is None else good).append((index, value))
                good.sort(key=lambda pair: (0, pair[1]) if isinstance(pair[1], (int, float)) else (1, str(pair[1]).casefold()), reverse=sort["direction"] < 0)
                positions = [int(pair[0]) for pair in good + missing]
        self.positions = positions if filters or sort else None
        self.filters, self.sort = filters, sort
        return self.metadata()

    def profile(self, column):
        from collections import Counter
        column = int(column)
        values = self.column(column, self.indices())
        histogram, minimum, maximum, mean = [], None, None, None
        try:
            import pandas as pd
            series = pd.Series(values)
            nulls = int(series.isna().sum())
            try:
                distinct = int(series.nunique(dropna=True))
                top = [{"value": self.clean(v), "count": int(n)} for v, n in series.value_counts(dropna=True).head(10).items()]
            except TypeError:
                counts = Counter(str(self.clean(v)) for v in series if self.clean(v) is not None)
                distinct, top = len(counts), [{"value": v, "count": n} for v, n in counts.most_common(10)]
            if column in self.numeric:
                import numpy as np
                number = pd.to_numeric(series, errors="coerce").dropna().to_numpy(dtype=float)
                number = number[np.isfinite(number)]
                if len(number):
                    minimum, maximum, mean = float(number.min()), float(number.max()), float(number.mean())
                    counts, edges = np.histogram(number, bins=10)
                    histogram = [{"min": float(edges[i]), "max": float(edges[i + 1]), "count": int(n)} for i, n in enumerate(counts)]
        except ImportError:
            counts, number, nulls = Counter(), [], 0
            for value in values:
                value = self.clean(value)
                if value is None:
                    nulls += 1
                else:
                    counts[str(value)] += 1
                    if column in self.numeric and isinstance(value, (int, float)):
                        number.append(value)
            distinct, top = len(counts), [{"value": v, "count": n} for v, n in counts.most_common(10)]
            if number:
                minimum, maximum, mean = min(number), max(number), sum(number) / len(number)
                width = (maximum - minimum) / 10 or 1
                bins = [0] * 10
                for value in number:
                    bins[min(9, int((value - minimum) / width))] += 1
                histogram = [{"min": minimum + i * width, "max": minimum + (i + 1) * width, "count": n} for i, n in enumerate(bins)]
        return {"column": column, "label": self.columns[column], "scope": "all-filtered-rows",
                "total": len(self.indices()), "nulls": nulls, "distinct": distinct, "top": top,
                "histogram": histogram, "min": minimum, "max": maximum, "mean": mean,
                "dtype": self.dtypes.get(str(column), "mixed")}

    def search(self, source, flags=""):
        import re
        options = (re.I if "i" in flags else 0) | (re.M if "m" in flags else 0) | (re.S if "s" in flags else 0)
        regex = re.compile(source, options)
        matches, total = [], 0
        for slot, row in enumerate(self.indices()):
            for column in range(len(self.columns)):
                value = self.clean(self.value(int(row), column))
                if value is not None and regex.search(str(value)):
                    total += 1
                    if len(matches) < 10000:
                        matches.append({"row": slot, "column": column})
        return {"matches": matches, "total": total, "limited": total > len(matches)}


if "_jupyter_explorer_sessions" not in globals():
    _jupyter_explorer_sessions = {}


def _jupyter_explorer_open(session, obj, name):
    data = _JupyterExplorerData(obj, name)
    if data.kind is None:
        return None
    _jupyter_explorer_sessions[session] = data
    return data.metadata()


def _jupyter_explorer_query(request):
    session, action = request["session"], request["action"]
    if action == "close":
        _jupyter_explorer_sessions.pop(session, None)
        return {"closed": True}
    if session not in _jupyter_explorer_sessions:
        raise ValueError("The explorer session is gone. Refresh to load it again.")
    data = _jupyter_explorer_sessions[session]
    if action == "page":
        return data.page(request.get("offset", 0), request.get("limit", 200))
    if action == "query":
        return data.query(request.get("filters", []), request.get("sort"))
    if action == "profile":
        return data.profile(request["column"])
    if action == "search":
        return data.search(request["source"], request.get("flags", ""))
    raise ValueError("Unknown explorer query")
