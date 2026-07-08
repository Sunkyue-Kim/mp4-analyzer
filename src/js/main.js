import { Core } from "./core/analyzer-core.js";
import { startUserInterface } from "./ui/analyzer-ui.js";

if (typeof window !== "undefined") {
  window.MP4AnalyzerCore = Core;
}

startUserInterface(Core);
