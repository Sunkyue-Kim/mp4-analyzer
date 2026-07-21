import {
  buildFrameInternalsModel
} from "../core/codecs/frame-internals.js";
import {
  buildFrameInternalsPathGroups,
  createPackedFrameInternalsSpatialIndex,
  getPackedFrameInternalsSpatialIndexTransferables
} from "./frame-internals-map.js";

export function prepareFrameInternalsWorkerResult(sampleRow, track, options = {}) {
  const {
    pathGroupOptions,
    spatialIndexOptions,
    ...modelOptions
  } = options;
  const model = buildFrameInternalsModel(sampleRow, track, modelOptions);
  return prepareFrameInternalsModelForTransfer(model, {
    pathGroupOptions,
    spatialIndexOptions
  });
}

export function prepareFrameInternalsModelForTransfer(model, options = {}) {
  if (!model || model.kind !== "video-grid") {
    return createPreparedResult(model || null, [], null);
  }
  const cells = Array.isArray(model.cells) ? model.cells : [];
  const pathGroups = buildFrameInternalsPathGroups(cells, options.pathGroupOptions);
  const spatialIndex = createPackedFrameInternalsSpatialIndex(
    model,
    options.spatialIndexOptions
  );
  const projectedModel = projectFrameInternalsModel(model, cells.length);
  return createPreparedResult(projectedModel, pathGroups, spatialIndex);
}

export function getFrameInternalsWorkerResultTransferables(result) {
  const transferables = getPackedFrameInternalsSpatialIndexTransferables(
    result && result.spatialIndex
  );
  return Array.from(new Set(transferables));
}

function createPreparedResult(model, pathGroups, spatialIndex) {
  const result = {
    version: 1,
    model,
    pathGroups,
    spatialIndex,
    transferables: []
  };
  result.transferables = getFrameInternalsWorkerResultTransferables(result);
  return result;
}

function projectFrameInternalsModel(model, displayCellCount) {
  const {
    roots: _roots,
    cells: _cells,
    ...projectedModel
  } = model;
  return {
    ...projectedModel,
    displayCellCount
  };
}
