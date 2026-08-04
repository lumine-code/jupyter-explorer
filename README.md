# jupyter-explorer

Explore dataframes, arrays and nested objects in a searchable grid.

A `repr` tells you a value is a dataframe with 40,000 rows. This shows you the rows: a grid you can scroll, sort, filter and drill into, with charts over the numeric columns and a breadcrumb trail back out.

## Features

- **Any Python value**: dataframes, series, arrays, dicts, lists and nested combinations of them.
- **A real grid**: scrolls, sorts and filters without pulling the whole value into the editor.
- **Drill down**: open a cell that holds another structure and keep going; the breadcrumb walks back.
- **Charts**: line, bar and scatter views over the numeric columns, picked from the toolbar.
- **Search**: the search panel queries the grid on screen.
- **Keyboard driven**: move the selection, extend it by row or column, and page through without the mouse.

## Installation

To install `jupyter-explorer` search for _jupyter-explorer_ in the Install pane of the Lumine settings or run `lumine --install lumine-code/jupyter-explorer`.

It reads its kernels from [`jupyter-repl`](https://github.com/lumine-code/jupyter-repl), which needs to be installed too.

## Commands

Commands available in `atom-workspace`:

- `jupyter-explorer:explore`: explore the expression under the cursor,
- `jupyter-explorer:open`: open the panel on whatever it last showed.

Commands available in `.data-explorer-body`, `.data-explorer-toolbar-row` and the expression editor:

- `jupyter-explorer:focus-expression`: move focus to the expression editor,
- `jupyter-explorer:focus-toolbar`: move focus to the toolbar,
- `jupyter-explorer:focus-body`: move focus to the grid,
- `jupyter-explorer:toolbar-left`: move to the previous toolbar control,
- `jupyter-explorer:toolbar-right`: move to the next toolbar control,
- `jupyter-explorer:toolbar-confirm`: activate the focused toolbar control,
- `jupyter-explorer:drill-up`: leave the value you drilled into.

Commands available in `.data-explorer-canvas-wrap`:

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

## Customization

Paste this into your `styles.less` to fit more rows on screen:

```less
.jupyter-explorer {
  .data-explorer-canvas-wrap {
    font-size: 0.9em;
  }
}
```

## Services

- **[jupyter.explorer](docs/jupyter.explorer.md)** (`1.0.0`): provided to let another package hand over a kernel and an expression to show.
- **search.adapter** (`1.0.0`): provided to let the search panel query the grid on screen.
- **jupyter.kernel** (`^1.0.0`): consumed to read the active kernel and ask it to serialize a value.
- **autocomplete.watch-editor** (`^1.0.0`): consumed to offer completions in the expression field.

## Contributing

Got ideas to make this package better, found a bug, or want to help add new features? Just drop your thoughts on GitHub. Any feedback is welcome!
