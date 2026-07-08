import { Core } from "./core/analyzer-core.js";
import { startUserInterface } from "./ui/analyzer-ui.js";

let runtimeApi = null;

function startAnalyzerRuntime(options = {}) {
  if (runtimeApi) return runtimeApi;
  if (typeof window !== "undefined") {
    window.MP4AnalyzerCore = Core;
  }
  runtimeApi = startUserInterface(Core, options) || createHeadlessRuntimeApi();
  if (typeof window !== "undefined") {
    window.MP4AnalyzerDevTools = runtimeApi;
  }
  return runtimeApi;
}

function createHeadlessRuntimeApi() {
  return {
    runSmokeTests: () => Core.runParserSelfTests(),
    analyzeFile: (file, options) => Core.analyzeFile(file, options),
    scanFrameTypes: (analysis, options) => Core.scanFrameTypes(analysis, options)
  };
}

export { startAnalyzerRuntime };
