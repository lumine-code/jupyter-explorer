# jupyter-explorer

Explore dataframes, arrays and nested objects in a searchable grid.

A `repr` tells you a value is a dataframe with 40,000 rows. This shows you the rows: a grid you can scroll, sort, search and drill into, with charts over the numeric columns and a breadcrumb trail back out.

## Features

- **Any Python value**: dataframes, series, arrays, dicts, lists and nested combinations of them.
- **A real grid**: pages through every row of dataframes, arrays, series and collections without pulling the whole value into the editor; sorting and linked column filters run on the complete dataset in the kernel.
- **Drill down**: open a cell that holds another structure and keep going; the breadcrumb walks back.
- **Charts**: line, scatter and heatmap views over the numeric columns, picked from the toolbar.
- **Search**: the search panel queries the grid on screen.
- **Keyboard driven**: move the selection, extend it by row or column, and page through without the mouse.
- **Column profiles**: exact missing and distinct counts, numeric statistics and histograms over every matching row; clicking a histogram bin or frequent value filters the grid and charts together.
- **Columnar files**: open Parquet, Feather and Arrow IPC files through an existing Python kernel with optional pyarrow installed there.

## Installation

To install `jupyter-explorer` search for it in the Install pane of the Lumine settings, or run the command `lumine --install lumine-code/jupyter-explorer`.

It reads its kernels from [`jupyter-repl`](https://github.com/lumine-code/jupyter-repl), which needs to be installed too.

## Commands

Commands available in `lumine-workspace`:

- `jupyter-explorer:explore`: explore the expression under the cursor,
- `jupyter-explorer:open`: open the panel — an empty one picks up the active kernel and the expression under the cursor,
- `jupyter-explorer:open-data-file`: choose a Parquet, Feather or Arrow IPC file to open with the current Python kernel.

Commands available in `.explorer-body`, `.explorer-toolbar-row` and the expression editor:

- `jupyter-explorer:focus-expression`: move focus to the expression editor,
- `jupyter-explorer:focus-toolbar`: move focus to the toolbar,
- `jupyter-explorer:focus-body`: move focus to the grid,
- `jupyter-explorer:focus-filters`: move focus from the toolbar to the filter controls, or to the grid when filters are unavailable,
- `jupyter-explorer:toolbar-left`: move to the previous toolbar control,
- `jupyter-explorer:toolbar-right`: move to the next toolbar control,
- `jupyter-explorer:toolbar-confirm`: activate the focused toolbar control,
- `jupyter-explorer:drill-up`: leave the value you drilled into.

Commands available in `.explorer-canvas-wrap`:

- `jupyter-explorer:grid-page-up`: move a page up,
- `jupyter-explorer:grid-page-down`: move a page down,
- `jupyter-explorer:grid-select-page-up`: extend the selection a page up,
- `jupyter-explorer:grid-select-page-down`: extend the selection a page down,
- `jupyter-explorer:grid-move-to-row-start`: move to the first column,
- `jupyter-explorer:grid-move-to-row-end`: move to the last column,
- `jupyter-explorer:grid-select-to-row-start`: extend the selection to the first column,
- `jupyter-explorer:grid-select-to-row-end`: extend the selection to the last column,
- `jupyter-explorer:grid-select-row`: select the whole row,
- `jupyter-explorer:grid-select-column`: select the whole column.

## Usage

The expression field is a real editor, so it gets the kernel's grammar and, with `autocomplete-plus` installed, its completions. Anything the kernel can evaluate works, not just a bare name — `df.groupby("k").mean()` opens its result.

The panel is bound to the kernel the value came from, so the status bar keeps showing that kernel while you are reading it, rather than the last file you were editing.

Choose a column, an operation and a value to apply a filter. Numeric ranges use `min..max`, with either bound optional. Filters on different columns combine; applying another filter to the same column replaces its previous filter. Remove a filter by clicking its chip, or clear all of them. Profile computes exact statistics over the filtered dataset, and its histogram and frequent values can become filters themselves. These operations may take time on large datasets and run in the shared kernel.

The grid loads 200-row pages and keeps at most three pages. Charts use at most 1,000 evenly spaced rows from the current filtered and sorted view; their footer explicitly identifies a sample. Profiles and sorting cover all rows. Search scans all matching rows in the kernel and exposes up to 10,000 matching cells for navigation, reporting when additional matches exist. Common Python-compatible regular expressions work through the search panel.

An expression is evaluated once per load or refresh. Its value remains in a private explorer session in the kernel while pages are requested, so scrolling never repeats function calls or file reads. Refresh Data evaluates it again and clears filters. Closing the explorer, changing the expression or losing the kernel releases the session. Arbitrary object introspection retains its bounded preview. Unsaved explorer sessions are not restored after a window reload.

Open Data File requires pyarrow in the selected kernel, for example `python -m pip install pyarrow` in that environment. It accepts `.parquet`, `.feather`, `.arrow` and `.ipc`, including Arrow IPC streams. Paths must exist on the machine running the kernel. Files are loaded into kernel memory; only pages and the chart sample reach the editor. Arrow tables and record batches already held by the kernel can also be explored directly. No Python package is installed automatically.

The grid shows up to 1,000 rows and 100 columns. Sorting, search and charts use that displayed snapshot. Open the Summary view to request statistics over the full value.

## Customization

Paste this into your `styles.css` to fit more rows on screen:

```css
.jupyter-explorer {
  .explorer-canvas-wrap {
    font-size: 0.9em;
  }
}
```

## Services

- [`jupyter.explorer`](docs/jupyter.explorer.md): provided to let another package hand over a kernel and an expression to show.
- `search.adapter`: provided to let the search panel query the grid on screen.
- `jupyter.kernel`: consumed to read the active kernel and ask it to serialize a value.
- `autocomplete.watch-editor`: consumed to offer completions in the expression field.
- `background-tips.provider`: provided to show a tip about exploring values in an empty workspace.

## Contributing

Got ideas to make this package better, found a bug, or want to help add new features? Just drop your thoughts on GitHub. Any feedback is welcome!
