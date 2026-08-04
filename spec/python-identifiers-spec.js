const { explorerStore, buildSerializerCode } = require("../lib/explorer-store");

// This panel drives a Python kernel by generating helper code around the user's
// expression. Every package rename ran a blanket sed that reached inside those
// Python strings: `_hydrogen_data_explorer` became `_jove-repl_data_explorer`
// (0c835ab) and then `_jupyter-repl_data_explorer` (fdd198d), because both new
// names carry a hyphen. A hyphen is not legal in a Python identifier, so every
// one of these helpers was a SyntaxError against a real kernel, and nothing
// caught it because no spec had ever looked at the generated source.
//
// The name carries a hyphen here too, so the guard travels with the code.

// Identifier positions in the emitted Python. Deliberately not a blanket ban on
// hyphens: the code contains string literals that legitimately hold one, such
// as the "<jupyter-explorer>" filename passed to compile().
const DEF = /^[ \t]*def[ \t]+([^\s(]+)[ \t]*\(/gm;
const DEL = /^[ \t]*del[ \t]+([^\s\n]+)/gm;
// Every token the rename could have touched, wherever it appears.
const OUR_HELPERS = /_{1,2}jupyter[A-Za-z0-9_-]*/g;

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

function namesAt(code, pattern) {
  return [...code.matchAll(pattern)].map((match) => match[1]);
}

function expectValidPythonIdentifiers(code) {
  const defs = namesAt(code, DEF);
  const dels = namesAt(code, DEL);
  const helpers = code.match(OUR_HELPERS) || [];

  // Guard the guard: a builder that stopped emitting a def would otherwise
  // pass every assertion below by having nothing to check.
  expect(defs.length).toBeGreaterThan(0);
  expect(helpers.length).toBeGreaterThan(0);

  for (const name of [...defs, ...dels, ...helpers]) {
    expect(name).toMatch(IDENTIFIER);
    expect(name).not.toContain("-");
  }
}

// A kernel that records the code it is asked to run, so the assertions read the
// exact string the panel sends over the wire, and keeps the callbacks so a spec
// can drive the exchange forward.
function recordingKernel(captured) {
  return {
    language: "python",
    displayName: "Python 3",
    executeWatch(code, onResults) {
      captured.push({ code, onResults });
    },
    execute(code, onResults) {
      captured.push({ code, onResults });
    },
  };
}

describe("generated Python helper code", () => {
  afterEach(() => {
    explorerStore.reset();
  });

  it("names the serializer with a valid identifier", () => {
    expectValidPythonIdentifiers(buildSerializerCode("df"));
  });

  it("sends the serializer valid identifiers for a real expression", () => {
    const captured = [];
    explorerStore.load(recordingKernel(captured), "df");

    expect(captured.length).toBe(1);
    expectValidPythonIdentifiers(captured[0].code);
    expect(captured[0].code).toContain("def _jupyter_explorer():");
  });
});
