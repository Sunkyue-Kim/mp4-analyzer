import { Vp9RangeDecoder } from "./vp9-range-decoder.js";
import {
  BLOCK_HEIGHTS_IN_4X4,
  BLOCK_SIZES,
  BLOCK_WIDTHS_IN_4X4,
  BLOCK_WIDTHS_IN_8X8,
  COEFFICIENT_BANDS_4X4,
  COEFFICIENT_BANDS_LARGE_PREFIX,
  COEFFICIENT_CATEGORY_PROBABILITIES,
  DEFAULT_SKIP_PROBABILITIES,
  DEFAULT_TX_PROBABILITIES,
  INTRA_MODE_NAMES,
  INTRA_MODE_TO_TRANSFORM_TYPE,
  INTRA_MODE_TREE,
  KEYFRAME_PARTITION_PROBABILITIES,
  MAX_TRANSFORM_SIZE_BY_BLOCK,
  PARTITION_CONTEXT_ABOVE,
  PARTITION_CONTEXT_LEFT,
  PARTITION_SUBSIZES,
  PARTITION_TREE,
  SEGMENT_TREE,
  coefficientNeighbors,
  coefficientProbabilityIndex,
  createDefaultCoefficientProbabilities,
  keyframeUvModeProbabilities,
  keyframeYModeProbabilities,
  paretoProbabilities,
  scanOrder
} from "./vp9-tables.js";

const FRAME_MARKER = 2;
const SYNC_CODE = 0x498342;
const PARTITION_NAMES = ["none", "horizontal", "vertical", "split"];
const TRANSFORM_SIZE_NAMES = ["4x4", "8x8", "16x16", "32x32"];
const TRANSFORM_TYPE_NAMES = ["DCT_DCT", "ADST_DCT", "DCT_ADST", "ADST_ADST"];
const SEGMENT_FEATURE_MAXIMUMS = [255, 63, 3, 0];
const SEGMENT_FEATURE_SIGNED = [true, true, false, false];
const SEGMENT_SKIP_FEATURE = 3;
const DIFF_UPDATE_PROBABILITY = 252;
const MAX_VP9_ROOT_UNITS = 100_000;
const MAX_VP9_MODE_GRID_ENTRIES = 1_000_000;
const MAX_VP9_STRUCTURE_RECORDS = 100_000;

function isUint8Array(value) {
  return ArrayBuffer.isView(value) && Object.prototype.toString.call(value) === "[object Uint8Array]";
}

function reserveStructureRecord(tileState) {
  if (tileState.structureRecordBudget.used >= MAX_VP9_STRUCTURE_RECORDS) {
    throw new Error("VP9 decoded structure exceeds the 100,000-record safety limit.");
  }
  tileState.structureRecordBudget.used += 1;
}

class Vp9RawBitReader {
  constructor(bytes) {
    this.bytes = bytes;
    this.bitOffset = 0;
  }

  readBit() {
    if (this.bitOffset >= this.bytes.byteLength * 8) {
      throw new RangeError("VP9 uncompressed header exceeds the frame payload.");
    }
    const byte = this.bytes[this.bitOffset >> 3];
    const bit = (byte >> (7 - (this.bitOffset & 7))) & 1;
    this.bitOffset += 1;
    return bit;
  }

  readLiteral(bitCount) {
    let value = 0;
    for (let bitIndex = 0; bitIndex < bitCount; bitIndex += 1) {
      value = value * 2 + this.readBit();
    }
    return value;
  }

  readSignedLiteral(bitCount) {
    const magnitude = this.readLiteral(bitCount);
    return this.readBit() ? -magnitude : magnitude;
  }

  get bytesRead() {
    return Math.ceil(this.bitOffset / 8);
  }
}

function readVp9Profile(reader) {
  let profile = reader.readBit() | (reader.readBit() << 1);
  if (profile > 2) profile += reader.readBit();
  return profile;
}

function readColorConfiguration(reader, profile) {
  const bitDepth = profile >= 2 ? (reader.readBit() ? 12 : 10) : 8;
  const colorSpace = reader.readLiteral(3);
  if (colorSpace === 7) {
    if (profile !== 1 && profile !== 3) {
      throw new Error("VP9 sRGB color space is invalid for profile " + profile + ".");
    }
    const reservedBit = reader.readBit();
    if (reservedBit) throw new Error("VP9 color configuration reserved bit is set.");
    return { bitDepth, colorSpace, fullRange: true, subsamplingX: 0, subsamplingY: 0 };
  }

  const fullRange = Boolean(reader.readBit());
  if (profile === 1 || profile === 3) {
    const subsamplingX = reader.readBit();
    const subsamplingY = reader.readBit();
    const reservedBit = reader.readBit();
    if (reservedBit) throw new Error("VP9 color configuration reserved bit is set.");
    return { bitDepth, colorSpace, fullRange, subsamplingX, subsamplingY };
  }
  return { bitDepth, colorSpace, fullRange, subsamplingX: 1, subsamplingY: 1 };
}

function readFrameDimensions(reader) {
  const width = reader.readLiteral(16) + 1;
  const height = reader.readLiteral(16) + 1;
  const hasDifferentRenderSize = Boolean(reader.readBit());
  const renderWidth = hasDifferentRenderSize ? reader.readLiteral(16) + 1 : width;
  const renderHeight = hasDifferentRenderSize ? reader.readLiteral(16) + 1 : height;
  return { width, height, renderWidth, renderHeight, hasDifferentRenderSize };
}

function readLoopFilter(reader) {
  const filterLevel = reader.readLiteral(6);
  const sharpnessLevel = reader.readLiteral(3);
  const modeReferenceDeltaEnabled = Boolean(reader.readBit());
  const referenceDeltas = [1, 0, -1, -1];
  const modeDeltas = [0, 0];
  let modeReferenceDeltaUpdate = false;
  if (modeReferenceDeltaEnabled) {
    modeReferenceDeltaUpdate = Boolean(reader.readBit());
    if (modeReferenceDeltaUpdate) {
      for (let index = 0; index < referenceDeltas.length; index += 1) {
        if (reader.readBit()) referenceDeltas[index] = reader.readSignedLiteral(6);
      }
      for (let index = 0; index < modeDeltas.length; index += 1) {
        if (reader.readBit()) modeDeltas[index] = reader.readSignedLiteral(6);
      }
    }
  }
  return {
    filterLevel,
    sharpnessLevel,
    modeReferenceDeltaEnabled,
    modeReferenceDeltaUpdate,
    referenceDeltas,
    modeDeltas
  };
}

function readQuantization(reader) {
  const baseQuantizerIndex = reader.readLiteral(8);
  const readDelta = () => reader.readBit() ? reader.readSignedLiteral(4) : 0;
  const yDcDelta = readDelta();
  const uvDcDelta = readDelta();
  const uvAcDelta = readDelta();
  return {
    baseQuantizerIndex,
    yDcDelta,
    uvDcDelta,
    uvAcDelta,
    lossless: baseQuantizerIndex === 0 && yDcDelta === 0 && uvDcDelta === 0 && uvAcDelta === 0
  };
}

function unsignedBitCount(maximum) {
  if (maximum <= 0) return 0;
  return Math.floor(Math.log2(maximum)) + 1;
}

function readSegmentation(reader) {
  const segmentation = {
    enabled: Boolean(reader.readBit()),
    updateMap: false,
    temporalUpdate: false,
    updateData: false,
    absoluteValues: false,
    treeProbabilities: new Uint8Array(7).fill(255),
    predictionProbabilities: new Uint8Array(3).fill(255),
    featureMasks: new Uint8Array(8),
    featureData: Array.from({ length: 8 }, () => new Int16Array(4))
  };
  if (!segmentation.enabled) return segmentation;

  segmentation.updateMap = Boolean(reader.readBit());
  if (segmentation.updateMap) {
    for (let index = 0; index < segmentation.treeProbabilities.length; index += 1) {
      if (reader.readBit()) segmentation.treeProbabilities[index] = reader.readLiteral(8);
    }
    segmentation.temporalUpdate = Boolean(reader.readBit());
    if (segmentation.temporalUpdate) {
      for (let index = 0; index < segmentation.predictionProbabilities.length; index += 1) {
        if (reader.readBit()) segmentation.predictionProbabilities[index] = reader.readLiteral(8);
      }
    }
  }

  segmentation.updateData = Boolean(reader.readBit());
  if (segmentation.updateData) {
    segmentation.absoluteValues = Boolean(reader.readBit());
    for (let segmentId = 0; segmentId < 8; segmentId += 1) {
      for (let featureId = 0; featureId < 4; featureId += 1) {
        if (!reader.readBit()) continue;
        segmentation.featureMasks[segmentId] |= 1 << featureId;
        const maximum = SEGMENT_FEATURE_MAXIMUMS[featureId];
        let value = reader.readLiteral(unsignedBitCount(maximum));
        if (value > maximum) value = maximum;
        if (SEGMENT_FEATURE_SIGNED[featureId] && reader.readBit()) value = -value;
        segmentation.featureData[segmentId][featureId] = value;
      }
    }
  }
  return segmentation;
}

function tileColumnLimits(miColumns) {
  const superblockColumns = Math.ceil(miColumns / 8);
  let minimumLog2 = 0;
  while ((64 << minimumLog2) < superblockColumns) minimumLog2 += 1;
  let maximumLog2 = 1;
  while ((superblockColumns >> maximumLog2) >= 4) maximumLog2 += 1;
  return { minimumLog2, maximumLog2: maximumLog2 - 1 };
}

function readTileInformation(reader, miColumns) {
  const limits = tileColumnLimits(miColumns);
  let log2Columns = limits.minimumLog2;
  let remainingColumnBits = limits.maximumLog2 - limits.minimumLog2;
  while (remainingColumnBits > 0 && reader.readBit()) {
    log2Columns += 1;
    remainingColumnBits -= 1;
  }
  let log2Rows = reader.readBit();
  if (log2Rows) log2Rows += reader.readBit();
  return {
    log2Columns,
    log2Rows,
    columns: 1 << log2Columns,
    rows: 1 << log2Rows
  };
}

function parseUncompressedHeader(bytes) {
  const reader = new Vp9RawBitReader(bytes);
  const frameMarker = reader.readLiteral(2);
  if (frameMarker !== FRAME_MARKER) throw new Error("Invalid VP9 frame marker.");
  const profile = readVp9Profile(reader);
  const showExistingFrame = Boolean(reader.readBit());
  if (showExistingFrame) {
    return {
      frameMarker,
      profile,
      showExistingFrame,
      existingFrameIndex: reader.readLiteral(3),
      rawBits: reader.bitOffset,
      rawBytes: reader.bytesRead,
      firstPartitionSize: 0
    };
  }

  const frameType = reader.readBit();
  const showFrame = Boolean(reader.readBit());
  const errorResilient = Boolean(reader.readBit());
  let intraOnly = frameType === 0;
  let resetFrameContext = 0;
  let colorConfiguration;
  let dimensions;

  if (frameType === 0) {
    if (reader.readLiteral(24) !== SYNC_CODE) throw new Error("Invalid VP9 keyframe sync code.");
    colorConfiguration = readColorConfiguration(reader, profile);
    dimensions = readFrameDimensions(reader);
  } else {
    intraOnly = showFrame ? false : Boolean(reader.readBit());
    resetFrameContext = errorResilient ? 0 : reader.readLiteral(2);
    if (!intraOnly) {
      return {
        frameMarker,
        profile,
        showExistingFrame,
        frameType,
        showFrame,
        errorResilient,
        intraOnly,
        resetFrameContext,
        rawBits: reader.bitOffset,
        rawBytes: reader.bytesRead,
        statefulInterFrame: true
      };
    }
    if (reader.readLiteral(24) !== SYNC_CODE) throw new Error("Invalid VP9 intra-only sync code.");
    colorConfiguration = profile > 0
      ? readColorConfiguration(reader, profile)
      : { bitDepth: 8, colorSpace: 1, fullRange: false, subsamplingX: 1, subsamplingY: 1 };
    const refreshFrameFlags = reader.readLiteral(8);
    dimensions = readFrameDimensions(reader);
    dimensions.refreshFrameFlags = refreshFrameFlags;
  }

  let refreshFrameContext = false;
  let frameParallelDecoding = true;
  if (!errorResilient) {
    refreshFrameContext = Boolean(reader.readBit());
    frameParallelDecoding = Boolean(reader.readBit());
  }
  const frameContextIndex = reader.readLiteral(2);
  const loopFilter = readLoopFilter(reader);
  const quantization = readQuantization(reader);
  const segmentation = readSegmentation(reader);
  const miColumns = Math.ceil(dimensions.width / 8);
  const miRows = Math.ceil(dimensions.height / 8);
  const tileInformation = readTileInformation(reader, miColumns);
  const firstPartitionSize = reader.readLiteral(16);
  if (!firstPartitionSize) throw new Error("VP9 compressed header partition has zero size.");

  return {
    frameMarker,
    profile,
    showExistingFrame,
    frameType,
    frameTypeName: frameType === 0 ? "keyframe" : "intra-only",
    showFrame,
    errorResilient,
    intraOnly,
    resetFrameContext,
    refreshFrameContext,
    frameParallelDecoding,
    frameContextIndex,
    ...colorConfiguration,
    ...dimensions,
    miColumns,
    miRows,
    loopFilter,
    quantization,
    segmentation,
    tileInformation,
    firstPartitionSize,
    rawBits: reader.bitOffset,
    rawBytes: reader.bytesRead
  };
}

function inverseRecenterNonnegative(value, midpoint) {
  if (value > 2 * midpoint) return value;
  return value & 1 ? midpoint - ((value + 1) >> 1) : midpoint + (value >> 1);
}

const INVERSE_MAP = (() => {
  const values = [];
  const reserved = new Set();
  for (let value = 7; value <= 254; value += 13) {
    values.push(value);
    reserved.add(value);
  }
  for (let value = 1; value <= 253; value += 1) {
    if (!reserved.has(value)) values.push(value);
  }
  values.push(253);
  return new Uint8Array(values);
})();

function inverseRemapProbability(value, probability) {
  const mappedValue = INVERSE_MAP[value];
  const midpoint = probability - 1;
  if ((midpoint << 1) <= 255) return 1 + inverseRecenterNonnegative(mappedValue, midpoint);
  return 255 - inverseRecenterNonnegative(mappedValue, 254 - midpoint);
}

function decodeUniform(decoder) {
  const threshold = 65;
  const value = decoder.readLiteral(7);
  return value < threshold ? value : (value << 1) - threshold + decoder.readBit();
}

function decodeTerminatedSubexponential(decoder) {
  if (!decoder.readBit()) return decoder.readLiteral(4);
  if (!decoder.readBit()) return decoder.readLiteral(4) + 16;
  if (!decoder.readBit()) return decoder.readLiteral(5) + 32;
  return decodeUniform(decoder) + 64;
}

function readProbabilityUpdate(decoder, oldProbability) {
  if (!decoder.read(DIFF_UPDATE_PROBABILITY)) return oldProbability;
  return inverseRemapProbability(decodeTerminatedSubexponential(decoder), oldProbability);
}

function cloneTxProbabilities() {
  return {
    1: DEFAULT_TX_PROBABILITIES[1].map(probabilities => probabilities.slice()),
    2: DEFAULT_TX_PROBABILITIES[2].map(probabilities => probabilities.slice()),
    3: DEFAULT_TX_PROBABILITIES[3].map(probabilities => probabilities.slice())
  };
}

function parseCompressedHeader(bytes, frameHeader) {
  const decoder = new Vp9RangeDecoder(bytes, { label: "VP9 compressed header" });
  const syntaxStart = decoder.snapshot();
  let transformMode = 0;
  if (!frameHeader.quantization.lossless) {
    transformMode = decoder.readLiteral(2);
    if (transformMode === 3) transformMode += decoder.readBit();
  }
  const transformProbabilities = cloneTxProbabilities();
  if (transformMode === 4) {
    for (const maximumTransformSize of [1, 2, 3]) {
      for (const probabilities of transformProbabilities[maximumTransformSize]) {
        for (let index = 0; index < probabilities.length; index += 1) {
          probabilities[index] = readProbabilityUpdate(decoder, probabilities[index]);
        }
      }
    }
  }

  const coefficientProbabilities = createDefaultCoefficientProbabilities();
  const maximumTransformSize = [0, 1, 2, 3, 3][transformMode];
  const coefficientUpdatesByTransform = [];
  for (let transformSize = 0; transformSize <= maximumTransformSize; transformSize += 1) {
    const updateStart = decoder.snapshot();
    let updateCount = 0;
    if (decoder.readBit()) {
      const probabilities = coefficientProbabilities[transformSize];
      for (let planeType = 0; planeType < 2; planeType += 1) {
        for (let referenceType = 0; referenceType < 2; referenceType += 1) {
          for (let band = 0; band < 6; band += 1) {
            const contextCount = band === 0 ? 3 : 6;
            for (let context = 0; context < contextCount; context += 1) {
              for (let node = 0; node < 3; node += 1) {
                const probabilityIndex = coefficientProbabilityIndex(
                  planeType,
                  referenceType,
                  band,
                  context,
                  node
                );
                const oldProbability = probabilities[probabilityIndex];
                const newProbability = readProbabilityUpdate(decoder, oldProbability);
                probabilities[probabilityIndex] = newProbability;
                if (newProbability !== oldProbability) updateCount += 1;
              }
            }
          }
        }
      }
    }
    coefficientUpdatesByTransform.push({
      transformSize: TRANSFORM_SIZE_NAMES[transformSize],
      updateCount,
      ...decoder.measureFrom(updateStart)
    });
  }

  const skipProbabilities = DEFAULT_SKIP_PROBABILITIES.slice();
  for (let index = 0; index < skipProbabilities.length; index += 1) {
    skipProbabilities[index] = readProbabilityUpdate(decoder, skipProbabilities[index]);
  }
  if (decoder.hasError()) throw new Error("VP9 compressed header boolean partition is truncated.");
  return {
    transformMode,
    transformModeName: ["only-4x4", "allow-8x8", "allow-16x16", "allow-32x32", "select"][transformMode],
    transformProbabilities,
    coefficientProbabilities,
    skipProbabilities,
    coefficientUpdatesByTransform,
    markerEntropyBits: 1,
    ...decoder.measureFrom(syntaxStart)
  };
}

function coefficientBand(transformSize, coefficientIndex) {
  if (transformSize === 0) return COEFFICIENT_BANDS_4X4[coefficientIndex];
  return coefficientIndex < COEFFICIENT_BANDS_LARGE_PREFIX.length
    ? COEFFICIENT_BANDS_LARGE_PREFIX[coefficientIndex]
    : 5;
}

function decodeCoefficientBlock(decoder, probabilities, options) {
  const { transformSize, planeType, initialContext, transformType } = options;
  const maximumEndOfBlock = 16 << (transformSize << 1);
  const scan = scanOrder(transformSize, transformType);
  const tokenCache = new Uint8Array(maximumEndOfBlock);
  const start = decoder.snapshot();
  let coefficientIndex = 0;
  let context = initialContext;
  let nonzeroCoefficientCount = 0;
  let zeroTokenCount = 0;
  let categoryTokenCount = 0;

  while (coefficientIndex < maximumEndOfBlock) {
    let band = coefficientBand(transformSize, coefficientIndex);
    let probabilityIndex = coefficientProbabilityIndex(planeType, 0, band, context, 0);
    if (!decoder.read(probabilities[probabilityIndex])) break;

    probabilityIndex += 1;
    while (!decoder.read(probabilities[probabilityIndex])) {
      tokenCache[scan[coefficientIndex]] = 0;
      zeroTokenCount += 1;
      coefficientIndex += 1;
      if (coefficientIndex >= maximumEndOfBlock) {
        return {
          endOfBlock: coefficientIndex,
          nonzeroCoefficientCount,
          zeroTokenCount,
          categoryTokenCount,
          ...decoder.measureFrom(start)
        };
      }
      const neighbors = coefficientNeighbors(scan, transformSize, transformType, coefficientIndex);
      context = (1 + tokenCache[neighbors[0]] + tokenCache[neighbors[1]]) >> 1;
      band = coefficientBand(transformSize, coefficientIndex);
      probabilityIndex = coefficientProbabilityIndex(planeType, 0, band, context, 1);
    }

    const pivotProbability = probabilities[probabilityIndex + 1];
    if (decoder.read(pivotProbability)) {
      const pareto = paretoProbabilities(pivotProbability);
      if (decoder.read(pareto[0])) {
        let categoryIndex;
        if (decoder.read(pareto[3])) {
          tokenCache[scan[coefficientIndex]] = 5;
          if (decoder.read(pareto[5])) {
            categoryIndex = decoder.read(pareto[7]) ? 5 : 4;
          } else {
            categoryIndex = decoder.read(pareto[6]) ? 3 : 2;
          }
        } else {
          tokenCache[scan[coefficientIndex]] = 4;
          categoryIndex = decoder.read(pareto[4]) ? 1 : 0;
        }
        const categoryProbabilities = COEFFICIENT_CATEGORY_PROBABILITIES[categoryIndex];
        for (const probability of categoryProbabilities) decoder.read(probability);
        categoryTokenCount += 1;
      } else if (decoder.read(pareto[1])) {
        tokenCache[scan[coefficientIndex]] = 3;
        decoder.read(pareto[2]);
      } else {
        tokenCache[scan[coefficientIndex]] = 2;
      }
    } else {
      tokenCache[scan[coefficientIndex]] = 1;
    }

    decoder.readBit();
    nonzeroCoefficientCount += 1;
    coefficientIndex += 1;
    if (coefficientIndex < maximumEndOfBlock) {
      const neighbors = coefficientNeighbors(scan, transformSize, transformType, coefficientIndex);
      context = (1 + tokenCache[neighbors[0]] + tokenCache[neighbors[1]]) >> 1;
    }
  }

  return {
    endOfBlock: coefficientIndex,
    nonzeroCoefficientCount,
    zeroTokenCount,
    categoryTokenCount,
    ...decoder.measureFrom(start)
  };
}

function getModeAt(modeInformation, blockIndex) {
  if (!modeInformation) return 0;
  if (modeInformation.blockSize < 3) return modeInformation.subBlockModes[blockIndex];
  return modeInformation.lumaMode;
}

function aboveBlockMode(currentModeInformation, aboveModeInformation, blockIndex) {
  if (blockIndex === 0 || blockIndex === 1) {
    return aboveModeInformation ? getModeAt(aboveModeInformation, blockIndex + 2) : 0;
  }
  return currentModeInformation.subBlockModes[blockIndex - 2];
}

function leftBlockMode(currentModeInformation, leftModeInformation, blockIndex) {
  if (blockIndex === 0 || blockIndex === 2) {
    return leftModeInformation ? getModeAt(leftModeInformation, blockIndex + 1) : 0;
  }
  return currentModeInformation.subBlockModes[blockIndex - 1];
}

function readKeyframeLumaMode(decoder, currentModeInformation, aboveModeInformation, leftModeInformation, blockIndex) {
  const aboveMode = aboveBlockMode(currentModeInformation, aboveModeInformation, blockIndex);
  const leftMode = leftBlockMode(currentModeInformation, leftModeInformation, blockIndex);
  return decoder.readTree(INTRA_MODE_TREE, keyframeYModeProbabilities(aboveMode, leftMode));
}

function readModeInformation(decoder, tileState, blockState) {
  const { frameHeader, compressedHeader, modeGrid } = tileState;
  const { miRow, miColumn, blockSize, widthInMi, heightInMi, tileColumnStart } = blockState;
  const gridIndex = miRow * frameHeader.miColumns + miColumn;
  const aboveModeInformation = miRow > 0 ? modeGrid[gridIndex - frameHeader.miColumns] : null;
  const leftModeInformation = miColumn > tileColumnStart ? modeGrid[gridIndex - 1] : null;
  const modeInformation = {
    blockSize,
    skip: 0,
    transformSize: 0,
    segmentId: 0,
    lumaMode: 0,
    chromaMode: 0,
    subBlockModes: [0, 0, 0, 0]
  };

  for (let row = 0; row < Math.min(heightInMi, frameHeader.miRows - miRow); row += 1) {
    for (let column = 0; column < Math.min(widthInMi, frameHeader.miColumns - miColumn); column += 1) {
      modeGrid[(miRow + row) * frameHeader.miColumns + miColumn + column] = modeInformation;
    }
  }

  const segmentation = frameHeader.segmentation;
  if (segmentation.enabled && segmentation.updateMap) {
    modeInformation.segmentId = decoder.readTree(SEGMENT_TREE, segmentation.treeProbabilities);
  }

  const segmentForcesSkip = segmentation.enabled &&
    Boolean(segmentation.featureMasks[modeInformation.segmentId] & (1 << SEGMENT_SKIP_FEATURE));
  if (segmentForcesSkip) {
    modeInformation.skip = 1;
  } else {
    const skipContext = (aboveModeInformation ? aboveModeInformation.skip : 0) +
      (leftModeInformation ? leftModeInformation.skip : 0);
    modeInformation.skip = decoder.read(compressedHeader.skipProbabilities[skipContext]);
  }

  const maximumTransformSize = MAX_TRANSFORM_SIZE_BY_BLOCK[blockSize];
  if (compressedHeader.transformMode === 4 && blockSize >= 3) {
    let aboveContext = aboveModeInformation && !aboveModeInformation.skip
      ? aboveModeInformation.transformSize
      : maximumTransformSize;
    let leftContext = leftModeInformation && !leftModeInformation.skip
      ? leftModeInformation.transformSize
      : maximumTransformSize;
    if (!leftModeInformation) leftContext = aboveContext;
    if (!aboveModeInformation) aboveContext = leftContext;
    const transformContext = aboveContext + leftContext > maximumTransformSize ? 1 : 0;
    const probabilities = compressedHeader.transformProbabilities[maximumTransformSize][transformContext];
    let transformSize = decoder.read(probabilities[0]);
    if (transformSize !== 0 && maximumTransformSize >= 2) {
      transformSize += decoder.read(probabilities[1]);
      if (transformSize !== 1 && maximumTransformSize >= 3) {
        transformSize += decoder.read(probabilities[2]);
      }
    }
    modeInformation.transformSize = transformSize;
  } else {
    const transformModeMaximum = [0, 1, 2, 3, 3][compressedHeader.transformMode];
    modeInformation.transformSize = Math.min(maximumTransformSize, transformModeMaximum);
  }

  if (blockSize === 0) {
    for (let blockIndex = 0; blockIndex < 4; blockIndex += 1) {
      modeInformation.subBlockModes[blockIndex] = readKeyframeLumaMode(
        decoder,
        modeInformation,
        aboveModeInformation,
        leftModeInformation,
        blockIndex
      );
    }
    modeInformation.lumaMode = modeInformation.subBlockModes[3];
  } else if (blockSize === 1) {
    modeInformation.subBlockModes[0] = modeInformation.subBlockModes[2] = readKeyframeLumaMode(
      decoder,
      modeInformation,
      aboveModeInformation,
      leftModeInformation,
      0
    );
    modeInformation.subBlockModes[1] = modeInformation.subBlockModes[3] = readKeyframeLumaMode(
      decoder,
      modeInformation,
      aboveModeInformation,
      leftModeInformation,
      1
    );
    modeInformation.lumaMode = modeInformation.subBlockModes[3];
  } else if (blockSize === 2) {
    modeInformation.subBlockModes[0] = modeInformation.subBlockModes[1] = readKeyframeLumaMode(
      decoder,
      modeInformation,
      aboveModeInformation,
      leftModeInformation,
      0
    );
    modeInformation.subBlockModes[2] = modeInformation.subBlockModes[3] = readKeyframeLumaMode(
      decoder,
      modeInformation,
      aboveModeInformation,
      leftModeInformation,
      2
    );
    modeInformation.lumaMode = modeInformation.subBlockModes[3];
  } else {
    modeInformation.lumaMode = readKeyframeLumaMode(
      decoder,
      modeInformation,
      aboveModeInformation,
      leftModeInformation,
      0
    );
    modeInformation.subBlockModes.fill(modeInformation.lumaMode);
  }
  modeInformation.chromaMode = decoder.readTree(
    INTRA_MODE_TREE,
    keyframeUvModeProbabilities(modeInformation.lumaMode)
  );
  return modeInformation;
}

function transformContext(aboveContexts, leftContexts, aboveOffset, leftOffset, transformSize) {
  const contextLength = 1 << transformSize;
  let hasAbove = false;
  let hasLeft = false;
  for (let index = 0; index < contextLength; index += 1) {
    hasAbove ||= Boolean(aboveContexts[aboveOffset + index]);
    hasLeft ||= Boolean(leftContexts[leftOffset + index]);
  }
  return Number(hasAbove) + Number(hasLeft);
}

function updateTransformContexts(contexts, offset, transformSize, maximumLength, hasCoefficients) {
  const contextLength = 1 << transformSize;
  for (let index = 0; index < contextLength; index += 1) {
    contexts[offset + index] = index < maximumLength ? Number(hasCoefficients) : 0;
  }
}

function maximumUvTransformSize(numberOf4x4Columns, numberOf4x4Rows) {
  const minimumDimension = Math.min(numberOf4x4Columns, numberOf4x4Rows);
  return Math.min(3, Math.max(0, Math.floor(Math.log2(minimumDimension))));
}

function residualModeForTransform(modeInformation, blockSize, plane, row, column) {
  if (plane !== 0 || blockSize >= 3) return plane === 0
    ? modeInformation.lumaMode
    : modeInformation.chromaMode;
  return modeInformation.subBlockModes[(row << 1) + column];
}

function decodeResidualSyntax(decoder, tileState, blockState, modeInformation) {
  const { frameHeader, compressedHeader, aboveEntropyContexts, leftEntropyContexts } = tileState;
  const { miRow, miColumn, blockSize, widthInMi, heightInMi } = blockState;
  const transforms = [];
  const overflowColumnsInMi = Math.min(0, frameHeader.miColumns - widthInMi - miColumn);
  const overflowRowsInMi = Math.min(0, frameHeader.miRows - heightInMi - miRow);

  for (let plane = 0; plane < 3; plane += 1) {
    const subsamplingX = plane === 0 ? 0 : frameHeader.subsamplingX;
    const subsamplingY = plane === 0 ? 0 : frameHeader.subsamplingY;
    const numberOf4x4Columns = (widthInMi << 1) >> subsamplingX;
    const numberOf4x4Rows = (heightInMi << 1) >> subsamplingY;
    const transformSize = plane === 0
      ? modeInformation.transformSize
      : Math.min(
        modeInformation.transformSize,
        maximumUvTransformSize(numberOf4x4Columns, numberOf4x4Rows)
      );
    const step = 1 << transformSize;
    const maximumColumns = numberOf4x4Columns + overflowColumnsInMi * (2 >> subsamplingX);
    const maximumRows = numberOf4x4Rows + overflowRowsInMi * (2 >> subsamplingY);
    const aboveBase = (miColumn << 1) >> subsamplingX;
    const leftBase = ((miRow << 1) & 15) >> subsamplingY;

    if (modeInformation.skip) {
      for (let column = 0; column < numberOf4x4Columns; column += 1) {
        aboveEntropyContexts[plane][aboveBase + column] = 0;
      }
      for (let row = 0; row < numberOf4x4Rows; row += 1) {
        leftEntropyContexts[plane][leftBase + row] = 0;
      }
      continue;
    }

    for (let row = 0; row < maximumRows; row += step) {
      for (let column = 0; column < maximumColumns; column += step) {
        const initialContext = transformContext(
          aboveEntropyContexts[plane],
          leftEntropyContexts[plane],
          aboveBase + column,
          leftBase + row,
          transformSize
        );
        const predictionMode = residualModeForTransform(modeInformation, blockSize, plane, row, column);
        const transformType = plane === 0 && !frameHeader.quantization.lossless
          ? INTRA_MODE_TO_TRANSFORM_TYPE[predictionMode]
          : 0;
        const coefficientResult = decodeCoefficientBlock(
          decoder,
          compressedHeader.coefficientProbabilities[transformSize],
          { transformSize, planeType: plane === 0 ? 0 : 1, initialContext, transformType }
        );
        const hasCoefficients = coefficientResult.endOfBlock > 0;
        updateTransformContexts(
          aboveEntropyContexts[plane],
          aboveBase + column,
          transformSize,
          Math.max(0, maximumColumns - column),
          hasCoefficients
        );
        updateTransformContexts(
          leftEntropyContexts[plane],
          leftBase + row,
          transformSize,
          Math.max(0, maximumRows - row),
          hasCoefficients
        );
        reserveStructureRecord(tileState);
        transforms.push({
          plane: plane === 0 ? "Y" : plane === 1 ? "U" : "V",
          x: miColumn * 8 + ((column * 4) << subsamplingX),
          y: miRow * 8 + ((row * 4) << subsamplingY),
          codedWidth: (4 << transformSize) << subsamplingX,
          codedHeight: (4 << transformSize) << subsamplingY,
          transformSize: TRANSFORM_SIZE_NAMES[transformSize],
          transformType: TRANSFORM_TYPE_NAMES[transformType],
          predictionMode: INTRA_MODE_NAMES[predictionMode],
          accountingKind: "probability-self-information",
          physicalBits: null,
          ownBits: null,
          syntaxBits: null,
          subtreeBits: null,
          ...coefficientResult
        });
      }
    }
  }
  return transforms;
}

function actualBlockGeometries(frameHeader, blockState) {
  const { miRow, miColumn, blockSize, widthInMi, heightInMi } = blockState;
  const block = BLOCK_SIZES[blockSize];
  const groupX = miColumn * 8;
  const groupY = miRow * 8;
  const groupWidth = widthInMi * 8;
  const groupHeight = heightInMi * 8;
  const geometries = [];
  for (let y = 0; y < groupHeight; y += block.height) {
    for (let x = 0; x < groupWidth; x += block.width) {
      const codedWidth = Math.min(block.width, groupWidth - x);
      const codedHeight = Math.min(block.height, groupHeight - y);
      geometries.push({
        x: groupX + x,
        y: groupY + y,
        codedWidth,
        codedHeight,
        visibleWidth: Math.max(0, Math.min(codedWidth, frameHeader.width - groupX - x)),
        visibleHeight: Math.max(0, Math.min(codedHeight, frameHeader.height - groupY - y))
      });
    }
  }
  return geometries;
}

function decodeBlock(decoder, tileState, blockState, parentNodeId) {
  const blockStart = decoder.snapshot();
  const modeInformation = readModeInformation(decoder, tileState, blockState);
  const modeEnd = decoder.snapshot();
  const transforms = decodeResidualSyntax(decoder, tileState, blockState, modeInformation);
  const blockAccounting = decoder.measureFrom(blockStart);
  const modeAccounting = {
    entropyBits: modeEnd.informationBits - blockStart.informationBits,
    normalizationBits: modeEnd.normalizationBits - blockStart.normalizationBits,
    symbolCount: modeEnd.symbolCount - blockStart.symbolCount
  };
  const residualAccounting = {
    entropyBits: blockAccounting.entropyBits - modeAccounting.entropyBits,
    normalizationBits: blockAccounting.normalizationBits - modeAccounting.normalizationBits,
    symbolCount: blockAccounting.symbolCount - modeAccounting.symbolCount
  };
  const geometries = actualBlockGeometries(tileState.frameHeader, blockState);
  const visibleArea = geometries.reduce(
    (sum, geometry) => sum + geometry.visibleWidth * geometry.visibleHeight,
    0
  );
  const leafId = "vp9-leaf-" + tileState.leaves.length;
  const leaf = {
    id: leafId,
    parentNodeId,
    tileIndex: tileState.tileIndex,
    granularity: "partition-leaf",
    blockSize: BLOCK_SIZES[blockState.blockSize].name,
    syntaxGroup: {
      x: blockState.miColumn * 8,
      y: blockState.miRow * 8,
      codedWidth: blockState.widthInMi * 8,
      codedHeight: blockState.heightInMi * 8,
      visibleWidth: Math.max(
        0,
        Math.min(blockState.widthInMi * 8, tileState.frameHeader.width - blockState.miColumn * 8)
      ),
      visibleHeight: Math.max(
        0,
        Math.min(blockState.heightInMi * 8, tileState.frameHeader.height - blockState.miRow * 8)
      )
    },
    blocks: geometries,
    segmentId: modeInformation.segmentId,
    skip: Boolean(modeInformation.skip),
    transformSize: TRANSFORM_SIZE_NAMES[modeInformation.transformSize],
    lumaMode: INTRA_MODE_NAMES[modeInformation.lumaMode],
    chromaMode: INTRA_MODE_NAMES[modeInformation.chromaMode],
    subBlockModes: blockState.blockSize < 3
      ? modeInformation.subBlockModes.map(mode => INTRA_MODE_NAMES[mode])
      : [],
    transforms,
    accountingKind: "probability-self-information",
    physicalBits: null,
    ownBits: null,
    syntaxBits: null,
    subtreeBits: null,
    entropyBits: blockAccounting.entropyBits,
    entropyBitsPerVisiblePixel: visibleArea ? blockAccounting.entropyBits / visibleArea : null,
    modeAccounting,
    residualAccounting,
    symbolCount: blockAccounting.symbolCount,
    normalizationBits: blockAccounting.normalizationBits
  };
  reserveStructureRecord(tileState);
  tileState.leaves.push(leaf);
  return leafId;
}

function partitionContext(tileState, miRow, miColumn, blockSizeLog2) {
  const above = (tileState.partitionAbove[miColumn] >> blockSizeLog2) & 1;
  const left = (tileState.partitionLeft[miRow & 7] >> blockSizeLog2) & 1;
  return blockSizeLog2 * 4 + left * 2 + above;
}

function updatePartitionContexts(tileState, miRow, miColumn, subsize, widthInMi) {
  const aboveValue = PARTITION_CONTEXT_ABOVE[subsize];
  const leftValue = PARTITION_CONTEXT_LEFT[subsize];
  tileState.partitionAbove.fill(aboveValue, miColumn, miColumn + widthInMi);
  tileState.partitionLeft.fill(leftValue, miRow & 7, (miRow & 7) + widthInMi);
}

function readPartition(decoder, tileState, miRow, miColumn, hasRows, hasColumns, blockSizeLog2) {
  const context = partitionContext(tileState, miRow, miColumn, blockSizeLog2);
  const start = context * 3;
  const probabilities = KEYFRAME_PARTITION_PROBABILITIES.subarray(start, start + 3);
  const entropyStart = decoder.snapshot();
  let partition;
  if (hasRows && hasColumns) {
    partition = decoder.readTree(PARTITION_TREE, probabilities);
  } else if (!hasRows && hasColumns) {
    partition = decoder.read(probabilities[1]) ? 3 : 1;
  } else if (hasRows && !hasColumns) {
    partition = decoder.read(probabilities[2]) ? 3 : 2;
  } else {
    partition = 3;
  }
  return { partition, context, ...decoder.measureFrom(entropyStart) };
}

function decodePartition(decoder, tileState, options) {
  const { miRow, miColumn, blockSize, numberOf4x4Log2, parentNodeId, depth } = options;
  const frameHeader = tileState.frameHeader;
  if (miRow >= frameHeader.miRows || miColumn >= frameHeader.miColumns) return null;
  const numberOf8x8Log2 = numberOf4x4Log2 - 1;
  const widthInMi = 1 << numberOf8x8Log2;
  const halfBlockInMi = widthInMi >> 1;
  const hasRows = miRow + halfBlockInMi < frameHeader.miRows;
  const hasColumns = miColumn + halfBlockInMi < frameHeader.miColumns;
  const partitionResult = readPartition(
    decoder,
    tileState,
    miRow,
    miColumn,
    hasRows,
    hasColumns,
    numberOf8x8Log2
  );
  const subsize = PARTITION_SUBSIZES[partitionResult.partition][blockSize];
  if (subsize < 0) throw new Error("Invalid VP9 partition/block-size combination.");
  const nodeId = "vp9-node-" + tileState.treeNodes.length;
  const node = {
    id: nodeId,
    parentNodeId,
    tileIndex: tileState.tileIndex,
    depth,
    x: miColumn * 8,
    y: miRow * 8,
    codedWidth: BLOCK_SIZES[blockSize].width,
    codedHeight: BLOCK_SIZES[blockSize].height,
    visibleWidth: Math.max(0, Math.min(BLOCK_SIZES[blockSize].width, frameHeader.width - miColumn * 8)),
    visibleHeight: Math.max(0, Math.min(BLOCK_SIZES[blockSize].height, frameHeader.height - miRow * 8)),
    blockSize: BLOCK_SIZES[blockSize].name,
    partition: PARTITION_NAMES[partitionResult.partition],
    partitionContext: partitionResult.context,
    accountingKind: "probability-self-information",
    physicalBits: null,
    ownBits: null,
    syntaxBits: null,
    subtreeBits: null,
    partitionEntropyBits: partitionResult.entropyBits,
    partitionSymbolCount: partitionResult.symbolCount,
    children: [],
    leaves: []
  };
  reserveStructureRecord(tileState);
  tileState.treeNodes.push(node);

  if (!halfBlockInMi) {
    const leafId = decodeBlock(
      decoder,
      tileState,
      {
        miRow,
        miColumn,
        blockSize: subsize,
        widthInMi: 1,
        heightInMi: 1,
        tileColumnStart: tileState.tileColumnStart
      },
      nodeId
    );
    node.leaves.push(leafId);
  } else if (partitionResult.partition === 0) {
    node.leaves.push(decodeBlock(
      decoder,
      tileState,
      {
        miRow,
        miColumn,
        blockSize: subsize,
        widthInMi,
        heightInMi: widthInMi,
        tileColumnStart: tileState.tileColumnStart
      },
      nodeId
    ));
  } else if (partitionResult.partition === 1) {
    node.leaves.push(decodeBlock(
      decoder,
      tileState,
      {
        miRow,
        miColumn,
        blockSize: subsize,
        widthInMi,
        heightInMi: halfBlockInMi,
        tileColumnStart: tileState.tileColumnStart
      },
      nodeId
    ));
    if (hasRows) {
      node.leaves.push(decodeBlock(
        decoder,
        tileState,
        {
          miRow: miRow + halfBlockInMi,
          miColumn,
          blockSize: subsize,
          widthInMi,
          heightInMi: halfBlockInMi,
          tileColumnStart: tileState.tileColumnStart
        },
        nodeId
      ));
    }
  } else if (partitionResult.partition === 2) {
    node.leaves.push(decodeBlock(
      decoder,
      tileState,
      {
        miRow,
        miColumn,
        blockSize: subsize,
        widthInMi: halfBlockInMi,
        heightInMi: widthInMi,
        tileColumnStart: tileState.tileColumnStart
      },
      nodeId
    ));
    if (hasColumns) {
      node.leaves.push(decodeBlock(
        decoder,
        tileState,
        {
          miRow,
          miColumn: miColumn + halfBlockInMi,
          blockSize: subsize,
          widthInMi: halfBlockInMi,
          heightInMi: widthInMi,
          tileColumnStart: tileState.tileColumnStart
        },
        nodeId
      ));
    }
  } else {
    const childCoordinates = [
      [miRow, miColumn],
      [miRow, miColumn + halfBlockInMi],
      [miRow + halfBlockInMi, miColumn],
      [miRow + halfBlockInMi, miColumn + halfBlockInMi]
    ];
    for (const [childRow, childColumn] of childCoordinates) {
      const childId = decodePartition(decoder, tileState, {
        miRow: childRow,
        miColumn: childColumn,
        blockSize: subsize,
        numberOf4x4Log2: numberOf8x8Log2,
        parentNodeId: nodeId,
        depth: depth + 1
      });
      if (childId) node.children.push(childId);
    }
  }

  if (blockSize >= 3 && (blockSize === 3 || partitionResult.partition !== 3)) {
    updatePartitionContexts(tileState, miRow, miColumn, subsize, widthInMi);
  }
  return nodeId;
}

function tileOffset(tileIndex, miCount, log2TileCount) {
  const superblockCount = Math.ceil(miCount / 8);
  return Math.min(((tileIndex * superblockCount) >> log2TileCount) << 3, miCount);
}

function readTileBuffers(bytes, tileDataOffset, tileInformation) {
  const buffers = [];
  let offset = tileDataOffset;
  const totalTiles = tileInformation.columns * tileInformation.rows;
  for (let tileIndex = 0; tileIndex < totalTiles; tileIndex += 1) {
    const sizeFieldOffset = offset;
    let sizeFieldBytes = 0;
    let size;
    if (tileIndex + 1 < totalTiles) {
      if (offset + 4 > bytes.byteLength) throw new Error("Truncated VP9 tile size field.");
      size = bytes[offset] * 0x1000000 + bytes[offset + 1] * 0x10000 +
        bytes[offset + 2] * 0x100 + bytes[offset + 3];
      offset += 4;
      sizeFieldBytes = 4;
    } else {
      size = bytes.byteLength - offset;
    }
    if (size <= 0 || offset + size > bytes.byteLength) throw new Error("Invalid VP9 tile payload size.");
    buffers.push({
      tileIndex,
      sizeFieldOffset,
      sizeFieldBytes,
      payloadOffset: offset,
      payloadSize: size,
      bytes: bytes.subarray(offset, offset + size)
    });
    offset += size;
  }
  return buffers;
}

function parseTiles(bytes, frameHeader, compressedHeader, tileDataOffset) {
  const tileBuffers = readTileBuffers(bytes, tileDataOffset, frameHeader.tileInformation);
  const treeNodes = [];
  const leaves = [];
  const rootNodeIds = [];
  const tiles = [];
  const modeGrid = new Array(frameHeader.miColumns * frameHeader.miRows).fill(null);
  const alignedMiColumns = Math.ceil(frameHeader.miColumns / 8) * 8;
  const aboveEntropyContexts = [
    new Uint8Array(alignedMiColumns * 2),
    new Uint8Array(alignedMiColumns * 2),
    new Uint8Array(alignedMiColumns * 2)
  ];
  const partitionAbove = new Uint8Array(alignedMiColumns);
  const structureRecordBudget = { used: 0 };

  for (const tileBuffer of tileBuffers) {
    const tileRow = Math.floor(tileBuffer.tileIndex / frameHeader.tileInformation.columns);
    const tileColumn = tileBuffer.tileIndex % frameHeader.tileInformation.columns;
    const tileRowStart = tileOffset(tileRow, frameHeader.miRows, frameHeader.tileInformation.log2Rows);
    const tileRowEnd = tileOffset(tileRow + 1, frameHeader.miRows, frameHeader.tileInformation.log2Rows);
    const tileColumnStart = tileOffset(tileColumn, frameHeader.miColumns, frameHeader.tileInformation.log2Columns);
    const tileColumnEnd = tileOffset(tileColumn + 1, frameHeader.miColumns, frameHeader.tileInformation.log2Columns);
    const decoder = new Vp9RangeDecoder(tileBuffer.bytes, { label: "VP9 tile " + tileBuffer.tileIndex });
    const syntaxStart = decoder.snapshot();
    const tileState = {
      frameHeader,
      compressedHeader,
      tileIndex: tileBuffer.tileIndex,
      tileColumnStart,
      treeNodes,
      leaves,
      modeGrid,
      aboveEntropyContexts,
      leftEntropyContexts: [new Uint8Array(16), new Uint8Array(16), new Uint8Array(16)],
      partitionAbove,
      partitionLeft: new Uint8Array(8),
      structureRecordBudget
    };
    const tileRootIds = [];
    for (let miRow = tileRowStart; miRow < tileRowEnd; miRow += 8) {
      for (const contexts of tileState.leftEntropyContexts) contexts.fill(0);
      tileState.partitionLeft.fill(0);
      for (let miColumn = tileColumnStart; miColumn < tileColumnEnd; miColumn += 8) {
        const rootId = decodePartition(decoder, tileState, {
          miRow,
          miColumn,
          blockSize: 12,
          numberOf4x4Log2: 4,
          parentNodeId: null,
          depth: 0
        });
        if (rootId) {
          tileRootIds.push(rootId);
          rootNodeIds.push(rootId);
        }
      }
    }
    if (decoder.hasError()) throw new Error("VP9 tile " + tileBuffer.tileIndex + " boolean payload is truncated.");
    const tileAccounting = decoder.measureFrom(syntaxStart);
    tiles.push({
      tileIndex: tileBuffer.tileIndex,
      tileRow,
      tileColumn,
      miRowStart: tileRowStart,
      miRowEnd: tileRowEnd,
      miColumnStart: tileColumnStart,
      miColumnEnd: tileColumnEnd,
      sizeFieldOffset: tileBuffer.sizeFieldOffset,
      sizeFieldBytes: tileBuffer.sizeFieldBytes,
      payloadOffset: tileBuffer.payloadOffset,
      payloadSize: tileBuffer.payloadSize,
      rootNodeIds: tileRootIds,
      accountingKind: "probability-self-information",
      physicalPayloadBits: tileBuffer.payloadSize * 8,
      physicalSyntaxBits: null,
      markerEntropyBits: 1,
      ...tileAccounting
    });
  }
  return { tiles, treeNodes, leaves, rootNodeIds };
}

function createRootUnits(frameHeader) {
  if (!frameHeader.width || !frameHeader.height) return [];
  if (Math.ceil(frameHeader.width / 64) * Math.ceil(frameHeader.height / 64) > MAX_VP9_ROOT_UNITS) return [];
  const roots = [];
  for (let y = 0; y < frameHeader.height; y += 64) {
    for (let x = 0; x < frameHeader.width; x += 64) {
      roots.push({
        id: "vp9-root-unit-" + roots.length,
        granularity: "root-unit",
        structureStatus: "partition-syntax-unavailable",
        x,
        y,
        codedWidth: 64,
        codedHeight: 64,
        visibleWidth: Math.min(64, frameHeader.width - x),
        visibleHeight: Math.min(64, frameHeader.height - y),
        partition: null,
        physicalBits: null,
        ownBits: null,
        syntaxBits: null,
        subtreeBits: null,
        entropyBits: null
      });
    }
  }
  return roots;
}

function unsupportedResult(bytes, frameHeader, reason, warnings = []) {
  const rootUnits = createRootUnits(frameHeader);
  return {
    codec: "VP9",
    supported: false,
    complete: false,
    sampleBits: bytes.byteLength * 8,
    granularity: rootUnits.length ? "root-units" : "structured-unavailable",
    structureStatus: rootUnits.length ? "root-only" : "unavailable",
    reason,
    frameHeader,
    compressedHeader: null,
    tiles: [],
    treeNodes: [],
    leaves: [],
    rootUnits,
    accounting: {
      sampleBits: bytes.byteLength * 8,
      uncompressedHeaderEnvelopeBits: frameHeader.rawBytes ? frameHeader.rawBytes * 8 : null,
      compressedHeaderPayloadBits: null,
      tileSizeFieldBits: null,
      tilePayloadBits: null,
      blockPhysicalBitsAvailable: false
    },
    warnings
  };
}

function parseVp9FrameInternals(bytes) {
  if (!isUint8Array(bytes)) {
    throw new TypeError("VP9 frame internals input must be a Uint8Array.");
  }
  let frameHeader;
  try {
    frameHeader = parseUncompressedHeader(bytes);
  } catch (error) {
    return unsupportedResult(bytes, {}, "invalid-uncompressed-header", [String(error.message || error)]);
  }

  if (frameHeader.showExistingFrame) {
    return unsupportedResult(bytes, frameHeader, "show-existing-frame");
  }
  if (frameHeader.statefulInterFrame) {
    return unsupportedResult(bytes, frameHeader, "stateful-inter-frame");
  }
  if (Math.ceil(frameHeader.width / 64) * Math.ceil(frameHeader.height / 64) > MAX_VP9_ROOT_UNITS) {
    return unsupportedResult(bytes, frameHeader, "root-grid-safety-limit", [
      "VP9 superblock grid exceeds the 100,000-cell safety limit."
    ]);
  }
  if (frameHeader.miColumns * frameHeader.miRows > MAX_VP9_MODE_GRID_ENTRIES) {
    return unsupportedResult(bytes, frameHeader, "mode-grid-safety-limit", [
      "VP9 mode-info grid exceeds the 1,000,000-entry worker safety limit."
    ]);
  }
  if (frameHeader.profile !== 0) {
    return unsupportedResult(bytes, frameHeader, "unsupported-profile-" + frameHeader.profile, [
      "Full partition traversal currently supports only VP9 Profile 0; no partition data was inferred."
    ]);
  }

  const compressedHeaderOffset = frameHeader.rawBytes;
  const tileDataOffset = compressedHeaderOffset + frameHeader.firstPartitionSize;
  if (tileDataOffset > bytes.byteLength) {
    return unsupportedResult(bytes, frameHeader, "truncated-compressed-header", [
      "The compressed header size exceeds the frame payload."
    ]);
  }

  try {
    const compressedHeader = parseCompressedHeader(
      bytes.subarray(compressedHeaderOffset, tileDataOffset),
      frameHeader
    );
    const parsedTiles = parseTiles(bytes, frameHeader, compressedHeader, tileDataOffset);
    const tileSizeFieldBits = parsedTiles.tiles.reduce((sum, tile) => sum + tile.sizeFieldBytes * 8, 0);
    const tilePayloadBits = parsedTiles.tiles.reduce((sum, tile) => sum + tile.payloadSize * 8, 0);
    const partitionEntropyBits = parsedTiles.treeNodes.reduce(
      (sum, node) => sum + node.partitionEntropyBits,
      0
    );
    const blockEntropyBits = parsedTiles.leaves.reduce((sum, leaf) => sum + leaf.entropyBits, 0);
    return {
      codec: "VP9",
      supported: true,
      complete: true,
      sampleBits: bytes.byteLength * 8,
      granularity: "partition-tree",
      structureStatus: "decoded",
      frameHeader,
      compressedHeader: {
        transformMode: compressedHeader.transformMode,
        transformModeName: compressedHeader.transformModeName,
        coefficientUpdatesByTransform: compressedHeader.coefficientUpdatesByTransform,
        accountingKind: "probability-self-information",
        markerEntropyBits: compressedHeader.markerEntropyBits,
        entropyBits: compressedHeader.entropyBits,
        symbolCount: compressedHeader.symbolCount,
        normalizationBits: compressedHeader.normalizationBits
      },
      tiles: parsedTiles.tiles,
      treeNodes: parsedTiles.treeNodes,
      leaves: parsedTiles.leaves,
      rootNodeIds: parsedTiles.rootNodeIds,
      rootUnits: [],
      accounting: {
        accountingKind: "wire-envelope-plus-probability-self-information",
        sampleBits: bytes.byteLength * 8,
        uncompressedHeaderSyntaxBits: frameHeader.rawBits,
        uncompressedHeaderEnvelopeBits: frameHeader.rawBytes * 8,
        uncompressedHeaderBytePaddingBits: frameHeader.rawBytes * 8 - frameHeader.rawBits,
        compressedHeaderPayloadBits: frameHeader.firstPartitionSize * 8,
        tileSizeFieldBits,
        tilePayloadBits,
        partitionEntropyBits,
        blockEntropyBits,
        tileEntropyBits: parsedTiles.tiles.reduce((sum, tile) => sum + tile.entropyBits, 0),
        blockPhysicalBitsAvailable: false
      },
      limitations: [
        "Per-block physical byte boundaries do not exist in VP9 arithmetic-coded tile payloads.",
        "entropyBits is fractional probability self-information, not an integer wire-bit allocation.",
        "Pixel reconstruction and decoded-pixel inference are intentionally not performed."
      ],
      warnings: []
    };
  } catch (error) {
    return unsupportedResult(bytes, frameHeader, "tile-syntax-decode-failed", [
      String(error.message || error),
      "Only exact 64x64 root units are returned; no partition structure was inferred."
    ]);
  }
}

export { parseVp9FrameInternals, parseUncompressedHeader };
