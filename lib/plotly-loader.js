function createPlotlyLoader(importPlotly) {
  let pending;
  return () => {
    if (!pending) {
      pending = Promise.resolve()
        .then(importPlotly)
        .then((namespace) => namespace.default ?? namespace)
        .catch((error) => {
          pending = null;
          throw error;
        });
    }
    return pending;
  };
}

const loadPlotly = createPlotlyLoader(() => import("plotly.js-dist"));

module.exports = { createPlotlyLoader, loadPlotly };
