const WORKER_SOURCE_GLOBAL = "MP4AnalyzerWorkerSource";
const WORKER_MODULE_URL_GLOBAL = "MP4AnalyzerWorkerModuleUrl";
const FRAME_INTERNALS_WORKER_SOURCE_GLOBAL = "MP4FrameInternalsWorkerSource";
const FRAME_INTERNALS_WORKER_MODULE_URL_GLOBAL = "MP4FrameInternalsWorkerModuleUrl";
const FRAME_INTERNALS_WORKER_COUNT = 8;
const MAX_FRAME_INTERNALS_WORKER_RESTARTS = 1;

export function createAnalysisWorkerClient(options) {
  const workerModuleUrl = getWorkerModuleUrl();
  const frameInternalsWorkerModuleUrl = getFrameInternalsWorkerModuleUrl();
  const moduleWorkerFactory = workerModuleUrl && typeof Worker !== "undefined"
    ? () => new Worker(workerModuleUrl, { type: "module" })
    : null;
  const frameInternalsModuleWorkerFactory = frameInternalsWorkerModuleUrl && typeof Worker !== "undefined"
    ? () => new Worker(frameInternalsWorkerModuleUrl, { type: "module" })
    : null;
  if (moduleWorkerFactory) return new BrowserAnalysisWorkerClient(moduleWorkerFactory, frameInternalsModuleWorkerFactory);
  const workerSource = getInlineWorkerSource();
  const frameInternalsWorkerSource = getInlineFrameInternalsWorkerSource();
  if (workerSource && typeof Worker !== "undefined" && typeof Blob !== "undefined" && typeof URL !== "undefined") {
    return new BrowserAnalysisWorkerClient(
      createInlineWorkerFactory(workerSource),
      frameInternalsWorkerSource ? createInlineWorkerFactory(frameInternalsWorkerSource) : null
    );
  }
  return new DirectAnalysisWorkerClient(options.Core);
}

function createInlineWorkerFactory(workerSource) {
  return () => {
    const workerUrl = URL.createObjectURL(new Blob([workerSource], { type: "text/javascript" }));
    const worker = new Worker(workerUrl);
    URL.revokeObjectURL(workerUrl);
    return worker;
  };
}

function getInlineWorkerSource() {
  if (typeof window === "undefined") return "";
  return window[WORKER_SOURCE_GLOBAL] || "";
}

function getWorkerModuleUrl() {
  if (typeof window === "undefined") return "";
  return window[WORKER_MODULE_URL_GLOBAL] || "";
}

function getInlineFrameInternalsWorkerSource() {
  if (typeof window === "undefined") return "";
  return window[FRAME_INTERNALS_WORKER_SOURCE_GLOBAL] || "";
}

function getFrameInternalsWorkerModuleUrl() {
  if (typeof window === "undefined") return "";
  return window[FRAME_INTERNALS_WORKER_MODULE_URL_GLOBAL] || "";
}

class BrowserAnalysisWorkerClient {
  constructor(createWorker, createFrameInternalsWorker) {
    this.createWorker = createWorker;
    this.worker = null;
    this.nextRequestId = 1;
    this.pendingRequest = null;
    this.activeFile = null;
    this.frameInternalsSourceTracks = null;
    this.frameInternalsTrackDescriptors = null;
    this.frameInternalsWorkerPool = createFrameInternalsWorker
      ? new FrameInternalsWorkerPool(createFrameInternalsWorker, FRAME_INTERNALS_WORKER_COUNT)
      : null;
  }

  analyzeFile(file, options = {}) {
    this.activeFile = file;
    this.frameInternalsSourceTracks = null;
    this.frameInternalsTrackDescriptors = null;
    if (this.frameInternalsWorkerPool) this.frameInternalsWorkerPool.reset();
    return this.postRequest({
      type: "analyze",
      file,
      onProgress: options.onProgress,
      onPartialAnalysis: options.onPartialAnalysis
    });
  }

  scanFrameTypes(_analysis, options = {}) {
    return this.postRequest({
      type: "scanFrameTypes",
      onProgress: options.onProgress
    });
  }

  analyzeFrameInternals(_analysis, sampleRow) {
    if (this.frameInternalsWorkerPool) {
      try {
        const sourceTracks = _analysis && Array.isArray(_analysis.tracks) ? _analysis.tracks : [];
        if (this.frameInternalsSourceTracks !== sourceTracks) {
          this.frameInternalsSourceTracks = sourceTracks;
          this.frameInternalsTrackDescriptors = createFrameInternalsTrackDescriptors(sourceTracks);
        }
        this.frameInternalsWorkerPool.initialize(this.activeFile, this.frameInternalsTrackDescriptors);
        return this.frameInternalsWorkerPool.analyze(sampleRow);
      } catch (error) {
        return Promise.reject(error);
      }
    }
    return Promise.resolve({
      kind: "unavailable",
      complete: false,
      reason: "The dedicated eight-worker frame-internals pool is unavailable in this browser.",
      warnings: []
    });
  }

  cancel() {
    if (this.pendingRequest) {
      this.worker.postMessage({
        type: "cancel",
        requestId: this.pendingRequest.requestId
      });
    }
    if (this.frameInternalsWorkerPool) this.frameInternalsWorkerPool.cancelAll();
  }

  postRequest(options) {
    this.ensureWorker();
    const requestId = this.nextRequestId;
    this.nextRequestId += 1;
    return new Promise((resolve, reject) => {
      this.pendingRequest = {
        requestId,
        resolve,
        reject,
        onProgress: options.onProgress || function () {},
        onPartialAnalysis: options.onPartialAnalysis || function () {},
        analysisDraft: null,
        receivedSampleRows: 0
      };
      const message = { type: options.type, requestId };
      if (options.file) message.file = options.file;
      this.worker.postMessage(message);
    });
  }

  ensureWorker() {
    if (this.worker) return;
    this.worker = this.createWorker();
    this.worker.onmessage = (event) => this.handleMessage(event.data || {});
    this.worker.onerror = (event) => this.rejectPending(new Error(event.message || "Analysis worker failed."));
  }

  handleMessage(message) {
    const pendingRequest = this.pendingRequest;
    if (!pendingRequest || message.requestId !== pendingRequest.requestId) return;
    if (message.type === "progress") {
      pendingRequest.onProgress(message.label, message.percent);
      return;
    }
    if (message.type === "analysisStart") {
      pendingRequest.analysisDraft = message.analysis;
      pendingRequest.analysisDraft.sampleRows = new Array(message.sampleRowCount || 0);
      pendingRequest.receivedSampleRows = 0;
      return;
    }
    if (message.type === "sampleRows") {
      this.appendSampleRowBatch(pendingRequest, message);
      return;
    }
    if (message.type === "analysisComplete") {
      this.completeAnalysisMessage(pendingRequest, message);
      return;
    }
    if (message.type === "frameInternalsComplete") {
      this.pendingRequest = null;
      pendingRequest.resolve(message.result);
      return;
    }
    if (message.type === "error") {
      this.rejectPending(new Error(message.message || "Analysis worker failed."));
    }
  }

  appendSampleRowBatch(pendingRequest, message) {
    if (!pendingRequest.analysisDraft) return;
    const rows = message.rows || [];
    const startIndex = message.startIndex || 0;
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      pendingRequest.analysisDraft.sampleRows[startIndex + rowIndex] = rows[rowIndex];
    }
    pendingRequest.receivedSampleRows += rows.length;
  }

  completeAnalysisMessage(pendingRequest, message) {
    const analysis = pendingRequest.analysisDraft || { sampleRows: [] };
    analysis.sampleRows = analysis.sampleRows.filter((row) => row !== undefined);
    if (message.kind === "done") {
      this.pendingRequest = null;
      pendingRequest.resolve(analysis);
      return;
    }
    pendingRequest.onPartialAnalysis(analysis);
  }

  rejectPending(error) {
    if (!this.pendingRequest) return;
    const pendingRequest = this.pendingRequest;
    this.pendingRequest = null;
    pendingRequest.reject(error);
  }
}

class FrameInternalsWorkerPool {
  constructor(createWorker, workerCount) {
    this.createWorker = createWorker;
    this.workerCount = workerCount;
    this.workers = [];
    this.queue = [];
    this.nextRequestId = 1;
    this.generation = 0;
    this.activeFile = null;
    this.activeTracks = null;
    this.pendingTasks = new Map();
    this.failure = null;
  }

  initialize(file, tracks) {
    if (this.failure) throw this.failure;
    if (!file) throw new Error("A media source is required for frame internals parsing.");
    if (this.activeFile === file && this.activeTracks === tracks && this.workers.length === this.workerCount) return;
    this.cancelAll();
    this.activeFile = file;
    this.activeTracks = tracks;
    try {
      while (this.workers.length < this.workerCount) {
        this.workers.push(this.createWorkerSlot(this.workers.length, 0));
      }
      for (const slot of this.workers) this.initializeWorkerSlot(slot);
    } catch (error) {
      this.failPool(error);
      throw this.failure;
    }
  }

  analyze(sampleRow) {
    if (this.failure) return Promise.reject(this.failure);
    if (!this.activeFile || this.workers.length !== this.workerCount) {
      return Promise.reject(new Error("Frame internals worker pool is not initialized."));
    }
    const requestId = this.nextRequestId;
    this.nextRequestId += 1;
    return new Promise((resolve, reject) => {
      const task = {
        requestId,
        generation: this.generation,
        sampleRow: createFrameInternalsSampleDescriptor(sampleRow),
        resolve,
        reject
      };
      this.pendingTasks.set(requestId, task);
      this.queue.push(task);
      this.dispatch();
    });
  }

  createWorkerSlot(index, restartCount) {
    const slot = {
      index,
      worker: this.createWorker(),
      task: null,
      restartCount
    };
    slot.worker.onmessage = (event) => this.handleWorkerMessage(slot, event.data || {});
    slot.worker.onerror = (event) => this.handleWorkerError(slot, new Error(event.message || "Frame internals worker failed."));
    return slot;
  }

  initializeWorkerSlot(slot) {
    slot.worker.postMessage({
      type: "initialize",
      generation: this.generation,
      file: this.activeFile,
      tracks: Array.isArray(this.activeTracks) ? this.activeTracks : []
    });
  }

  dispatch() {
    for (const slot of this.workers) {
      if (slot.task || !this.queue.length) continue;
      const task = this.queue.shift();
      if (!this.pendingTasks.has(task.requestId) || task.generation !== this.generation) continue;
      slot.task = task;
      try {
        slot.worker.postMessage({
          type: "analyzeFrameInternals",
          requestId: task.requestId,
          generation: task.generation,
          sampleRow: task.sampleRow
        });
      } catch (error) {
        this.handleWorkerError(slot, error);
      }
    }
  }

  handleWorkerMessage(slot, message) {
    if (message.type === "initialized") return;
    const task = slot.task;
    if (!task || message.requestId !== task.requestId) return;
    slot.task = null;
    this.pendingTasks.delete(task.requestId);
    if (message.type === "frameInternalsComplete") task.resolve(message.result);
    else task.reject(new Error(message.message || "Frame internals worker failed."));
    this.dispatch();
  }

  handleWorkerError(slot, error) {
    if (this.workers[slot.index] !== slot) return;
    const interruptedTask = slot.task;
    slot.task = null;
    terminateWorker(slot.worker);
    if (slot.restartCount >= MAX_FRAME_INTERNALS_WORKER_RESTARTS) {
      this.failPool(error);
      return;
    }
    try {
      const replacementSlot = this.createWorkerSlot(slot.index, slot.restartCount + 1);
      this.workers[slot.index] = replacementSlot;
      if (this.activeFile) this.initializeWorkerSlot(replacementSlot);
      if (
        interruptedTask &&
        interruptedTask.generation === this.generation &&
        this.pendingTasks.has(interruptedTask.requestId)
      ) this.queue.unshift(interruptedTask);
      this.dispatch();
    } catch (replacementError) {
      this.failPool(replacementError);
    }
  }

  cancelAll() {
    const error = createFrameInternalsWorkerError(
      "FRAME_INTERNALS_CANCELLED",
      "Frame internals requests were cancelled."
    );
    for (const task of this.pendingTasks.values()) task.reject(error);
    this.pendingTasks.clear();
    this.queue = [];
    for (const slot of this.workers) terminateWorker(slot.worker);
    this.workers = [];
    this.activeFile = null;
    this.activeTracks = null;
    this.generation += 1;
  }

  reset() {
    this.cancelAll();
    this.failure = null;
  }

  failPool(error) {
    const failure = createFrameInternalsWorkerError(
      "FRAME_INTERNALS_WORKER_POOL_FAILED",
      "The eight-worker frame-internals pool was disabled after a repeated worker failure: " +
        (error && error.message ? error.message : String(error))
    );
    this.failure = failure;
    for (const task of this.pendingTasks.values()) task.reject(failure);
    this.pendingTasks.clear();
    this.queue = [];
    for (const slot of this.workers) terminateWorker(slot.worker);
    this.workers = [];
    this.activeFile = null;
    this.activeTracks = null;
  }
}

function createFrameInternalsTrackDescriptors(tracks) {
  if (!Array.isArray(tracks)) return [];
  return tracks.map((track) => ({
    trackId: track && track.trackId,
    handlerType: track && track.handlerType,
    codec: track && track.codec,
    codecConfig: track && track.codecConfig ? track.codecConfig : null,
    width: track && Number.isFinite(track.width) ? track.width : null,
    height: track && Number.isFinite(track.height) ? track.height : null,
    encodedWidth: track && Number.isFinite(track.encodedWidth) ? track.encodedWidth : null,
    encodedHeight: track && Number.isFinite(track.encodedHeight) ? track.encodedHeight : null,
    displayRotationDegrees: track && Number.isFinite(track.displayRotationDegrees)
      ? track.displayRotationDegrees
      : 0,
    pixelAspectRatioNumerator: track && Number.isFinite(track.pixelAspectRatioNumerator)
      ? track.pixelAspectRatioNumerator
      : null,
    pixelAspectRatioDenominator: track && Number.isFinite(track.pixelAspectRatioDenominator)
      ? track.pixelAspectRatioDenominator
      : null
  }));
}

function createFrameInternalsSampleDescriptor(sampleRow) {
  return {
    trackId: sampleRow && sampleRow.trackId,
    sampleIndex: sampleRow && sampleRow.sampleIndex,
    offset: sampleRow && sampleRow.offset,
    size: sampleRow && sampleRow.size,
    frameType: sampleRow && sampleRow.frameType
  };
}

function createFrameInternalsWorkerError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function terminateWorker(worker) {
  if (worker && typeof worker.terminate === "function") worker.terminate();
}

class DirectAnalysisWorkerClient {
  constructor(Core) {
    this.Core = Core;
    this.activeReader = null;
  }

  async analyzeFile(file, options = {}) {
    this.activeReader = null;
    const analysis = await this.Core.analyzeFile(file, {
      onProgress: options.onProgress,
      onReader: (reader) => {
        this.activeReader = reader;
      }
    });
    if (options.onPartialAnalysis) options.onPartialAnalysis(analysis);
    return analysis;
  }

  async scanFrameTypes(analysis, options = {}) {
    this.activeReader = analysis && analysis.reader ? analysis.reader : this.activeReader;
    await this.Core.scanFrameTypes(analysis, {
      onProgress: options.onProgress
    });
    return analysis;
  }

  async analyzeFrameInternals(analysis, sampleRow) {
    if (typeof window !== "undefined") {
      return {
        kind: "unavailable",
        complete: false,
        reason: "Background frame-internals workers are unavailable in this browser.",
        warnings: []
      };
    }
    return this.Core.analyzeFrameInternals(analysis, sampleRow);
  }

  cancel() {
    if (this.activeReader && typeof this.activeReader.cancel === "function") this.activeReader.cancel();
  }
}

export {
  FRAME_INTERNALS_WORKER_COUNT,
  FrameInternalsWorkerPool,
  createFrameInternalsSampleDescriptor,
  createFrameInternalsTrackDescriptors
};
