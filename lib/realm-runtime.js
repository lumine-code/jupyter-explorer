function loadPlotlyFor(value) {
  const domDocument = value?.ownerDocument || value;
  if (!domDocument?.defaultView || domDocument === globalThis.document) {
    return Promise.resolve(require("plotly.js-dist"));
  }
  return lumine.dom.loadScript(domDocument, require.resolve("plotly.js-dist"), {
    global: "Plotly",
  });
}

module.exports = { loadPlotlyFor };
