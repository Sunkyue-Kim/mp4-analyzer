import { startBootstrapUserInterface } from "./ui/bootstrap-ui.js";

const loadAnalyzerRuntime = (options) => import("./runtime.js").then((module) => module.startAnalyzerRuntime(options));

if (typeof window !== "undefined") {
  window.MP4AnalyzerLoadRuntime = loadAnalyzerRuntime;
}

startBootstrapUserInterface({
  loadRuntime: loadAnalyzerRuntime
});
