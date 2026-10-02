const fs = require("node:fs");
const path = require("node:path");

let backend;
function backendCode() {
  return (backend ??= fs.readFileSync(path.join(__dirname, "explorer-query.py"), "utf8"));
}

function requestCode(request) {
  return `\nimport json as _jupyter_json\ntry:\n    _jupyter_reply = _jupyter_explorer_query(_jupyter_json.loads(${JSON.stringify(JSON.stringify(request))}))\nexcept Exception as _jupyter_error:\n    _jupyter_reply = {"error": str(_jupyter_error)}\nprint(_jupyter_json.dumps(_jupyter_reply, default=str))\ndel _jupyter_reply\n`;
}

function abortError() {
  const error = new Error("Explorer query cancelled");
  error.name = "AbortError";
  return error;
}

// Aborting suppresses the consumer and releases its promise. Kernel requests
// already running are deliberately not interrupted: that kernel may be shared.
function executeQuery(kernel, code, { signal } = {}) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve(value);
    };
    const abort = () => finish(abortError());
    if (signal?.aborted) return abort();
    signal?.addEventListener("abort", abort, { once: true });
    try {
      kernel.executeWatch(code, (result) => {
        if (settled) return;
        if (result.output_type === "stream" && result.name === "stdout") {
          stdout += Array.isArray(result.text) ? result.text.join("") : result.text || "";
        } else if (result.output_type === "error") {
          finish(new Error(`${result.ename || "Error"}: ${result.evalue || ""}`.trim()));
        } else if (result.output_type === "status" && result.execution_state === "idle") {
          try {
            const text = stdout.trim();
            const reply = JSON.parse(text.slice(text.lastIndexOf("\n") + 1));
            if (reply.error) finish(new Error(reply.error));
            else finish(null, reply);
          } catch {
            finish(
              new Error("The kernel did not return a complete data snapshot. Try refreshing."),
            );
          }
        }
      });
    } catch (error) {
      finish(error);
    }
  });
}

function fileExpression(filePath) {
  const filename = JSON.stringify(filePath);
  switch (path.extname(filePath).toLowerCase()) {
    case ".parquet":
      return `import pyarrow.parquet as _reader\n_reader.read_table(${filename})`;
    case ".feather":
      return `import pyarrow.feather as _reader\n_reader.read_table(${filename})`;
    case ".arrow":
    case ".ipc":
      return `import pyarrow as _pa\n_source = _pa.memory_map(${filename}, "r")\ntry:\n    _table = _pa.ipc.open_file(_source).read_all()\nexcept _pa.ArrowInvalid:\n    _source.seek(0)\n    _table = _pa.ipc.open_stream(_source).read_all()\n_table`;
    default:
      throw new Error("Choose a Parquet, Feather or Arrow IPC file.");
  }
}

module.exports = { backendCode, requestCode, executeQuery, fileExpression, abortError };
