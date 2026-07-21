const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { createSourceModuleLoader } = require("./helpers/source-module-loader.cjs");

let fixturePromise;

async function loadVp9Fixture() {
  if (!fixturePromise) {
    fixturePromise = (async () => {
      const loader = await createSourceModuleLoader();
      const { Core } = await loader.import("src/js/core/analyzer-core.js");
      const vp9 = await loader.import("src/js/core/codecs/video/vp9-frame-internals.js");
      const vp9Adapter = await loader.import("src/js/core/codecs/video/vp9.js");
      const fileName = "webm_vp9_opus.webm";
      const fileBytes = fs.readFileSync(path.join(
        __dirname,
        "..",
        "validation",
        "generated",
        fileName
      ));
      const file = new Blob([fileBytes], { type: "video/webm" });
      Object.defineProperty(file, "name", { value: fileName });
      const analysis = await Core.analyzeFile(file, {});
      const track = analysis.tracks.find((candidate) => candidate.handlerType === "vide");
      assert.ok(track, "the VP9 fixture must expose a video track");
      const sampleRows = analysis.sampleRows.filter(
        (row) => String(row.trackId) === String(track.trackId)
      );
      return { analysis, Core, sampleRows, track, vp9, vp9Adapter };
    })();
  }
  return fixturePromise;
}

async function readSample(fixture, sampleIndex) {
  const sampleRow = fixture.sampleRows.find((row) => row.sampleIndex === sampleIndex);
  assert.ok(sampleRow, "the VP9 fixture must contain sample " + sampleIndex);
  const sampleBytes = typeof fixture.analysis.reader.readExactRange === "function"
    ? await fixture.analysis.reader.readExactRange(BigInt(sampleRow.offset), BigInt(sampleRow.size))
    : await fixture.analysis.reader.readRange(BigInt(sampleRow.offset), BigInt(sampleRow.size));
  assert.equal(sampleBytes.byteLength, sampleRow.size);
  return { sampleBytes, sampleRow };
}

function assertNoPhysicalBlockBits(record) {
  assert.equal(record.physicalBits, null);
  assert.equal(record.ownBits, null);
  assert.equal(record.syntaxBits, null);
  assert.equal(record.subtreeBits, null);
  assert.equal("estimatedBits" in record, false);
  assert.equal("bitDensity" in record, false);
}

function assertExactVisibleCoverage(result) {
  const { width, height } = result.frameHeader;
  const coverage = new Uint8Array(width * height);
  for (const leaf of result.leaves) {
    for (const block of leaf.blocks) {
      for (let y = block.y; y < block.y + block.visibleHeight; y += 1) {
        for (let x = block.x; x < block.x + block.visibleWidth; x += 1) {
          const pixelIndex = y * width + x;
          assert.equal(coverage[pixelIndex], 0, "decoded VP9 blocks must not overlap");
          coverage[pixelIndex] = 1;
        }
      }
    }
  }
  assert.ok(coverage.every((value) => value === 1), "decoded VP9 blocks must cover the visible frame");
}

function createVp9KeyframeHeader(width, height) {
  const bytes = new Uint8Array(32);
  let bitOffset = 0;
  const writeLiteral = (value, bitCount) => {
    for (let bitIndex = bitCount - 1; bitIndex >= 0; bitIndex -= 1) {
      const bit = (value >> bitIndex) & 1;
      bytes[bitOffset >> 3] |= bit << (7 - (bitOffset & 7));
      bitOffset += 1;
    }
  };

  writeLiteral(2, 2);
  writeLiteral(0, 2);
  writeLiteral(0, 1);
  writeLiteral(0, 1);
  writeLiteral(1, 1);
  writeLiteral(1, 1);
  writeLiteral(0x498342, 24);
  writeLiteral(0, 3);
  writeLiteral(0, 1);
  writeLiteral(width - 1, 16);
  writeLiteral(height - 1, 16);
  writeLiteral(0, 1);
  writeLiteral(0, 2);
  writeLiteral(0, 6);
  writeLiteral(0, 3);
  writeLiteral(0, 1);
  writeLiteral(0, 8);
  writeLiteral(0, 1);
  writeLiteral(0, 1);
  writeLiteral(0, 1);
  writeLiteral(0, 1);

  const superblockColumns = Math.ceil(Math.ceil(width / 8) / 8);
  let minimumTileColumnsLog2 = 0;
  while ((64 << minimumTileColumnsLog2) < superblockColumns) minimumTileColumnsLog2 += 1;
  let maximumTileColumnsLog2 = 1;
  while ((superblockColumns >> maximumTileColumnsLog2) >= 4) maximumTileColumnsLog2 += 1;
  maximumTileColumnsLog2 -= 1;
  if (maximumTileColumnsLog2 > minimumTileColumnsLog2) writeLiteral(0, 1);
  writeLiteral(0, 1);
  writeLiteral(1, 16);
  return bytes.subarray(0, Math.ceil(bitOffset / 8));
}

test("VP9 directional scans use the normative row, column, and 32x32 coefficient neighbors", async () => {
  const loader = await createSourceModuleLoader();
  const { coefficientNeighbors, scanOrder } = await loader.import(
    "src/js/core/codecs/video/vp9-tables.js"
  );

  assert.deepEqual(Array.from(coefficientNeighbors(scanOrder(0, 1), 0, 1, 4)), [4, 4]);
  assert.deepEqual(Array.from(coefficientNeighbors(scanOrder(0, 2), 0, 2, 5)), [1, 1]);
  assert.deepEqual(Array.from(coefficientNeighbors(scanOrder(3, 1), 3, 1, 4)), [1, 32]);
});

test("VP9 keyframe traversal decodes exact partition geometry without inventing block bits", async () => {
  const fixture = await loadVp9Fixture();
  const { sampleBytes, sampleRow } = await readSample(fixture, 1);
  const result = fixture.vp9.parseVp9FrameInternals(sampleBytes);

  assert.equal(sampleRow.frameType, "I");
  assert.equal(result.supported, true);
  assert.equal(result.complete, true);
  assert.equal(result.granularity, "partition-tree");
  assert.equal(result.structureStatus, "decoded");
  assert.equal(result.frameHeader.profile, 0);
  assert.equal(result.frameHeader.frameTypeName, "keyframe");
  assert.equal(result.frameHeader.width, fixture.track.width);
  assert.equal(result.frameHeader.height, fixture.track.height);
  assert.equal(result.frameHeader.rawBits, 140);
  assert.equal(result.frameHeader.rawBytes, 18);
  assert.equal(result.frameHeader.firstPartitionSize, 191);
  assert.equal(result.frameHeader.colorSpace, 0);
  assert.equal(result.frameHeader.fullRange, false);
  assert.equal(result.frameHeader.subsamplingX, 1);
  assert.equal(result.frameHeader.subsamplingY, 1);
  assert.equal(result.frameHeader.refreshFrameContext, true);
  assert.equal(result.frameHeader.frameParallelDecoding, true);
  assert.equal(result.frameHeader.frameContextIndex, 0);
  assert.equal(result.frameHeader.loopFilter.filterLevel, 3);
  assert.equal(result.frameHeader.loopFilter.sharpnessLevel, 0);
  assert.equal(result.frameHeader.quantization.baseQuantizerIndex, 33);
  assert.equal(result.frameHeader.segmentation.enabled, false);
  assert.equal(result.frameHeader.tileInformation.columns, 1);
  assert.equal(result.frameHeader.tileInformation.rows, 1);
  assert.equal(result.rootNodeIds.length, 15);
  assert.equal(result.treeNodes.length, 691);
  assert.equal(result.leaves.length, 512);
  assert.ok(result.treeNodes.some((node) => node.children.length > 0));
  assert.ok(result.leaves.some((leaf) => leaf.blocks.some((block) => block.codedWidth < 8)));

  const nodeById = new Map(result.treeNodes.map((node) => [node.id, node]));
  const leafById = new Map(result.leaves.map((leaf) => [leaf.id, leaf]));
  assert.equal(nodeById.size, result.treeNodes.length);
  assert.equal(leafById.size, result.leaves.length);
  for (const rootNodeId of result.rootNodeIds) assert.equal(nodeById.get(rootNodeId).parentNodeId, null);
  for (const node of result.treeNodes) {
    assertNoPhysicalBlockBits(node);
    for (const childId of node.children) assert.equal(nodeById.get(childId).parentNodeId, node.id);
    for (const leafId of node.leaves) assert.equal(leafById.get(leafId).parentNodeId, node.id);
  }
  for (const leaf of result.leaves) {
    assertNoPhysicalBlockBits(leaf);
    assert.equal(leaf.accountingKind, "probability-self-information");
    assert.ok(Number.isFinite(leaf.entropyBits) && leaf.entropyBits >= 0);
    for (const transform of leaf.transforms) {
      assertNoPhysicalBlockBits(transform);
      assert.ok(Number.isFinite(transform.entropyBits) && transform.entropyBits >= 0);
    }
  }
  assertExactVisibleCoverage(result);

  assert.equal(result.sampleBits, sampleBytes.byteLength * 8);
  assert.equal(result.accounting.sampleBits, result.sampleBits);
  assert.equal(
    result.accounting.uncompressedHeaderEnvelopeBits +
      result.accounting.compressedHeaderPayloadBits +
      result.accounting.tileSizeFieldBits +
      result.accounting.tilePayloadBits,
    result.sampleBits
  );
  assert.equal(result.accounting.uncompressedHeaderBytePaddingBits, 4);
  assert.equal(result.accounting.blockPhysicalBitsAvailable, false);
  assert.ok(Number.isFinite(result.accounting.partitionEntropyBits));
  assert.ok(Number.isFinite(result.accounting.blockEntropyBits));
  assert.ok(Math.abs(
    result.accounting.partitionEntropyBits + result.accounting.blockEntropyBits -
      result.accounting.tileEntropyBits
  ) < 1e-9);
  assert.ok(
    Math.abs(
      result.accounting.tilePayloadBits -
        (result.accounting.tileEntropyBits + result.tiles[0].markerEntropyBits)
    ) < 64,
    "probability self-information must remain synchronized through the tile terminator"
  );
  assert.ok(result.tiles.every((tile) => tile.physicalSyntaxBits === null));
});

test("VP9 stateful inter frames are not independently decoded or assigned partitions", async () => {
  const fixture = await loadVp9Fixture();
  const { sampleBytes, sampleRow } = await readSample(fixture, 2);
  const result = fixture.vp9.parseVp9FrameInternals(sampleBytes);

  assert.equal(sampleRow.frameType, "P");
  assert.equal(result.supported, false);
  assert.equal(result.complete, false);
  assert.equal(result.reason, "stateful-inter-frame");
  assert.equal(result.granularity, "structured-unavailable");
  assert.equal(result.structureStatus, "unavailable");
  assert.equal(result.frameHeader.statefulInterFrame, true);
  assert.deepEqual(Array.from(result.treeNodes), []);
  assert.deepEqual(Array.from(result.leaves), []);
  assert.deepEqual(Array.from(result.rootUnits), []);
  assert.equal(result.sampleBits, sampleBytes.byteLength * 8);
  assert.equal(result.accounting.blockPhysicalBitsAvailable, false);
});

test("VP9 truncated keyframes fall back to exact 64x64 roots with null bit fields", async () => {
  const fixture = await loadVp9Fixture();
  const { sampleBytes } = await readSample(fixture, 1);
  const truncatedBytes = sampleBytes.subarray(0, 100);
  const result = fixture.vp9.parseVp9FrameInternals(truncatedBytes);

  assert.equal(result.supported, false);
  assert.equal(result.complete, false);
  assert.equal(result.reason, "truncated-compressed-header");
  assert.equal(result.granularity, "root-units");
  assert.equal(result.structureStatus, "root-only");
  assert.equal(result.rootUnits.length, 15);
  assert.deepEqual(Array.from(result.treeNodes), []);
  assert.deepEqual(Array.from(result.leaves), []);
  for (const root of result.rootUnits) {
    assertNoPhysicalBlockBits(root);
    assert.equal(root.granularity, "root-unit");
    assert.equal(root.codedWidth, 64);
    assert.equal(root.codedHeight, 64);
    assert.equal(root.partition, null);
  }

  const adaptedResult = fixture.vp9Adapter.adaptVp9FrameInternals(result);
  assert.equal(adaptedResult.complete, true);
  assert.equal(adaptedResult.granularity, "root-units");
  assert.equal(adaptedResult.roots.length, 15);
  assert.ok(adaptedResult.roots.every((root) => root.syntaxBits === null && root.subtreeBits === null));
});

test("VP9 codec adapter exposes decoded WebM and MP4-style trees without assigning block bits", async () => {
  const fixture = await loadVp9Fixture();
  const { sampleBytes, sampleRow } = await readSample(fixture, 1);
  const webmResult = await fixture.Core.analyzeFrameInternals(fixture.analysis, sampleRow);

  assert.equal(webmResult.complete, true);
  assert.equal(webmResult.kind, "vp9-frame-internals");
  assert.equal(webmResult.codecFamily, "VP9");
  assert.equal(webmResult.granularity, "partition-tree");
  assert.equal(webmResult.roots.length, 15);
  assert.equal(webmResult.attributedBits, null);
  assert.equal(webmResult.overheadBits, null);

  const decodedFrame = fixture.vp9.parseVp9FrameInternals(sampleBytes);
  const outputBudgetFallback = fixture.vp9Adapter.adaptVp9FrameInternals(decodedFrame, {
    maximumOutputRecords: 700
  });
  assert.equal(outputBudgetFallback.complete, true);
  assert.equal(outputBudgetFallback.reason, "adapter-output-safety-limit");
  assert.equal(outputBudgetFallback.granularity, "root-units");
  assert.equal(outputBudgetFallback.roots.length, 15);
  assert.ok(
    outputBudgetFallback.roots.every((root) => root.syntaxBits === null && root.subtreeBits === null)
  );

  const partitionBlocks = webmResult.roots.slice();
  while (partitionBlocks.length) {
    const block = partitionBlocks.pop();
    assertNoPhysicalBlockBits(block);
    partitionBlocks.push(...block.children);
  }

  const webmModel = fixture.Core.buildFrameInternalsModel(sampleRow, fixture.track, {
    parsedFrameInternals: webmResult
  });
  assert.equal(webmModel.kind, "video-grid");
  assert.equal(webmModel.granularity, "partition-tree");
  assert.equal(webmModel.mediaWidth, fixture.track.width);
  assert.equal(webmModel.mediaHeight, fixture.track.height);
  assert.ok(webmModel.cells.every((cell) => cell.syntaxBits === null && cell.subtreeBits === null));

  const mp4Track = {
    ...fixture.track,
    trackId: "mp4-vp9",
    codec: "vp09",
    codecDescriptor: "vp9"
  };
  const mp4SampleRow = {
    ...sampleRow,
    trackId: mp4Track.trackId,
    offset: 0,
    size: sampleBytes.byteLength
  };
  const mp4StyleAnalysis = {
    tracks: [mp4Track],
    reader: {
      async readRange(offset, size) {
        assert.equal(offset, 0n);
        assert.equal(size, BigInt(sampleBytes.byteLength));
        return sampleBytes;
      },
      async readExactRange(offset, size) {
        assert.equal(offset, 0n);
        assert.equal(size, BigInt(sampleBytes.byteLength));
        return sampleBytes;
      }
    }
  };
  const mp4StyleResult = await fixture.Core.analyzeFrameInternals(mp4StyleAnalysis, mp4SampleRow);
  assert.equal(mp4StyleResult.complete, true);
  assert.equal(mp4StyleResult.codec, "vp09");
  assert.equal(mp4StyleResult.granularity, "partition-tree");
  assert.equal(mp4StyleResult.roots.length, webmResult.roots.length);
  assert.ok(mp4StyleResult.roots.every((root) => root.syntaxBits === null && root.subtreeBits === null));

  const { sampleRow: interSampleRow } = await readSample(fixture, 2);
  const interResult = await fixture.Core.analyzeFrameInternals(fixture.analysis, interSampleRow);
  assert.equal(interResult.complete, false);
  assert.equal(interResult.reason, "stateful-inter-frame");
  assert.equal("roots" in interResult, false);
});

test("VP9 mode-grid guard returns exact roots before allocating oversized worker state", async () => {
  const fixture = await loadVp9Fixture();
  const oversizedHeader = createVp9KeyframeHeader(8008, 8008);
  const result = fixture.vp9.parseVp9FrameInternals(oversizedHeader);

  assert.equal(result.complete, false);
  assert.equal(result.reason, "mode-grid-safety-limit");
  assert.equal(result.granularity, "root-units");
  assert.ok(result.frameHeader.miColumns * result.frameHeader.miRows > 1_000_000);
  assert.equal(result.rootUnits.length, 126 * 126);
  assertNoPhysicalBlockBits(result.rootUnits[0]);
  assertNoPhysicalBlockBits(result.rootUnits.at(-1));
});
