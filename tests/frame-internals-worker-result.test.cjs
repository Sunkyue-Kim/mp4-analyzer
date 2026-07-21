const test = require("node:test");
const assert = require("node:assert/strict");
const { createSourceModuleLoader } = require("./helpers/source-module-loader.cjs");

test("worker preparation projects the model and packs hover data into transferables", async () => {
  const loader = await createSourceModuleLoader();
  const workerResultModule = await loader.import("src/js/ui/frame-internals-worker-result.js");
  const frameInternalsMap = await loader.import("src/js/ui/frame-internals-map.js");
  const frameInternalsView = await loader.import("src/js/ui/frame-internals-view.js");
  const sampleRow = { trackId: 1, sampleIndex: 7, size: 100, frameType: "I" };
  const track = {
    trackId: 1,
    handlerType: "vide",
    codec: "avc1",
    codecDescriptor: "avc",
    width: 32,
    height: 16
  };
  const parsedFrameInternals = {
    complete: true,
    granularity: "partition-tree",
    sampleBits: 800,
    attributedBits: 600,
    overheadBits: 200,
    unitName: "macroblock",
    unitWidth: 16,
    unitHeight: 16,
    columns: 2,
    rows: 1,
    roots: [
      {
        id: "매크로블록-0",
        left: 0,
        top: 0,
        width: 16,
        height: 16,
        type: "I_16x16",
        ownBits: 10,
        subtreeBits: 310,
        children: [
          { id: "매크로블록-0-a", left: 0, top: 0, width: 8, height: 16, type: "partition", syntaxBits: 200 },
          { id: "매크로블록-0-b", left: 8, top: 0, width: 8, height: 16, type: "partition", syntaxBits: 100 }
        ]
      },
      { id: "매크로블록-1", left: 16, top: 0, width: 16, height: 16, type: "I_16x16", syntaxBits: 290 }
    ]
  };

  const result = workerResultModule.prepareFrameInternalsWorkerResult(sampleRow, track, {
    parsedFrameInternals
  });
  assert.equal(result.model.kind, "video-grid");
  assert.equal(result.model.displayCellCount, 3);
  assert.equal("roots" in result.model, false);
  assert.equal("cells" in result.model, false);
  assert.equal(result.pathGroups.reduce((total, group) => total + group.cellCount, 0), 3);
  assert.equal(result.spatialIndex.kind, "packed-frame-internals-spatial-index");
  assert.equal("cells" in result.spatialIndex, false);
  assert.equal(Object.prototype.toString.call(result.spatialIndex.numericValues), "[object Float64Array]");
  assert.equal(Object.prototype.toString.call(result.spatialIndex.identifierData.encodedBytes), "[object Uint8Array]");
  assert.equal(Object.prototype.toString.call(result.spatialIndex.bucketOffsets), "[object Uint32Array]");
  assert.ok(result.transferables.length >= 7);
  assert.equal(new Set(result.transferables).size, result.transferables.length);
  assert.ok(result.transferables.every((transferable) => Object.prototype.toString.call(transferable) === "[object ArrayBuffer]"));
  assert.equal(
    workerResultModule.getFrameInternalsWorkerResultTransferables(result).length,
    result.transferables.length
  );

  const restoredCell = frameInternalsMap.findFrameInternalsCell(result.spatialIndex, 4, 8);
  assert.equal(restoredCell.id, "매크로블록-0-a");
  assert.equal(restoredCell.partitionMode, "partition");
  assert.equal(restoredCell.subtreeBits, 200);
  assert.equal(restoredCell.children, undefined);
  assert.equal(frameInternalsMap.findFrameInternalsCell(result.spatialIndex, -1, 8), null);

  const renderedHtml = frameInternalsView.renderVideoFrameInternals(result.model, {
    pathGroups: result.pathGroups
  });
  assert.match(renderedHtml, /data-block-count="3"/);
  assert.match(renderedHtml, new RegExp('data-path-count="' + result.pathGroups.length + '"'));
  assert.equal((renderedHtml.match(/<path class="block-cell block-cell-path/g) || []).length, result.pathGroups.length);
  const modelEmbeddedPathGroupsHtml = frameInternalsView.renderVideoFrameInternals({
    ...result.model,
    pathGroups: result.pathGroups
  });
  assert.match(modelEmbeddedPathGroupsHtml, /data-block-count="3"/);

  const transferredResult = structuredClone(result, { transfer: result.transferables });
  assert.equal(result.spatialIndex.numericValues.byteLength, 0);
  assert.equal(
    frameInternalsMap.findFrameInternalsCell(transferredResult.spatialIndex, 4, 8).id,
    "매크로블록-0-a"
  );
});

test("worker map preparation limits every SVG path and lazily restores one packed cell", async () => {
  const loader = await createSourceModuleLoader();
  const workerResultModule = await loader.import("src/js/ui/frame-internals-worker-result.js");
  const frameInternalsMap = await loader.import("src/js/ui/frame-internals-map.js");
  const cellCount = 5000;
  const cells = Array.from({ length: cellCount }, (_, cellIndex) => ({
    id: "cell-" + cellIndex,
    type: "partition",
    partitionMode: "split",
    pixelLeft: cellIndex,
    pixelTop: 0,
    pixelRight: cellIndex + 1,
    pixelBottom: 1,
    displayPixelLeft: cellIndex,
    displayPixelTop: 0,
    displayPixelRight: cellIndex + 1,
    displayPixelBottom: 1,
    codedBlockWidth: 1,
    codedBlockHeight: 1,
    depth: 2,
    ownBits: null,
    subtreeBits: cellIndex,
    aggregatedDescendantCount: 0,
    globalPercentile: 0.5,
    intensity: 0.86,
    color: { red: 28, green: 164, blue: 135 }
  }));
  const model = {
    kind: "video-grid",
    codecFamily: "AVC / H.264",
    frameType: "I",
    mediaWidth: cellCount,
    mediaHeight: 1,
    displayCellCount: cellCount,
    roots: [{ id: "raw-root", children: cells }],
    cells
  };

  const result = workerResultModule.prepareFrameInternalsModelForTransfer(model);
  assert.equal(result.pathGroups.length, 3);
  assert.ok(result.pathGroups.every((group) => group.cellCount <= frameInternalsMap.FRAME_INTERNALS_PATH_CELL_LIMIT));
  assert.equal(result.pathGroups.reduce((total, group) => total + group.cellCount, 0), cellCount);
  const restoredCell = frameInternalsMap.findFrameInternalsCell(result.spatialIndex, 4097.5, 0.5);
  assert.equal(restoredCell.id, "cell-4097");
  assert.equal(restoredCell.ownBits, null);
  assert.equal(restoredCell.subtreeBits, 4097);
  assert.equal(restoredCell.attributedBitsPerPixel, 4097);
  assert.equal(result.model.roots, undefined);
  assert.equal(result.model.cells, undefined);

  const gapSpatialIndex = frameInternalsMap.createPackedFrameInternalsSpatialIndex({
    mediaWidth: 20,
    mediaHeight: 20,
    cells: [{
      id: 0,
      pixelLeft: 0,
      pixelTop: 0,
      pixelRight: 10,
      pixelBottom: 10,
      blockWidth: 10,
      blockHeight: 10
    }]
  });
  assert.equal(frameInternalsMap.findFrameInternalsCell(gapSpatialIndex, 5, 5).id, "0");
  assert.equal(frameInternalsMap.findFrameInternalsCell(gapSpatialIndex, 15, 15), null);
});
