const { Emitter } = require("lumine");

const MATCH_LIMIT = 10000;

// Same cell formatting the grid uses, so matches line up with what is shown.
function formatCell(value) {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value);
}

function hasGridSelection(grid) {
  return Boolean(grid?.normalizedSelections?.().length);
}

/**
 * Search adapter for the Data Explorer grid, consumed by search-panel through
 * the search.adapter service. It scans the loaded payload's cell text, tracks
 * an ordered match list (one entry per matching cell), and drives the grid to
 * highlight matches and reveal the current one. The grid is read-only, so
 * replace is not supported (canReplace = false).
 */
class ExplorerSearchAdapter {
  canReplace = false;

  constructor(store) {
    this.store = store;
    this.emitter = new Emitter();
    this.matches = []; // ordered [{ row, column }]
    this.currentIndex = -1;
    // Snapshot of the last query, so re-scanning on data change is independent
    // of the shared FindOptions (which a search elsewhere may have changed).
    this.test = null;
    this.generation = 0;
    this.pendingSearch = null;
    this.scanning = false;
  }

  onDidUpdate(callback) {
    return this.emitter.on("did-update", callback);
  }

  onDidChangeCurrentResult(callback) {
    return this.emitter.on("did-change-current-result", callback);
  }

  onDidError(callback) {
    return this.emitter.on("did-error", callback);
  }

  search(findOptions) {
    const pattern = findOptions.findPattern;
    if (!pattern) {
      this.generation++;
      this.pendingSearch = null;
      this.test = null;
      this.store.searchLimited = false;
      this.store.searchTotal = 0;
      this._setMatches([], -1);
      return;
    }
    let regex;
    try {
      regex = findOptions.getFindPatternRegex();
    } catch (e) {
      this.generation++;
      this.pendingSearch = null;
      this.test = null;
      this.emitter.emit("did-error", e);
      this._setMatches([], -1);
      return;
    }
    // A non-global clone so test() is stateless across cells.
    this.test = new RegExp(regex.source, regex.flags.replace("g", ""));
    this._scan();
  }

  // Re-run the last query after the grid's data changed (drill / navigate).
  dataChanged() {
    if (this.test) {
      this._scan();
    } else {
      this.generation++;
      this.pendingSearch = null;
      this._setMatches([], -1);
    }
  }

  _scan() {
    const generation = ++this.generation;
    const payload = this.store.payload;
    this.store.searchLimited = false;
    this.store.searchTotal = 0;
    if (this.test && payload?.paged) {
      this.pendingSearch = { generation, pattern: this.test };
      this._setMatches([], -1);
      void this._scanPending();
      return;
    }
    this.pendingSearch = null;
    const matches = [];
    if (this.test && payload && Array.isArray(payload.rows) && Array.isArray(payload.columns)) {
      const ncols = payload.columns.length;
      for (let r = 0; r < payload.rows.length; r++) {
        const row = payload.rows[r];
        for (let c = 0; c < ncols; c++) {
          const text = formatCell(row[c]);
          if (text && this.test.test(text)) matches.push({ row: r, column: c });
        }
      }
    }
    this._setMatches(matches, -1);
  }

  async _scanPending() {
    if (this.scanning) return;
    this.scanning = true;
    try {
      while (this.pendingSearch) {
        const { generation, pattern } = this.pendingSearch;
        this.pendingSearch = null;
        try {
          const matches = [];
          let total = 0;
          let offset = 0;
          while (generation === this.generation) {
            const result = await this.store.request(
              "search",
              {
                source: pattern.source,
                flags: pattern.flags,
                offset,
                matchLimit: MATCH_LIMIT - matches.length,
              },
              { priority: "background" },
            );
            if (generation !== this.generation) break;
            matches.push(...result.matches);
            total += result.total;
            if (result.nextOffset == null) {
              this.store.searchLimited = total > matches.length;
              this.store.searchTotal = total;
              this._setMatches(matches, -1);
              break;
            }
            if (!Number.isSafeInteger(result.nextOffset) || result.nextOffset <= offset)
              throw new Error("The kernel returned an invalid search position.");
            offset = result.nextOffset;
          }
        } catch (error) {
          if (error.name !== "AbortError" && generation === this.generation)
            this.emitter.emit("did-error", error);
        }
      }
    } finally {
      this.scanning = false;
    }
  }

  _setMatches(matches, currentIndex) {
    this.matches = matches;
    this.currentIndex = currentIndex;
    this.store.setSearchMatches(matches, currentIndex);
    this.emitter.emit("did-update");
  }

  getResultCount() {
    return this.matches.length;
  }

  getCurrentResultIndex() {
    return this.currentIndex;
  }

  // Row-major comparison of two cells.
  _compare(a, b) {
    return a.row - b.row || a.column - b.column;
  }

  // The position navigation is relative to: the grid's active cell when there is
  // a selection, otherwise just before the first cell so "next" finds match #1.
  _anchor() {
    const grid = this.store.activeGrid;
    if (hasGridSelection(grid)) return grid.activeCell();
    return { row: 0, column: -1 };
  }

  selectNext() {
    if (this.matches.length === 0) return { found: false, wrapped: null };
    const anchor = this._anchor();
    let index = this.matches.findIndex((m) => this._compare(m, anchor) > 0);
    let wrapped = null;
    if (index === -1) {
      index = 0;
      wrapped = "up";
    }
    return this._reveal(index, wrapped);
  }

  selectFirstFromCursor() {
    if (this.matches.length === 0) return { found: false, wrapped: null };
    const anchor = this._anchor();
    let index = this.matches.findIndex((m) => this._compare(m, anchor) >= 0);
    let wrapped = null;
    if (index === -1) {
      index = 0;
      wrapped = "up";
    }
    return this._reveal(index, wrapped);
  }

  selectPrevious() {
    if (this.matches.length === 0) return { found: false, wrapped: null };
    const anchor = this._anchor();
    let index = -1;
    for (let i = this.matches.length - 1; i >= 0; i--) {
      if (this._compare(this.matches[i], anchor) < 0) {
        index = i;
        break;
      }
    }
    let wrapped = null;
    if (index === -1) {
      index = this.matches.length - 1;
      wrapped = "down";
    }
    return this._reveal(index, wrapped);
  }

  selectAll() {
    if (this.matches.length === 0) return { found: false, wrapped: null };
    const grid = this.store.activeGrid;
    grid?.selectCells?.(this.matches);
    // Mark the first as current without overriding the multi-cell selection.
    this.currentIndex = 0;
    this.store.setSearchMatches(this.matches, 0);
    this.emitter.emit("did-change-current-result", 0);
    return { found: true, wrapped: null };
  }

  _reveal(index, wrapped) {
    this.currentIndex = index;
    this.store.setSearchMatches(this.matches, index);
    const grid = this.store.activeGrid;
    grid?.revealCell?.(this.matches[index]);
    this.emitter.emit("did-change-current-result", index);
    return { found: true, wrapped };
  }

  hasSelectionMatchingResult() {
    const grid = this.store.activeGrid;
    if (!hasGridSelection(grid)) return false;
    const cell = grid.activeCell();
    return this.matches.some((match) => match.row === cell.row && match.column === cell.column);
  }

  isSelectionEmpty() {
    const grid = this.store.activeGrid;
    return !hasGridSelection(grid);
  }

  getSelectedText() {
    const grid = this.store.activeGrid;
    const payload = this.store.payload;
    if (!hasGridSelection(grid) || !payload) return "";
    const { row, column } = grid.activeCell();
    const values = payload.paged ? grid.rowState?.(row)?.row : payload.rows && payload.rows[row];
    return values ? formatCell(values[column]) : "";
  }

  getWordUnderCursor() {
    return this.getSelectedText();
  }

  getWrapIconHost() {
    const grid = this.store.activeGrid;
    return grid?.element || null;
  }

  // Clear matches/highlights when the Data Explorer is no longer the active
  // search target (e.g. focus moved to another pane).
  deactivate() {
    this.generation++;
    this.pendingSearch = null;
    this.store.searchLimited = false;
    this.store.searchTotal = 0;
    this.test = null;
    this.matches = [];
    this.currentIndex = -1;
    this.store.setSearchMatches([], -1);
  }

  destroy() {
    this.deactivate();
    this.emitter.dispose();
  }
}

module.exports = ExplorerSearchAdapter;
