import { parseVp9FrameInternals } from "./vp9-frame-internals.js";

const VP9_SUPERBLOCK_SIZE = 64;
const MAX_VP9_ADAPTED_BLOCKS = 100_000;

class Vp9AdapterBudgetError extends Error {}

function reserveAdaptedBlock(outputBudget) {
  if (outputBudget.used >= outputBudget.maximum) {
    throw new Vp9AdapterBudgetError("VP9 adapted block tree exceeds the output safety limit.");
  }
  outputBudget.used += 1;
}

function createUnavailableResult(parsedFrame) {
  return {
    kind: "unavailable",
    complete: false,
    codecFamily: "VP9",
    sampleBits: parsedFrame.sampleBits,
    reason: parsedFrame.reason || "vp9-syntax-parse-failed",
    warnings: parsedFrame.warnings || []
  };
}

function createRootUnitBlock(rootUnit, depth = 0) {
  return {
    id: rootUnit.id,
    left: rootUnit.x,
    top: rootUnit.y,
    width: rootUnit.visibleWidth,
    height: rootUnit.visibleHeight,
    codedBlockWidth: rootUnit.codedWidth,
    codedBlockHeight: rootUnit.codedHeight,
    depth,
    type: "superblock",
    partitionMode: "root",
    physicalBits: null,
    ownBits: null,
    syntaxBits: null,
    subtreeBits: null,
    children: []
  };
}

function createLeafBlocks(leaf, depth, outputBudget) {
  const blocks = [];
  for (let blockIndex = 0; blockIndex < leaf.blocks.length; blockIndex += 1) {
    const block = leaf.blocks[blockIndex];
    if (block.visibleWidth <= 0 || block.visibleHeight <= 0) continue;
    reserveAdaptedBlock(outputBudget);
    blocks.push({
      id: leaf.id + ":block:" + blockIndex,
      left: block.x,
      top: block.y,
      width: block.visibleWidth,
      height: block.visibleHeight,
      codedBlockWidth: block.codedWidth,
      codedBlockHeight: block.codedHeight,
      depth,
      type: leaf.blockSize,
      partitionMode: "leaf",
      physicalBits: null,
      ownBits: null,
      syntaxBits: null,
      subtreeBits: null,
      children: [],
      metadata: {
        leafId: leaf.id,
        segmentId: leaf.segmentId,
        skip: leaf.skip,
        transformSize: leaf.transformSize,
        lumaMode: leaf.lumaMode,
        chromaMode: leaf.chromaMode,
        transformCount: leaf.transforms.length
      }
    });
  }
  return blocks;
}

function buildPartitionRoots(parsedFrame, maximumOutputRecords) {
  const treeNodeById = new Map(parsedFrame.treeNodes.map((treeNode) => [treeNode.id, treeNode]));
  const leafById = new Map(parsedFrame.leaves.map((leaf) => [leaf.id, leaf]));
  const outputBudget = { used: 0, maximum: maximumOutputRecords };

  function buildPartitionBlock(treeNodeId, depth) {
    const treeNode = treeNodeById.get(treeNodeId);
    if (!treeNode) throw new Error("VP9 partition tree references a missing node: " + treeNodeId);
    reserveAdaptedBlock(outputBudget);
    const childPartitions = treeNode.children.map((childId) => buildPartitionBlock(childId, depth + 1));
    const leafBlocks = treeNode.leaves.flatMap((leafId) => {
      const leaf = leafById.get(leafId);
      if (!leaf) throw new Error("VP9 partition tree references a missing leaf: " + leafId);
      return createLeafBlocks(leaf, depth + 1, outputBudget);
    });
    return {
      id: treeNode.id,
      left: treeNode.x,
      top: treeNode.y,
      width: treeNode.visibleWidth,
      height: treeNode.visibleHeight,
      codedBlockWidth: treeNode.codedWidth,
      codedBlockHeight: treeNode.codedHeight,
      depth,
      type: treeNode.blockSize,
      partitionMode: treeNode.partition,
      physicalBits: null,
      ownBits: null,
      syntaxBits: null,
      subtreeBits: null,
      children: childPartitions.concat(leafBlocks)
    };
  }

  return parsedFrame.rootNodeIds.map((rootNodeId) => buildPartitionBlock(rootNodeId, 0));
}

function createExactRootUnitBlocks(frameHeader) {
  const columns = Math.ceil(frameHeader.width / VP9_SUPERBLOCK_SIZE);
  const rows = Math.ceil(frameHeader.height / VP9_SUPERBLOCK_SIZE);
  if (!columns || !rows || columns * rows > MAX_VP9_ADAPTED_BLOCKS) return [];
  const roots = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x = column * VP9_SUPERBLOCK_SIZE;
      const y = row * VP9_SUPERBLOCK_SIZE;
      roots.push(createRootUnitBlock({
        id: "vp9-adapter-root-unit-" + roots.length,
        x,
        y,
        visibleWidth: Math.min(VP9_SUPERBLOCK_SIZE, frameHeader.width - x),
        visibleHeight: Math.min(VP9_SUPERBLOCK_SIZE, frameHeader.height - y),
        codedWidth: VP9_SUPERBLOCK_SIZE,
        codedHeight: VP9_SUPERBLOCK_SIZE
      }));
    }
  }
  return roots;
}

function createFrameResult(parsedFrame, roots, granularity) {
  const frameHeader = parsedFrame.frameHeader;
  const columns = Math.ceil(frameHeader.width / VP9_SUPERBLOCK_SIZE);
  const rows = Math.ceil(frameHeader.height / VP9_SUPERBLOCK_SIZE);
  const structureRecordCount = countStructureRecords(roots);
  return {
    kind: "vp9-frame-internals",
    complete: true,
    codecFamily: "VP9",
    frameType: frameHeader.frameTypeName || "unknown",
    granularity,
    accountingKind: "wire-envelope-only-no-block-allocation",
    unitName: "superblock",
    unitWidth: VP9_SUPERBLOCK_SIZE,
    unitHeight: VP9_SUPERBLOCK_SIZE,
    width: frameHeader.width,
    height: frameHeader.height,
    codedWidth: columns * VP9_SUPERBLOCK_SIZE,
    codedHeight: rows * VP9_SUPERBLOCK_SIZE,
    columns,
    rows,
    roots,
    blocks: roots,
    structureRecordCount,
    decodedStructureRecordCount: structureRecordCount,
    sampleBits: parsedFrame.sampleBits,
    attributedBits: null,
    overheadBits: null,
    reason: parsedFrame.reason || null,
    warnings: parsedFrame.warnings || [],
    diagnostics: {
      frameHeader,
      compressedHeader: parsedFrame.compressedHeader,
      tiles: parsedFrame.tiles,
      accounting: parsedFrame.accounting,
      limitations: parsedFrame.limitations || []
    }
  };
}

function countStructureRecords(roots) {
  let count = 0;
  const pendingBlocks = roots.slice();
  while (pendingBlocks.length) {
    const block = pendingBlocks.pop();
    count += 1;
    if (Array.isArray(block.children)) pendingBlocks.push(...block.children);
  }
  return count;
}

function adaptVp9FrameInternals(parsedFrame, options = {}) {
  if (parsedFrame.complete) {
    const maximumOutputRecords = Number.isInteger(options.maximumOutputRecords) &&
      options.maximumOutputRecords > 0
      ? Math.min(options.maximumOutputRecords, MAX_VP9_ADAPTED_BLOCKS)
      : MAX_VP9_ADAPTED_BLOCKS;
    let roots;
    try {
      roots = buildPartitionRoots(parsedFrame, maximumOutputRecords);
    } catch (error) {
      if (!(error instanceof Vp9AdapterBudgetError)) throw error;
      roots = createExactRootUnitBlocks(parsedFrame.frameHeader);
      if (!roots.length) return createUnavailableResult(parsedFrame);
      return createFrameResult({
        ...parsedFrame,
        reason: "adapter-output-safety-limit",
        warnings: [
          ...(parsedFrame.warnings || []),
          "VP9 partition output exceeds the configured block safety limit; only exact 64x64 roots are shown."
        ]
      }, roots, "root-units");
    }
    if (!roots.length) return createUnavailableResult(parsedFrame);
    return createFrameResult(parsedFrame, roots, "partition-tree");
  }
  if (parsedFrame.rootUnits && parsedFrame.rootUnits.length) {
    const roots = parsedFrame.rootUnits.map((rootUnit) => createRootUnitBlock(rootUnit));
    return createFrameResult(parsedFrame, roots, "root-units");
  }
  return createUnavailableResult(parsedFrame);
}

const vp9VideoCodec = {
  id: "vp9",
  label: "VP9",
  kind: "video",
  sampleEntryTypes: ["vp09", "V_VP9", "vp9"],
  configurationBoxTypes: ["vpcC"],
  parseFrameInternals(sampleBytes) {
    return adaptVp9FrameInternals(parseVp9FrameInternals(sampleBytes));
  }
};

export {
  adaptVp9FrameInternals,
  parseVp9FrameInternals,
  vp9VideoCodec
};
