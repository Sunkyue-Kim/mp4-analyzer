import { isoBmffContainer } from "./isobmff/analyzer.js";

export const CONTAINER_ANALYZERS = [isoBmffContainer];

export async function analyzeFileWithRegisteredContainer(file, options) {
  for (const analyzer of CONTAINER_ANALYZERS) {
    if (await analyzer.canAnalyze(file, options)) {
      const analysis = await analyzer.analyzeFile(file, options);
      analysis.container = { id: analyzer.id, label: analyzer.label };
      return analysis;
    }
  }
  throw new Error("No registered container analyzer accepted this file.");
}
