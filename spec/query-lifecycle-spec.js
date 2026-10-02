const { execFileSync } = require("node:child_process");
const { ExplorerStore, buildSerializerCode } = require("../lib/explorer-store");

function kernel() {
  const requests = [];
  return {
    language: "python",
    requests,
    executeWatch: (code, receive) => requests.push({ code, receive }),
  };
}

function finish(request, value) {
  request.receive({ output_type: "stream", name: "stdout", text: JSON.stringify(value) + "\n" });
  request.receive({ output_type: "status", execution_state: "idle" });
}

describe("explorer query lifetime", () => {
  it("assembles a large snapshot split across arbitrary stdout chunks", () => {
    const store = new ExplorerStore();
    const source = kernel();
    store.load(source, "data");
    const payload = {
      kind: "list",
      columns: ["value"],
      rows: Array.from({ length: 1000 }, (_, index) => [index]),
    };
    const json = JSON.stringify(payload) + "\n";
    for (let offset = 0; offset < json.length; offset += 137) {
      source.requests[0].receive({
        output_type: "stream",
        name: "stdout",
        text: json.slice(offset, offset + 137),
      });
    }
    expect(store.loading).toBe(true);
    source.requests[0].receive({ output_type: "status", execution_state: "idle" });

    expect(store.payload).toEqual(payload);
    expect(store.loading).toBe(false);
  });

  it("keeps the newest expression when an older query completes later", () => {
    const store = new ExplorerStore();
    const source = kernel();
    store.load(source, "old");
    store.loadExpression("new");
    finish(source.requests[1], { kind: "scalar", repr: "new result" });
    finish(source.requests[0], { kind: "scalar", repr: "old result" });

    expect(store.payload.repr).toBe("new result");
  });

  it("ignores replies after reset or a kernel switch", () => {
    const store = new ExplorerStore();
    const previous = kernel();
    store.load(previous, "old");
    store.reset();
    finish(previous.requests[0], { kind: "scalar", repr: "late" });
    expect(store.payload).toBeNull();

    store.load(previous, "old");
    store.adoptKernel(kernel());
    finish(previous.requests[1], { kind: "scalar", repr: "late" });
    expect(store.payload).toBeNull();
  });

  it("reports incomplete output and releases loading instead of waiting forever", () => {
    const store = new ExplorerStore();
    const source = kernel();
    store.load(source, "data");
    source.requests[0].receive({ output_type: "stream", name: "stdout", text: "{partial" });
    source.requests[0].receive({ output_type: "status", execution_state: "idle" });

    expect(store.loading).toBe(false);
    expect(store.error).toContain("complete data snapshot");
  });

  it("contains synchronous transport errors", () => {
    const store = new ExplorerStore();
    store.load(
      {
        language: "python",
        executeWatch() {
          throw new Error("connection gone");
        },
      },
      "data",
    );

    expect(store.loading).toBe(false);
    expect(store.error).toBe("connection gone");
  });

  it("accepts a snapshot after the evaluated expression prints other output", () => {
    const store = new ExplorerStore();
    const source = kernel();
    store.load(source, "print('loading'); data");
    source.requests[0].receive({ output_type: "stream", name: "stdout", text: "loading\n" });
    finish(source.requests[0], { kind: "scalar", repr: "42" });

    expect(store.payload.repr).toBe("42");
  });

  it("requests full statistics only when the summary view is selected", () => {
    const store = new ExplorerStore();
    const source = kernel();
    store.load(source, "data");
    expect(source.requests[0].code).toContain("INCLUDE_SUMMARY = False");
    finish(source.requests[0], { kind: "dataframe", columns: ["value"], rows: [[1]] });
    store.setViewMode("summary");
    expect(source.requests[1].code).toContain("INCLUDE_SUMMARY = True");
  });
});

function findPython() {
  for (const candidate of ["python", "python3"]) {
    try {
      if (
        /Python 3/.test(
          execFileSync(candidate, ["--version"], { encoding: "utf8", timeout: 10000 }),
        )
      )
        return candidate;
    } catch {}
  }
  return null;
}

const python = findPython();
const pythonSuite = python ? describe : () => {};

function serialize(setup, expression, includeSummary = false) {
  const harness = `import io, json, contextlib\n${setup}\nbuf = io.StringIO()\nwith contextlib.redirect_stdout(buf):\n    exec(${JSON.stringify(buildSerializerCode(expression, includeSummary))})\nprint(buf.getvalue())\n`;
  return JSON.parse(execFileSync(python, ["-c", harness], { encoding: "utf8", timeout: 30000 }));
}

pythonSuite("bounded Python explorer serialization", () => {
  it("slices a tuple before iterating instead of materializing the whole input", () => {
    const payload = serialize(
      "class BoundedTuple(tuple):\n    def __iter__(self):\n        raise RuntimeError('whole tuple iteration')\ndata = BoundedTuple(range(2000))",
      "data",
    );

    expect(payload.kind).toBe("list");
    expect(payload.rows.length).toBe(1000);
    expect(payload.total_rows).toBe(2000);
  });

  it("stops dictionary iteration at the displayed row limit", () => {
    const payload = serialize(
      "class BoundedDict(dict):\n    def items(self):\n        for i in range(2000):\n            if i >= 1000:\n                raise RuntimeError('read beyond displayed rows')\n            yield i, i\ndata = BoundedDict.fromkeys(range(2000))",
      "data",
    );

    expect(payload.kind).toBe("dict");
    expect(payload.rows.length).toBe(1000);
    expect(payload.total_rows).toBe(2000);
  });

  it("keeps duplicate dataframe columns aligned with their displayed rows", () => {
    try {
      execFileSync(python, ["-c", "import pandas"], { timeout: 10000 });
    } catch {
      pending("pandas is not installed in the available Python interpreter");
      return;
    }
    const payload = serialize(
      "import pandas as pd\ndata = pd.DataFrame([[1,2]], columns=['value','value'])",
      "data",
    );

    expect(payload.kind).toBe("dataframe");
    expect(payload.columns).toEqual(["value", "value"]);
    expect(payload.rows).toEqual([[1, 2]]);
    expect(payload.summary).toBeUndefined();
  });

  it("keeps full-data statistics available when explicitly requested", () => {
    try {
      execFileSync(python, ["-c", "import pandas"], { timeout: 10000 });
    } catch {
      pending("pandas is not installed in the available Python interpreter");
      return;
    }
    const payload = serialize(
      "import pandas as pd\ndata = pd.DataFrame({'value': range(1500)})",
      "data",
      true,
    );

    expect(payload.rows.length).toBe(1000);
    expect(payload.summary.rows[0][payload.summary.stats.indexOf("count")]).toBe(1500);
    expect(payload.summary.rows[0][payload.summary.stats.indexOf("mean")]).toBe(749.5);
  });

  it("renders zero-dimensional NumPy arrays as scalar values", () => {
    try {
      execFileSync(python, ["-c", "import numpy"], { timeout: 10000 });
    } catch {
      pending("NumPy is not installed in the available Python interpreter");
      return;
    }
    const payload = serialize("import numpy as np\ndata = np.array(42)", "data");

    expect(payload.kind).toBe("scalar");
    expect(payload.repr).toBe("42");
  });
});
