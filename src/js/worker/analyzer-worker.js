import { analyzeFileWithRegisteredContainer } from "../core/containers/registry.js";
import { scanFrameTypes } from "../core/codecs/frame-scanner.js";

const SAMPLE_ROW_BATCH_SIZE = 2000;

let activeAnalysis = null;
let activeReader = null;
let activeRequestId = 0;

self.onmessage = (event) => {
  const message = event.data || {};
  if (message.type === "analyze") {
    runAnalyzeRequest(message);
  } else if (message.type === "scanFrameTypes") {
    runScanFrameTypesRequest(message);
  } else if (message.type === "cancel") {
    cancelActiveRequest(message.requestId);
  }
};

async function runAnalyzeRequest(message) {
  const requestId = message.requestId;
  activeRequestId = requestId;
  activeAnalysis = null;
  activeReader = null;
  try {
    const analysis = await analyzeFileWithRegisteredContainer(message.file, {
      onProgress: (label, percent) => postProgress(requestId, label, percent),
      onReader: (reader) => {
        activeReader = reader;
      }
    });
    ensureRequestIsCurrent(requestId);
    activeAnalysis = analysis;
    await postAnalysisResult({
      requestId,
      kind: "done",
      analysis,
      metadata: { scanned: false }
    });
  } catch (error) {
    postError(requestId, error);
  }
}

async function runScanFrameTypesRequest(message) {
  const requestId = message.requestId;
  activeRequestId = requestId;
  try {
    if (!activeAnalysis) throw new Error("No active analysis to scan.");
    activeReader = activeAnalysis.reader || activeReader;
    await scanFrameTypes(activeAnalysis, {
      onProgress: (label, percent) => postProgress(requestId, label, percent)
    });
    ensureRequestIsCurrent(requestId);
    await postAnalysisResult({
      requestId,
      kind: "done",
      analysis: activeAnalysis,
      metadata: { scanned: true }
    });
  } catch (error) {
    postError(requestId, error);
  }
}

function cancelActiveRequest(requestId) {
  if (requestId && activeRequestId && requestId !== activeRequestId) return;
  if (activeReader && typeof activeReader.cancel === "function") activeReader.cancel();
}

function ensureRequestIsCurrent(requestId) {
  if (activeRequestId && requestId !== activeRequestId) {
    throw new Error("Analysis cancelled.");
  }
}

function postProgress(requestId, label, percent) {
  self.postMessage({
    type: "progress",
    requestId,
    label,
    percent
  });
}

async function postAnalysisResult({ requestId, kind, analysis, metadata }) {
  const sampleRows = analysis.sampleRows || [];
  self.postMessage({
    type: "analysisStart",
    requestId,
    kind,
    analysis: sanitizeAnalysis(analysis),
    sampleRowCount: sampleRows.length
  });
  for (let startIndex = 0; startIndex < sampleRows.length; startIndex += SAMPLE_ROW_BATCH_SIZE) {
    ensureRequestIsCurrent(requestId);
    self.postMessage({
      type: "sampleRows",
      requestId,
      kind,
      startIndex,
      rows: sampleRows.slice(startIndex, startIndex + SAMPLE_ROW_BATCH_SIZE)
    });
    await yieldToMessageLoop();
  }
  self.postMessage({
    type: "analysisComplete",
    requestId,
    kind,
    metadata: metadata || {}
  });
}

function sanitizeAnalysis(analysis) {
  return {
    file: analysis.file,
    topBoxes: analysis.topBoxes,
    allBoxes: analysis.allBoxes,
    tracks: analysis.tracks,
    sampleRows: [],
    warnings: analysis.warnings,
    container: analysis.container
  };
}

function postError(requestId, error) {
  self.postMessage({
    type: "error",
    requestId,
    message: error && error.message ? error.message : String(error)
  });
}

function yieldToMessageLoop() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
