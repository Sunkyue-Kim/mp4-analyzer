import { createRangeReader } from "../core/common/binary.js";
import {
  analyzeFrameInternals,
  findTrackForSample
} from "../core/codecs/frame-internals-analyzer.js";
import { prepareFrameInternalsWorkerResult } from "../ui/frame-internals-worker-result.js";

let activeAnalysis = null;
let activeGeneration = 0;

self.onmessage = (event) => {
  const message = event.data || {};
  if (message.type === "initialize") {
    initializeWorker(message);
  } else if (message.type === "analyzeFrameInternals") {
    runFrameInternalsRequest(message);
  } else if (message.type === "cancel") {
    cancelActiveReader(message.generation);
  }
};

function initializeWorker(message) {
  cancelActiveReader();
  activeGeneration = Number(message.generation) || 0;
  activeAnalysis = {
    reader: createRangeReader(message.file),
    tracks: Array.isArray(message.tracks) ? message.tracks : []
  };
  self.postMessage({
    type: "initialized",
    generation: activeGeneration
  });
}

async function runFrameInternalsRequest(message) {
  const requestId = message.requestId;
  const generation = Number(message.generation) || 0;
  try {
    if (!activeAnalysis || generation !== activeGeneration) {
      throw new Error("Frame internals worker is not initialized for this media source.");
    }
    const parsedFrameInternals = await analyzeFrameInternals(activeAnalysis, message.sampleRow);
    if (generation !== activeGeneration) throw new Error("Frame internals request was superseded.");
    const track = findTrackForSample(activeAnalysis, message.sampleRow);
    const result = prepareFrameInternalsWorkerResult(message.sampleRow, track, {
      parsedFrameInternals
    });
    const transferables = result.transferables;
    delete result.transferables;
    self.postMessage({
      type: "frameInternalsComplete",
      requestId,
      generation,
      result
    }, transferables);
  } catch (error) {
    self.postMessage({
      type: "frameInternalsError",
      requestId,
      generation,
      message: error && error.message ? error.message : String(error)
    });
  }
}

function cancelActiveReader(generation) {
  if (generation !== undefined && Number(generation) !== activeGeneration) return;
  if (activeAnalysis && activeAnalysis.reader && typeof activeAnalysis.reader.cancel === "function") {
    activeAnalysis.reader.cancel();
  }
  activeAnalysis = null;
}
