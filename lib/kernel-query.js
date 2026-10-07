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
async function executeQuery(kernel, code, { signal } = {}) {
  const generation = kernel.generation;
  const request = kernel.request({
    type: "execute",
    purpose: "query",
    code,
    signal,
    timeoutMs: 10000,
  });
  try {
    const result = await request.done;
    if (signal?.aborted || result.status === "cancelled" || kernel.generation !== generation) {
      throw abortError();
    }
    if (result.status !== "ok") {
      throw new Error(
        result.error
          ? `${result.error.ename || "Error"}: ${result.error.evalue || ""}`.trim()
          : `Explorer query ${result.status}.`,
      );
    }
    const stdout = result.outputs
      .filter((output) => output.output_type === "stream" && output.name === "stdout")
      .map((output) => (Array.isArray(output.text) ? output.text.join("") : output.text || ""))
      .join("")
      .trim();
    let reply;
    try {
      reply = JSON.parse(stdout.slice(stdout.lastIndexOf("\n") + 1));
    } catch {
      throw new Error("The kernel did not return a complete data snapshot. Try refreshing.");
    }
    if (reply.error) throw new Error(reply.error);
    return reply;
  } finally {
    request.dispose();
  }
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
