# jupyter.explorer

Hand a kernel and an expression to the Data Explorer and let it open on the result.

|             |                                                      |
| ----------- | ---------------------------------------------------- |
| Version     | `1.0.0` provided, `^1.0.0` consumed                  |
| Provided by | `jupyter-explorer`                                   |
| Consumed by | any package that can name something worth looking at |
| Owner       | `jupyter-explorer`                                   |

This exists so a package that already knows about a value — a variables panel listing a kernel's namespace, a debugger stopped at a frame — can show it without owning a grid of its own, and without reaching into this package's store.

## Registration

```json
"consumedServices": {
  "jupyter.explorer": {
    "versions": {
      "^1.0.0": "consumeDataExplorer"
    }
  }
}
```

## Contract

```ts
type DataExplorerService = {
  explore(kernel: JupyterKernel, expression: string): Promise<object>;
};
```

Required members:

| Member                        | Description                                                                                                 |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `explore(kernel, expression)` | Show `expression` as evaluated by `kernel`, opening the panel if it is closed. Resolves with the pane item. |

`kernel` is a `JupyterKernel` exactly as `jupyter.kernel` handed it over — see that service's contract. Passing anything else is an error; this package does not look kernels up for you.

## Minimal example

```js
const { Disposable } = require("atom");

module.exports = {
  consumeDataExplorer(service) {
    this.dataExplorer = service;
    return new Disposable(() => {
      this.dataExplorer = null;
    });
  },

  explore(kernel, name) {
    // Absent service means the package is not installed; offer nothing rather
    // than failing, since this is a convenience, not a dependency.
    this.dataExplorer?.explore(kernel, name);
  },
};
```

## Behavior

`explore` replaces whatever the panel was showing — there is one panel, not one per expression.

The panel evaluates the expression through the kernel, so it runs the user's code. Only pass an expression the user asked for.

Only Python kernels are supported today; another language resolves with the panel showing an explanation rather than throwing.

## Teardown

Return a `Disposable` that drops your reference. The panel belongs to `jupyter-explorer` — do not close it because your own panel is closing; the user may still be reading it.

## Versioning

`1.0.0` provided, `^1.0.0` consumed. A change that breaks this shape gets a new service name rather than a new major version, and both sides move in the same release.
