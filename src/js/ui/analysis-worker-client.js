const WORKER_SOURCE_GLOBAL = "MP4AnalyzerWorkerSource";

export function createAnalysisWorkerClient(options) {
  const workerSource = getInlineWorkerSource();
  if (workerSource && typeof Worker !== "undefined" && typeof Blob !== "undefined" && typeof URL !== "undefined") {
    return new BlobAnalysisWorkerClient(workerSource);
  }
  return new DirectAnalysisWorkerClient(options.Core);
}

function getInlineWorkerSource() {
  if (typeof window === "undefined") return "";
  return window[WORKER_SOURCE_GLOBAL] || "";
}

class BlobAnalysisWorkerClient {
  constructor(workerSource) {
    this.workerSource = workerSource;
    this.worker = null;
    this.nextRequestId = 1;
    this.pendingRequest = null;
  }

  analyzeFile(file, options = {}) {
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

  cancel() {
    if (!this.pendingRequest) return;
    this.worker.postMessage({
      type: "cancel",
      requestId: this.pendingRequest.requestId
    });
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
    const workerUrl = URL.createObjectURL(new Blob([this.workerSource], { type: "text/javascript" }));
    this.worker = new Worker(workerUrl);
    URL.revokeObjectURL(workerUrl);
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

  cancel() {
    if (this.activeReader && typeof this.activeReader.cancel === "function") this.activeReader.cancel();
  }
}
