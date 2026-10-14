// Authentic package usage. Run with lumine/script/demo.js; fixtures stay in demo/.
module.exports = {
  version: 1,
  dependencies: ["language-python", "jupyter-cells", "jupyter-repl"],
  viewport: { width: 1200, height: 760 },
  async before() {},
  async prepare(context) {
    const { lumine, state, fixture, open, profile } = context;
    state.jupyterData = require("path").join(profile, "jupyter");
    const kernel = require("path").join(state.jupyterData, "kernels", "lumine-demo");
    require("fs").mkdirSync(kernel, { recursive: true });
    require("fs").writeFileSync(
      require("path").join(kernel, "kernel.json"),
      JSON.stringify({
        argv: [
          process.env.LUMINE_DEMO_PYTHON || "python",
          "-m",
          "ipykernel_launcher",
          "-f",
          "{connection_file}",
        ],
        display_name: "Python 3",
        language: "python",
      }),
    );
    state.editor = await open("jupyter/signal.py");
    await lumine.project.setPaths([fixture("jupyter")]);
    process.env.JUPYTER_PATH = state.jupyterData;
    lumine.grammars.assignLanguageMode(state.editor.getBuffer(), "source.python");
    await state.editor.getBuffer().getLanguageMode().ready;
  },
  scenes: [
    {
      id: "scene-1",
      file: "demo.png",
      caption: "Inspect the values of a live NumPy array in the data grid.",
      timeout: 60000,
      async run(context) {
        const { lumine, state, waitFor } = context;
        {
          state.editor.selectAll();
          lumine.commands.dispatch(lumine.views.getView(state.editor), "jupyter-repl:run");
          await waitFor(
            () => document.body.innerText.includes("Mean amplitude: 0.42"),
            "step 1",
            60000,
          );
        }
        {
          state.editor.setCursorBufferPosition([9, 3]);
          lumine.views.getView(state.editor).focus();
          lumine.commands.dispatch(lumine.views.getView(state.editor), "jupyter-explorer:explore");
          await waitFor(
            () => document.querySelector(".jupyter-explorer")?.innerText.includes("0.2"),
            "step 2",
            60000,
          );
        }
        {
          await lumine.setWindowDimensions({ x: 80, y: 80, width: 900, height: 450 });
          [...document.querySelectorAll(".jupyter-explorer button")]
            .find((b) => b.textContent.trim() === "Grid")
            .click();
          state.editor.setCursorBufferPosition([9, 0]);
        }
      },
      ready() {
        return Boolean(
          document
            .querySelector(".jupyter-explorer .explorer-grid-view:not(.is-hidden)")
            ?.getBoundingClientRect().height > 0,
        );
      },
    },
    {
      id: "scene-2",
      file: "demo-2.png",
      caption: "Plot the same live array as a line chart.",
      timeout: 60000,
      async run(context) {
        const { lumine } = context;
        {
          await lumine.setWindowDimensions({ x: 80, y: 80, width: 1200, height: 760 });
          [...document.querySelectorAll(".jupyter-explorer button")]
            .find((b) => b.textContent.trim() === "Line")
            .click();
        }
      },
      ready() {
        return Boolean(
          Boolean(document.querySelector(".jupyter-explorer .js-plotly-plot")) &&
          document
            .querySelector(".jupyter-explorer .explorer-grid-view")
            ?.classList.contains("is-hidden"),
        );
      },
    },
  ],
  async cleanup() {},
};
