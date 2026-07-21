/*
 * Native AVC syntax inspection implemented directly from ITU-T H.264 (08/2024).
 * This is an entropy-syntax walker, not a decoder: it does not reconstruct pixels.
 * Normative CABAC/CAVLC table data below is identified by its H.264 table number.
 * Syntax sources: clauses 7.3.2.1, 7.3.2.2, 7.3.3, 7.3.5, 9.2, and 9.3.
 */

const AVC_MACROBLOCK_SIZE = 16;
const MAX_AVC_MACROBLOCKS = 100_000;
const MAX_AVC_STRUCTURE_RECORDS = 100_000;
const MAX_AVC_NAL_UNITS = 65_536;
const MAX_EXP_GOLOMB_LEADING_ZERO_BITS = 31;
const SLICE_TYPE_P = 0;
const SLICE_TYPE_B = 1;
const SLICE_TYPE_I = 2;
const SLICE_TYPE_SP = 3;
const SLICE_TYPE_SI = 4;
const NAL_TYPE_NON_IDR_SLICE = 1;
const NAL_TYPE_IDR_SLICE = 5;
const NAL_TYPE_SPS = 7;
const NAL_TYPE_PPS = 8;

const HIGH_PROFILE_IDS = new Set([
  44, 83, 86, 100, 110, 118, 122, 128, 134, 135, 138, 139, 244
]);

class AvcSyntaxError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "AvcSyntaxError";
    this.code = code;
  }
}

class RbspBitReader {
  constructor(bytes, bitOffset = 0) {
    this.bytes = bytes;
    this.bitOffset = bitOffset;
  }

  get totalBits() {
    return this.bytes.byteLength * 8;
  }

  get bitsRemaining() {
    return this.totalBits - this.bitOffset;
  }

  readBit() {
    if (this.bitOffset >= this.totalBits) {
      throw new AvcSyntaxError("unexpected-end-of-rbsp", "Unexpected end of AVC RBSP.");
    }
    const byte = this.bytes[this.bitOffset >> 3];
    const bit = (byte >> (7 - (this.bitOffset & 7))) & 1;
    this.bitOffset += 1;
    return bit;
  }

  readBits(count) {
    if (!Number.isInteger(count) || count < 0 || count > 32) {
      throw new AvcSyntaxError("invalid-bit-count", "Invalid AVC bit count " + count + ".");
    }
    let value = 0;
    for (let index = 0; index < count; index += 1) {
      value = value * 2 + this.readBit();
    }
    return value;
  }

  skipBits(count) {
    if (!Number.isInteger(count) || count < 0 || count > this.bitsRemaining) {
      throw new AvcSyntaxError("unexpected-end-of-rbsp", "AVC syntax exceeds the available RBSP bits.");
    }
    this.bitOffset += count;
  }

  readUE() {
    let leadingZeroBits = 0;
    while (this.readBit() === 0) {
      leadingZeroBits += 1;
      if (leadingZeroBits > MAX_EXP_GOLOMB_LEADING_ZERO_BITS) {
        throw new AvcSyntaxError("exp-golomb-too-large", "AVC Exp-Golomb value is too large.");
      }
    }
    const suffix = leadingZeroBits ? this.readBits(leadingZeroBits) : 0;
    return (2 ** leadingZeroBits) - 1 + suffix;
  }

  readSE() {
    const codeNum = this.readUE();
    return codeNum & 1 ? (codeNum + 1) / 2 : -(codeNum / 2);
  }

  alignToByte(expectedBit = null) {
    while (this.bitOffset & 7) {
      const bit = this.readBit();
      if (expectedBit !== null && bit !== expectedBit) {
        throw new AvcSyntaxError(
          "invalid-alignment-bit",
          "AVC alignment bit was " + bit + ", expected " + expectedBit + "."
        );
      }
    }
  }

  moreRbspData() {
    if (this.bitsRemaining <= 0) return false;
    const savedBitOffset = this.bitOffset;
    const firstBit = this.readBit();
    if (firstBit === 0) {
      this.bitOffset = savedBitOffset;
      return true;
    }
    while (this.bitOffset < this.totalBits) {
      if (this.readBit() !== 0) {
        this.bitOffset = savedBitOffset;
        return true;
      }
    }
    this.bitOffset = savedBitOffset;
    return false;
  }
}

function removeEmulationPreventionBytes(bytes) {
  const output = [];
  let consecutiveZeroBytes = 0;
  for (const byte of bytes) {
    if (consecutiveZeroBytes >= 2 && byte === 0x03) {
      consecutiveZeroBytes = 0;
      continue;
    }
    output.push(byte);
    consecutiveZeroBytes = byte === 0 ? consecutiveZeroBytes + 1 : 0;
  }
  return new Uint8Array(output);
}

function readScalingList(bitReader, size) {
  let lastScale = 8;
  let nextScale = 8;
  for (let index = 0; index < size; index += 1) {
    if (nextScale !== 0) nextScale = (lastScale + bitReader.readSE() + 256) % 256;
    if (nextScale !== 0) lastScale = nextScale;
  }
}

function parseSpsNalUnit(nalUnit) {
  const bytes = normalizeBytes(nalUnit);
  if (!bytes.byteLength || (bytes[0] & 0x1f) !== NAL_TYPE_SPS) {
    throw new AvcSyntaxError("not-sps", "AVC parameter-set entry is not an SPS NAL unit.");
  }
  const bitReader = new RbspBitReader(removeEmulationPreventionBytes(bytes.subarray(1)));
  const profileIdc = bitReader.readBits(8);
  const profileCompatibility = bitReader.readBits(8);
  const levelIdc = bitReader.readBits(8);
  const sequenceParameterSetId = bitReader.readUE();
  let chromaFormatIdc = profileIdc === 138 ? 0 : 1;
  let separateColourPlaneFlag = false;
  let bitDepthLumaMinus8 = 0;
  let bitDepthChromaMinus8 = 0;
  let qpprimeYZeroTransformBypassFlag = false;

  if (HIGH_PROFILE_IDS.has(profileIdc)) {
    chromaFormatIdc = bitReader.readUE();
    if (chromaFormatIdc > 3) {
      throw new AvcSyntaxError("invalid-chroma-format", "Invalid AVC chroma_format_idc " + chromaFormatIdc + ".");
    }
    if (chromaFormatIdc === 3) separateColourPlaneFlag = Boolean(bitReader.readBit());
    bitDepthLumaMinus8 = bitReader.readUE();
    bitDepthChromaMinus8 = bitReader.readUE();
    if (bitDepthLumaMinus8 > 6 || bitDepthChromaMinus8 > 6) {
      throw new AvcSyntaxError("invalid-bit-depth", "AVC bit depth exceeds the normative 14-bit limit.");
    }
    qpprimeYZeroTransformBypassFlag = Boolean(bitReader.readBit());
    const sequenceScalingMatrixPresentFlag = Boolean(bitReader.readBit());
    if (sequenceScalingMatrixPresentFlag) {
      const scalingListCount = chromaFormatIdc === 3 ? 12 : 8;
      for (let listIndex = 0; listIndex < scalingListCount; listIndex += 1) {
        if (bitReader.readBit()) readScalingList(bitReader, listIndex < 6 ? 16 : 64);
      }
    }
  }

  const log2MaxFrameNumMinus4 = bitReader.readUE();
  if (log2MaxFrameNumMinus4 > 12) {
    throw new AvcSyntaxError("invalid-frame-number-width", "AVC log2_max_frame_num_minus4 exceeds 12.");
  }
  const picOrderCntType = bitReader.readUE();
  let log2MaxPicOrderCntLsbMinus4 = 0;
  let deltaPicOrderAlwaysZeroFlag = false;
  if (picOrderCntType === 0) {
    log2MaxPicOrderCntLsbMinus4 = bitReader.readUE();
    if (log2MaxPicOrderCntLsbMinus4 > 12) {
      throw new AvcSyntaxError("invalid-poc-width", "AVC log2_max_pic_order_cnt_lsb_minus4 exceeds 12.");
    }
  } else if (picOrderCntType === 1) {
    deltaPicOrderAlwaysZeroFlag = Boolean(bitReader.readBit());
    bitReader.readSE();
    bitReader.readSE();
    const referenceFrameCount = bitReader.readUE();
    if (referenceFrameCount > 255) {
      throw new AvcSyntaxError(
        "invalid-poc-cycle-length",
        "AVC num_ref_frames_in_pic_order_cnt_cycle exceeds the normative limit of 255."
      );
    }
    for (let index = 0; index < referenceFrameCount; index += 1) bitReader.readSE();
  } else if (picOrderCntType !== 2) {
    throw new AvcSyntaxError("invalid-poc-type", "Invalid AVC pic_order_cnt_type " + picOrderCntType + ".");
  }

  const maxNumRefFrames = bitReader.readUE();
  const gapsInFrameNumValueAllowedFlag = Boolean(bitReader.readBit());
  const picWidthInMbsMinus1 = bitReader.readUE();
  const picHeightInMapUnitsMinus1 = bitReader.readUE();
  const frameMbsOnlyFlag = Boolean(bitReader.readBit());
  const mbAdaptiveFrameFieldFlag = frameMbsOnlyFlag ? false : Boolean(bitReader.readBit());
  const direct8x8InferenceFlag = Boolean(bitReader.readBit());
  const frameCroppingFlag = Boolean(bitReader.readBit());
  let frameCropLeftOffset = 0;
  let frameCropRightOffset = 0;
  let frameCropTopOffset = 0;
  let frameCropBottomOffset = 0;
  if (frameCroppingFlag) {
    frameCropLeftOffset = bitReader.readUE();
    frameCropRightOffset = bitReader.readUE();
    frameCropTopOffset = bitReader.readUE();
    frameCropBottomOffset = bitReader.readUE();
  }

  const frameHeightInMbs = (2 - Number(frameMbsOnlyFlag)) * (picHeightInMapUnitsMinus1 + 1);
  const codedWidth = (picWidthInMbsMinus1 + 1) * AVC_MACROBLOCK_SIZE;
  const codedHeight = frameHeightInMbs * AVC_MACROBLOCK_SIZE;
  const chromaArrayType = separateColourPlaneFlag ? 0 : chromaFormatIdc;
  const subWidthC = chromaArrayType === 1 || chromaArrayType === 2 ? 2 : 1;
  const subHeightC = chromaArrayType === 1 ? 2 : 1;
  const cropUnitX = chromaArrayType === 0 ? 1 : subWidthC;
  const cropUnitY = chromaArrayType === 0
    ? 2 - Number(frameMbsOnlyFlag)
    : subHeightC * (2 - Number(frameMbsOnlyFlag));
  const cropLeftPixels = frameCropLeftOffset * cropUnitX;
  const cropRightPixels = frameCropRightOffset * cropUnitX;
  const cropTopPixels = frameCropTopOffset * cropUnitY;
  const cropBottomPixels = frameCropBottomOffset * cropUnitY;
  const width = codedWidth - cropLeftPixels - cropRightPixels;
  const height = codedHeight - cropTopPixels - cropBottomPixels;
  if (width <= 0 || height <= 0) {
    throw new AvcSyntaxError("invalid-frame-dimensions", "AVC SPS cropping produces invalid frame dimensions.");
  }

  return {
    profileIdc,
    profileCompatibility,
    levelIdc,
    sequenceParameterSetId,
    chromaFormatIdc,
    chromaArrayType,
    separateColourPlaneFlag,
    bitDepthLumaMinus8,
    bitDepthChromaMinus8,
    qpprimeYZeroTransformBypassFlag,
    log2MaxFrameNumMinus4,
    picOrderCntType,
    log2MaxPicOrderCntLsbMinus4,
    deltaPicOrderAlwaysZeroFlag,
    maxNumRefFrames,
    gapsInFrameNumValueAllowedFlag,
    picWidthInMbsMinus1,
    picHeightInMapUnitsMinus1,
    frameHeightInMbs,
    frameMbsOnlyFlag,
    mbAdaptiveFrameFieldFlag,
    direct8x8InferenceFlag,
    frameCropLeftOffset,
    frameCropRightOffset,
    frameCropTopOffset,
    frameCropBottomOffset,
    cropLeftPixels,
    cropRightPixels,
    cropTopPixels,
    cropBottomPixels,
    codedWidth,
    codedHeight,
    width,
    height
  };
}

function parsePpsNalUnit(nalUnit, sequenceParameterSetsById) {
  const bytes = normalizeBytes(nalUnit);
  if (!bytes.byteLength || (bytes[0] & 0x1f) !== NAL_TYPE_PPS) {
    throw new AvcSyntaxError("not-pps", "AVC parameter-set entry is not a PPS NAL unit.");
  }
  const bitReader = new RbspBitReader(removeEmulationPreventionBytes(bytes.subarray(1)));
  const picParameterSetId = bitReader.readUE();
  const sequenceParameterSetId = bitReader.readUE();
  const entropyCodingModeFlag = Boolean(bitReader.readBit());
  const bottomFieldPicOrderInFramePresentFlag = Boolean(bitReader.readBit());
  const numSliceGroupsMinus1 = bitReader.readUE();
  if (numSliceGroupsMinus1 > 7) {
    throw new AvcSyntaxError("invalid-slice-group-count", "AVC num_slice_groups_minus1 exceeds 7.");
  }
  let sliceGroupMapType = 0;
  let picSizeInMapUnitsMinus1 = 0;
  let sliceGroupChangeRateMinus1 = 0;
  if (numSliceGroupsMinus1 > 0) {
    sliceGroupMapType = bitReader.readUE();
    if (sliceGroupMapType === 0) {
      for (let group = 0; group <= numSliceGroupsMinus1; group += 1) bitReader.readUE();
    } else if (sliceGroupMapType === 2) {
      for (let group = 0; group < numSliceGroupsMinus1; group += 1) {
        bitReader.readUE();
        bitReader.readUE();
      }
    } else if (sliceGroupMapType >= 3 && sliceGroupMapType <= 5) {
      bitReader.readBit();
      sliceGroupChangeRateMinus1 = bitReader.readUE();
    } else if (sliceGroupMapType === 6) {
      picSizeInMapUnitsMinus1 = bitReader.readUE();
      if (picSizeInMapUnitsMinus1 >= MAX_AVC_MACROBLOCKS) {
        throw new AvcSyntaxError("slice-group-map-budget-exceeded", "AVC explicit slice-group map is too large.");
      }
      const bitsPerSliceGroupId = Math.ceil(Math.log2(numSliceGroupsMinus1 + 1));
      for (let index = 0; index <= picSizeInMapUnitsMinus1; index += 1) {
        bitReader.readBits(bitsPerSliceGroupId);
      }
    } else {
      throw new AvcSyntaxError(
        "invalid-slice-group-map",
        "Invalid AVC slice_group_map_type " + sliceGroupMapType + "."
      );
    }
  }

  const numRefIdxL0DefaultActiveMinus1 = bitReader.readUE();
  const numRefIdxL1DefaultActiveMinus1 = bitReader.readUE();
  const weightedPredFlag = Boolean(bitReader.readBit());
  const weightedBipredIdc = bitReader.readBits(2);
  const picInitQpMinus26 = bitReader.readSE();
  const picInitQsMinus26 = bitReader.readSE();
  const chromaQpIndexOffset = bitReader.readSE();
  const deblockingFilterControlPresentFlag = Boolean(bitReader.readBit());
  const constrainedIntraPredFlag = Boolean(bitReader.readBit());
  const redundantPicCntPresentFlag = Boolean(bitReader.readBit());
  let transform8x8ModeFlag = false;
  let secondChromaQpIndexOffset = chromaQpIndexOffset;
  if (bitReader.moreRbspData()) {
    transform8x8ModeFlag = Boolean(bitReader.readBit());
    const picScalingMatrixPresentFlag = Boolean(bitReader.readBit());
    if (picScalingMatrixPresentFlag) {
      const sequenceParameterSet = sequenceParameterSetsById.get(sequenceParameterSetId);
      if (!sequenceParameterSet) {
        throw new AvcSyntaxError(
          "missing-sps",
          "AVC PPS " + picParameterSetId + " references missing SPS " + sequenceParameterSetId + "."
        );
      }
      const scalingListCount = 6 + (transform8x8ModeFlag
        ? (sequenceParameterSet.chromaFormatIdc === 3 ? 6 : 2)
        : 0);
      for (let listIndex = 0; listIndex < scalingListCount; listIndex += 1) {
        if (bitReader.readBit()) readScalingList(bitReader, listIndex < 6 ? 16 : 64);
      }
    }
    secondChromaQpIndexOffset = bitReader.readSE();
  }

  return {
    picParameterSetId,
    sequenceParameterSetId,
    entropyCodingModeFlag,
    bottomFieldPicOrderInFramePresentFlag,
    numSliceGroupsMinus1,
    sliceGroupMapType,
    picSizeInMapUnitsMinus1,
    sliceGroupChangeRateMinus1,
    numRefIdxL0DefaultActiveMinus1,
    numRefIdxL1DefaultActiveMinus1,
    weightedPredFlag,
    weightedBipredIdc,
    picInitQpMinus26,
    picInitQsMinus26,
    chromaQpIndexOffset,
    secondChromaQpIndexOffset,
    deblockingFilterControlPresentFlag,
    constrainedIntraPredFlag,
    redundantPicCntPresentFlag,
    transform8x8ModeFlag
  };
}

function parseAvcParameterSets(codecConfig) {
  const parameterSets = {
    sequenceParameterSetsById: new Map(),
    pictureParameterSetsById: new Map(),
    sequenceParameterSetBytesById: new Map(),
    pictureParameterSetBytesById: new Map()
  };
  const sequenceEntries = getParameterSetEntries(codecConfig, "sps", "sequenceParameterSets");
  const pictureEntries = getParameterSetEntries(codecConfig, "pps", "pictureParameterSets");
  for (const entry of sequenceEntries) installSequenceParameterSet(parameterSets, getEntryBytes(entry));
  for (const entry of pictureEntries) installPictureParameterSet(parameterSets, getEntryBytes(entry));
  return parameterSets;
}

function installSequenceParameterSet(parameterSets, nalUnit) {
  const bytes = normalizeBytes(nalUnit);
  const parsed = parseSpsNalUnit(bytes);
  const parameterSetId = parsed.sequenceParameterSetId;
  const previousBytes = parameterSets.sequenceParameterSetBytesById.get(parameterSetId);
  if (previousBytes && byteArraysEqual(previousBytes, bytes)) {
    return parameterSets.sequenceParameterSetsById.get(parameterSetId);
  }
  parameterSets.sequenceParameterSetsById.set(parameterSetId, parsed);
  parameterSets.sequenceParameterSetBytesById.set(parameterSetId, bytes.slice());
  return parsed;
}

function installPictureParameterSet(parameterSets, nalUnit) {
  const bytes = normalizeBytes(nalUnit);
  const parsed = parsePpsNalUnit(bytes, parameterSets.sequenceParameterSetsById);
  const parameterSetId = parsed.picParameterSetId;
  const previousBytes = parameterSets.pictureParameterSetBytesById.get(parameterSetId);
  if (previousBytes && byteArraysEqual(previousBytes, bytes)) {
    return parameterSets.pictureParameterSetsById.get(parameterSetId);
  }
  parameterSets.pictureParameterSetsById.set(parameterSetId, parsed);
  parameterSets.pictureParameterSetBytesById.set(parameterSetId, bytes.slice());
  return parsed;
}

function byteArraysEqual(leftBytes, rightBytes) {
  if (leftBytes.byteLength !== rightBytes.byteLength) return false;
  for (let index = 0; index < leftBytes.byteLength; index += 1) {
    if (leftBytes[index] !== rightBytes[index]) return false;
  }
  return true;
}

function getParameterSetEntries(codecConfig, primaryName, alternateName) {
  if (!codecConfig) return [];
  if (Array.isArray(codecConfig[primaryName])) return codecConfig[primaryName];
  if (Array.isArray(codecConfig[alternateName])) return codecConfig[alternateName];
  return [];
}

function getEntryBytes(entry) {
  if (entry && entry.bytes !== undefined) return normalizeBytes(entry.bytes);
  if (entry && entry.data !== undefined) return normalizeBytes(entry.data);
  return normalizeBytes(entry);
}

function normalizeBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (Array.isArray(value)) return Uint8Array.from(value);
  throw new AvcSyntaxError("invalid-byte-input", "AVC parser requires a byte array.");
}

function parseSliceHeader(nalUnit, parameterSets) {
  const bytes = normalizeBytes(nalUnit);
  if (!bytes.byteLength) throw new AvcSyntaxError("empty-nal-unit", "AVC slice NAL unit is empty.");
  const nalUnitType = bytes[0] & 0x1f;
  if (nalUnitType !== NAL_TYPE_NON_IDR_SLICE && nalUnitType !== NAL_TYPE_IDR_SLICE) {
    throw new AvcSyntaxError("not-slice", "AVC NAL unit does not contain a supported slice header.");
  }
  const nalRefIdc = (bytes[0] >> 5) & 0x03;
  const rbsp = removeEmulationPreventionBytes(bytes.subarray(1));
  const bitReader = new RbspBitReader(rbsp);
  const firstMbInSlice = bitReader.readUE();
  const rawSliceType = bitReader.readUE();
  if (rawSliceType > 9) {
    throw new AvcSyntaxError("invalid-slice-type", "Invalid AVC slice_type " + rawSliceType + ".");
  }
  const sliceType = rawSliceType % 5;
  const picParameterSetId = bitReader.readUE();
  const pictureParameterSet = parameterSets.pictureParameterSetsById.get(picParameterSetId);
  if (!pictureParameterSet) {
    throw new AvcSyntaxError("missing-pps", "AVC slice references missing PPS " + picParameterSetId + ".");
  }
  const sequenceParameterSet = parameterSets.sequenceParameterSetsById.get(
    pictureParameterSet.sequenceParameterSetId
  );
  if (!sequenceParameterSet) {
    throw new AvcSyntaxError(
      "missing-sps",
      "AVC PPS references missing SPS " + pictureParameterSet.sequenceParameterSetId + "."
    );
  }

  let colourPlaneId = 0;
  if (sequenceParameterSet.separateColourPlaneFlag) colourPlaneId = bitReader.readBits(2);
  const frameNum = bitReader.readBits(sequenceParameterSet.log2MaxFrameNumMinus4 + 4);
  let fieldPicFlag = false;
  let bottomFieldFlag = false;
  if (!sequenceParameterSet.frameMbsOnlyFlag) {
    fieldPicFlag = Boolean(bitReader.readBit());
    if (fieldPicFlag) bottomFieldFlag = Boolean(bitReader.readBit());
  }
  let idrPicId = 0;
  if (nalUnitType === NAL_TYPE_IDR_SLICE) idrPicId = bitReader.readUE();

  let picOrderCntLsb = 0;
  if (sequenceParameterSet.picOrderCntType === 0) {
    picOrderCntLsb = bitReader.readBits(sequenceParameterSet.log2MaxPicOrderCntLsbMinus4 + 4);
    if (pictureParameterSet.bottomFieldPicOrderInFramePresentFlag && !fieldPicFlag) bitReader.readSE();
  } else if (sequenceParameterSet.picOrderCntType === 1 && !sequenceParameterSet.deltaPicOrderAlwaysZeroFlag) {
    bitReader.readSE();
    if (pictureParameterSet.bottomFieldPicOrderInFramePresentFlag && !fieldPicFlag) bitReader.readSE();
  }

  let redundantPicCnt = 0;
  if (pictureParameterSet.redundantPicCntPresentFlag) redundantPicCnt = bitReader.readUE();
  if (sliceType === SLICE_TYPE_B) bitReader.readBit();

  let numRefIdxL0ActiveMinus1 = pictureParameterSet.numRefIdxL0DefaultActiveMinus1;
  let numRefIdxL1ActiveMinus1 = pictureParameterSet.numRefIdxL1DefaultActiveMinus1;
  if (sliceType === SLICE_TYPE_P || sliceType === SLICE_TYPE_SP || sliceType === SLICE_TYPE_B) {
    if (bitReader.readBit()) {
      numRefIdxL0ActiveMinus1 = bitReader.readUE();
      if (sliceType === SLICE_TYPE_B) numRefIdxL1ActiveMinus1 = bitReader.readUE();
    }
  }

  if (sliceType !== SLICE_TYPE_I && sliceType !== SLICE_TYPE_SI) {
    parseRefPicListModification(bitReader);
  }
  if (sliceType === SLICE_TYPE_B) parseRefPicListModification(bitReader);

  if (
    (pictureParameterSet.weightedPredFlag && (sliceType === SLICE_TYPE_P || sliceType === SLICE_TYPE_SP)) ||
    (pictureParameterSet.weightedBipredIdc === 1 && sliceType === SLICE_TYPE_B)
  ) {
    parsePredWeightTable(
      bitReader,
      sequenceParameterSet,
      numRefIdxL0ActiveMinus1,
      sliceType === SLICE_TYPE_B ? numRefIdxL1ActiveMinus1 : -1
    );
  }

  if (nalRefIdc !== 0) parseDecodedReferencePictureMarking(bitReader, nalUnitType);
  let cabacInitIdc = 0;
  if (pictureParameterSet.entropyCodingModeFlag && sliceType !== SLICE_TYPE_I && sliceType !== SLICE_TYPE_SI) {
    cabacInitIdc = bitReader.readUE();
    if (cabacInitIdc > 2) {
      throw new AvcSyntaxError("invalid-cabac-init", "Invalid AVC cabac_init_idc " + cabacInitIdc + ".");
    }
  }
  const sliceQpDelta = bitReader.readSE();
  if (sliceType === SLICE_TYPE_SP || sliceType === SLICE_TYPE_SI) {
    if (sliceType === SLICE_TYPE_SP) bitReader.readBit();
    bitReader.readSE();
  }
  if (pictureParameterSet.deblockingFilterControlPresentFlag) {
    const disableDeblockingFilterIdc = bitReader.readUE();
    if (disableDeblockingFilterIdc !== 1) {
      bitReader.readSE();
      bitReader.readSE();
    }
  }
  if (
    pictureParameterSet.numSliceGroupsMinus1 > 0 &&
    pictureParameterSet.sliceGroupMapType >= 3 &&
    pictureParameterSet.sliceGroupMapType <= 5
  ) {
    const picSizeInMapUnits = (sequenceParameterSet.picWidthInMbsMinus1 + 1) *
      (sequenceParameterSet.picHeightInMapUnitsMinus1 + 1);
    const sliceGroupChangeRate = pictureParameterSet.sliceGroupChangeRateMinus1 + 1;
    const bits = Math.ceil(Math.log2(Math.floor(picSizeInMapUnits / sliceGroupChangeRate) + 1));
    bitReader.readBits(bits);
  }

  return {
    nalUnitType,
    nalRefIdc,
    rbsp,
    firstMbInSlice,
    rawSliceType,
    sliceType,
    picParameterSetId,
    sequenceParameterSet,
    pictureParameterSet,
    colourPlaneId,
    frameNum,
    fieldPicFlag,
    bottomFieldFlag,
    idrPicId,
    picOrderCntLsb,
    redundantPicCnt,
    cabacInitIdc,
    sliceQpDelta,
    headerBitOffset: bitReader.bitOffset
  };
}

function parseRefPicListModification(bitReader) {
  if (!bitReader.readBit()) return;
  for (let operationCount = 0; operationCount < 1024; operationCount += 1) {
    const modificationOfPicNumsIdc = bitReader.readUE();
    if (modificationOfPicNumsIdc === 3) return;
    if (modificationOfPicNumsIdc === 0 || modificationOfPicNumsIdc === 1 || modificationOfPicNumsIdc === 2) {
      bitReader.readUE();
    } else if (modificationOfPicNumsIdc === 4 || modificationOfPicNumsIdc === 5) {
      bitReader.readUE();
    } else {
      throw new AvcSyntaxError(
        "invalid-reference-list-modification",
        "Invalid AVC modification_of_pic_nums_idc " + modificationOfPicNumsIdc + "."
      );
    }
  }
  throw new AvcSyntaxError("reference-list-too-long", "AVC reference-list modification did not terminate.");
}

function parsePredWeightTable(
  bitReader,
  sequenceParameterSet,
  numRefIdxL0ActiveMinus1,
  numRefIdxL1ActiveMinus1
) {
  bitReader.readUE();
  if (sequenceParameterSet.chromaArrayType !== 0) bitReader.readUE();
  parseWeightList(bitReader, sequenceParameterSet, numRefIdxL0ActiveMinus1);
  if (numRefIdxL1ActiveMinus1 >= 0) parseWeightList(bitReader, sequenceParameterSet, numRefIdxL1ActiveMinus1);
}

function parseWeightList(bitReader, sequenceParameterSet, activeMinus1) {
  if (activeMinus1 > 31) {
    throw new AvcSyntaxError("too-many-reference-weights", "AVC reference weight count exceeds the supported bound.");
  }
  for (let referenceIndex = 0; referenceIndex <= activeMinus1; referenceIndex += 1) {
    if (bitReader.readBit()) {
      bitReader.readSE();
      bitReader.readSE();
    }
    if (sequenceParameterSet.chromaArrayType !== 0 && bitReader.readBit()) {
      for (let component = 0; component < 2; component += 1) {
        bitReader.readSE();
        bitReader.readSE();
      }
    }
  }
}

function parseDecodedReferencePictureMarking(bitReader, nalUnitType) {
  if (nalUnitType === NAL_TYPE_IDR_SLICE) {
    bitReader.readBit();
    bitReader.readBit();
    return;
  }
  if (!bitReader.readBit()) return;
  for (let operationCount = 0; operationCount < 1024; operationCount += 1) {
    const operation = bitReader.readUE();
    if (operation === 0) return;
    if (operation === 1 || operation === 3) bitReader.readUE();
    if (operation === 2) bitReader.readUE();
    if (operation === 3 || operation === 6) bitReader.readUE();
    if (operation === 4) bitReader.readUE();
    if (operation < 1 || operation > 6) {
      throw new AvcSyntaxError("invalid-memory-management-operation", "Invalid AVC MMCO value " + operation + ".");
    }
  }
  throw new AvcSyntaxError("memory-management-too-long", "AVC memory-management operations did not terminate.");
}

function splitLengthPrefixedNalUnits(sampleBytes, nalLengthSize) {
  if (!Number.isInteger(nalLengthSize) || nalLengthSize < 1 || nalLengthSize > 4) {
    throw new AvcSyntaxError("invalid-nal-length-size", "AVC NAL length size must be between 1 and 4 bytes.");
  }
  const bytes = normalizeBytes(sampleBytes);
  const nalUnits = [];
  let offset = 0;
  while (offset < bytes.byteLength) {
    if (offset + nalLengthSize > bytes.byteLength) {
      throw new AvcSyntaxError("truncated-nal-length", "AVC sample ends inside a NAL length field.");
    }
    const lengthFieldOffset = offset;
    let nalUnitLength = 0;
    for (let index = 0; index < nalLengthSize; index += 1) {
      nalUnitLength = nalUnitLength * 256 + bytes[offset + index];
    }
    offset += nalLengthSize;
    if (nalUnitLength <= 0 || offset + nalUnitLength > bytes.byteLength) {
      throw new AvcSyntaxError(
        "invalid-nal-length",
        "AVC NAL length " + nalUnitLength + " exceeds the remaining sample bytes."
      );
    }
    if (nalUnits.length >= MAX_AVC_NAL_UNITS) {
      throw new AvcSyntaxError("nal-unit-budget-exceeded", "AVC sample contains more than 65,536 NAL units.");
    }
    const data = bytes.subarray(offset, offset + nalUnitLength);
    nalUnits.push({
      index: nalUnits.length,
      lengthFieldOffset,
      offset,
      length: nalUnitLength,
      type: data[0] & 0x1f,
      data
    });
    offset += nalUnitLength;
  }
  return nalUnits;
}

function parseAvcFrameInternals(sampleBytes, codecConfig, track = null, options = {}) {
  const sampleBits = getByteLength(sampleBytes) * 8;
  let rootUnitFallbackContext = null;
  try {
    const parameterSets = parseAvcParameterSets(codecConfig);
    const nalLengthSize = Number(codecConfig && codecConfig.nalLengthSize);
    const nalUnits = splitLengthPrefixedNalUnits(sampleBytes, nalLengthSize);
    if (nalUnits.some((nalUnit) => nalUnit.type >= 2 && nalUnit.type <= 4)) {
      throw new AvcSyntaxError("data-partitioning-unsupported", "AVC data-partitioned slices are not supported.");
    }
    const slices = [];
    for (const nalUnit of nalUnits) {
      if (nalUnit.type === NAL_TYPE_SPS) {
        installSequenceParameterSet(parameterSets, nalUnit.data);
      } else if (nalUnit.type === NAL_TYPE_PPS) {
        installPictureParameterSet(parameterSets, nalUnit.data);
      } else if (nalUnit.type === NAL_TYPE_NON_IDR_SLICE || nalUnit.type === NAL_TYPE_IDR_SLICE) {
        if (!parameterSets.sequenceParameterSetsById.size || !parameterSets.pictureParameterSetsById.size) {
          throw new AvcSyntaxError(
            "missing-parameter-sets",
            "AVC slice syntax was encountered before its SPS/PPS became available."
          );
        }
        slices.push({ nalUnit, header: parseSliceHeader(nalUnit.data, parameterSets) });
      }
    }
    if (!slices.length) {
      throw new AvcSyntaxError("no-slice-nal", "AVC sample contains no VCL slice NAL unit.");
    }
    const sequenceParameterSet = slices[0].header.sequenceParameterSet;
    const macroblockColumns = sequenceParameterSet.picWidthInMbsMinus1 + 1;
    const macroblockRows = sequenceParameterSet.frameHeightInMbs;
    const macroblockCount = macroblockColumns * macroblockRows;
    if (!Number.isSafeInteger(macroblockCount) || macroblockCount <= 0 || macroblockCount > MAX_AVC_MACROBLOCKS) {
      throw new AvcSyntaxError(
        "macroblock-budget-exceeded",
        "AVC picture requires " + macroblockCount + " macroblocks; limit is " + MAX_AVC_MACROBLOCKS + "."
      );
    }
    validateRootUnitPicture(slices);
    rootUnitFallbackContext = {
      nalUnits,
      slices,
      sequenceParameterSet,
      macroblockColumns,
      macroblockRows,
      macroblockCount
    };
    validateSupportedPicture(slices);
    validateSliceOrdering(slices, macroblockCount);
    const maximumStructureRecords = getMaximumStructureRecords(options, macroblockCount);
    const state = createPictureState(
      sequenceParameterSet,
      macroblockColumns,
      macroblockRows,
      maximumStructureRecords
    );
    const sliceResults = [];
    for (let sliceIndex = 0; sliceIndex < slices.length; sliceIndex += 1) {
      const endMacroblockAddress = sliceIndex + 1 < slices.length
        ? slices[sliceIndex + 1].header.firstMbInSlice
        : macroblockCount;
      sliceResults.push(decodeIntraSlice(
        slices[sliceIndex],
        sliceIndex,
        endMacroblockAddress,
        state
      ));
    }
    if (state.macroblocks.some((macroblock) => !macroblock)) {
      throw new AvcSyntaxError("incomplete-picture", "AVC slices did not cover every picture macroblock.");
    }
    const attributedBits = state.macroblocks.reduce((total, macroblock) => total + macroblock.syntaxBits, 0);
    if (attributedBits > sampleBits) {
      throw new AvcSyntaxError("invalid-bit-accounting", "AVC attributed syntax exceeds the encoded sample size.");
    }
    const partitions = state.macroblocks.flatMap((macroblock) => macroblock.children);
    const structureRecordCount = state.macroblocks.length + partitions.length;
    const decodedStructureRecordCount = state.macroblocks.length + state.structureBudget.decodedPartitionCount;
    const structureTruncated = structureRecordCount < decodedStructureRecordCount;
    return {
      kind: "avc-frame-internals",
      complete: true,
      granularity: "partition-tree",
      codec: "AVC / H.264",
      frameType: "I",
      entropyCodingMode: slices[0].header.pictureParameterSet.entropyCodingModeFlag ? "CABAC" : "CAVLC",
      accountingKind: slices[0].header.pictureParameterSet.entropyCodingModeFlag
        ? "cabac-renormalization-cursor-delta"
        : "cavlc-syntax-bit-length",
      width: sequenceParameterSet.width,
      height: sequenceParameterSet.height,
      codedWidth: sequenceParameterSet.codedWidth,
      codedHeight: sequenceParameterSet.codedHeight,
      macroblockColumns,
      macroblockRows,
      macroblockCount,
      macroblocks: state.macroblocks,
      partitions,
      structureRecordCount,
      decodedStructureRecordCount,
      structureTruncated,
      omittedPartitionCount: state.structureBudget.omittedPartitionCount,
      leafBlockCount: state.structureBudget.decodedPartitionCount,
      partitionDepths: [
        { depth: 0, count: macroblockCount },
        { depth: 1, count: state.structureBudget.decodedPartitionCount }
      ],
      partitionModes: Array.from(state.partitionModeCounts.entries())
        .sort((leftEntry, rightEntry) => rightEntry[1] - leftEntry[1])
        .map(([mode, count]) => ({ mode, count })),
      sampleBits,
      attributedBits,
      overheadBits: sampleBits - attributedBits,
      nals: nalUnits.map((nalUnit) => summarizeNalUnit(nalUnit, sliceResults)),
      warnings: structureTruncated
        ? [
          "The decoded AVC tree contains " + decodedStructureRecordCount +
            " records; all " + macroblockCount + " macroblock roots were preserved and detail output was capped at " +
            maximumStructureRecords + " records."
        ]
        : []
    };
  } catch (error) {
    if (rootUnitFallbackContext && error instanceof AvcSyntaxError) {
      return createRootUnitFallback(rootUnitFallbackContext, sampleBits, error);
    }
    return {
      kind: "unavailable",
      complete: false,
      codec: "AVC / H.264",
      sampleBits,
      attributedBits: null,
      overheadBits: null,
      unattributedBits: sampleBits,
      reason: error && error.code ? error.code : "avc-syntax-parse-failed",
      error: error instanceof Error ? error.message : String(error),
      warnings: []
    };
  }
}

function validateRootUnitPicture(slices) {
  const firstHeader = slices[0].header;
  const sequenceParameterSet = firstHeader.sequenceParameterSet;
  const pictureParameterSet = firstHeader.pictureParameterSet;
  if (!sequenceParameterSet.frameMbsOnlyFlag || slices.some(({ header }) => header.fieldPicFlag)) {
    throw new AvcSyntaxError(
      "interlaced-picture-unsupported",
      "Exact 16x16 AVC root units are unavailable for interlaced or field pictures."
    );
  }
  for (const { header } of slices) {
    if (
      header.sequenceParameterSet.sequenceParameterSetId !== sequenceParameterSet.sequenceParameterSetId ||
      header.pictureParameterSet.picParameterSetId !== pictureParameterSet.picParameterSetId ||
      header.sequenceParameterSet !== sequenceParameterSet ||
      header.pictureParameterSet !== pictureParameterSet ||
      header.frameNum !== firstHeader.frameNum ||
      header.nalUnitType !== firstHeader.nalUnitType ||
      header.idrPicId !== firstHeader.idrPicId
    ) {
      throw new AvcSyntaxError("mixed-picture-parameters", "AVC sample slices do not describe one consistent picture.");
    }
  }
}

function createRootUnitFallback(context, sampleBits, error) {
  const {
    nalUnits,
    slices,
    sequenceParameterSet,
    macroblockColumns,
    macroblockRows,
    macroblockCount
  } = context;
  const macroblocks = buildRootUnitGeometry(sequenceParameterSet, macroblockColumns, macroblockRows);
  return {
    kind: "avc-frame-internals",
    complete: true,
    granularity: "root-units",
    codec: "AVC / H.264",
    frameType: summarizeSliceTypes(slices),
    entropyCodingMode: slices[0].header.pictureParameterSet.entropyCodingModeFlag ? "CABAC" : "CAVLC",
    accountingKind: "unavailable",
    width: sequenceParameterSet.width,
    height: sequenceParameterSet.height,
    codedWidth: sequenceParameterSet.codedWidth,
    codedHeight: sequenceParameterSet.codedHeight,
    macroblockColumns,
    macroblockRows,
    macroblockCount,
    macroblocks,
    partitions: [],
    structureRecordCount: macroblocks.length,
    decodedStructureRecordCount: macroblocks.length,
    structureTruncated: false,
    leafBlockCount: macroblocks.length,
    sampleBits,
    attributedBits: null,
    overheadBits: null,
    unattributedBits: sampleBits,
    nals: nalUnits.map((nalUnit) => summarizeNalUnit(nalUnit, null)),
    reason: error.code,
    error: error.message,
    warnings: [error.message]
  };
}

function buildRootUnitGeometry(sequenceParameterSet, macroblockColumns, macroblockRows) {
  const macroblocks = [];
  for (let macroblockRow = 0; macroblockRow < macroblockRows; macroblockRow += 1) {
    for (let macroblockColumn = 0; macroblockColumn < macroblockColumns; macroblockColumn += 1) {
      const macroblockIndex = macroblockRow * macroblockColumns + macroblockColumn;
      const codedLeft = macroblockColumn * AVC_MACROBLOCK_SIZE;
      const codedTop = macroblockRow * AVC_MACROBLOCK_SIZE;
      const geometry = getTranslatedCodedRectangle(
        sequenceParameterSet,
        codedLeft,
        codedTop,
        AVC_MACROBLOCK_SIZE,
        AVC_MACROBLOCK_SIZE
      );
      macroblocks.push({
        id: "mb:" + macroblockIndex,
        macroblockIndex,
        macroblockColumn,
        macroblockRow,
        codedLeft,
        codedTop,
        left: geometry.left,
        top: geometry.top,
        width: geometry.width,
        height: geometry.height,
        codedWidth: AVC_MACROBLOCK_SIZE,
        codedHeight: AVC_MACROBLOCK_SIZE,
        codedBlockWidth: AVC_MACROBLOCK_SIZE,
        codedBlockHeight: AVC_MACROBLOCK_SIZE,
        depth: 0,
        type: "macroblock-root",
        syntaxBits: null,
        ownBits: null,
        subtreeBits: null,
        children: []
      });
    }
  }
  return macroblocks;
}

function getTranslatedCodedRectangle(sequenceParameterSet, codedLeft, codedTop, codedWidth, codedHeight) {
  return {
    left: codedLeft - sequenceParameterSet.cropLeftPixels,
    top: codedTop - sequenceParameterSet.cropTopPixels,
    width: codedWidth,
    height: codedHeight
  };
}

function summarizeSliceTypes(slices) {
  const names = [];
  for (const { header } of slices) {
    const name = getSliceTypeName(header.sliceType);
    if (!names.includes(name)) names.push(name);
  }
  return names.join("/");
}

function getSliceTypeName(sliceType) {
  return ["P", "B", "I", "SP", "SI"][sliceType] || "unknown";
}

function validateSupportedPicture(slices) {
  const firstHeader = slices[0].header;
  const sequenceParameterSet = firstHeader.sequenceParameterSet;
  const pictureParameterSet = firstHeader.pictureParameterSet;
  if (slices.some(({ header }) => header.sliceType !== SLICE_TYPE_I)) {
    throw new AvcSyntaxError(
      "inter-slice-syntax-unsupported",
      "Exact AVC internals currently require an I slice; P/B/SP/SI macroblock syntax is unavailable."
    );
  }
  if (sequenceParameterSet.mbAdaptiveFrameFieldFlag) {
    throw new AvcSyntaxError("mbaff-unsupported", "AVC MBAFF pictures are not supported.");
  }
  if (sequenceParameterSet.separateColourPlaneFlag || sequenceParameterSet.chromaArrayType > 1) {
    throw new AvcSyntaxError(
      "chroma-format-unsupported",
      "Exact AVC internals currently support monochrome and 4:2:0 pictures only."
    );
  }
  if (pictureParameterSet.numSliceGroupsMinus1 > 0) {
    throw new AvcSyntaxError("slice-groups-unsupported", "AVC flexible macroblock ordering is not supported.");
  }
  if (slices.some(({ header }) => header.redundantPicCnt > 0)) {
    throw new AvcSyntaxError("redundant-slices-unsupported", "AVC redundant slices are not supported.");
  }
}

function validateSliceOrdering(slices, macroblockCount) {
  if (slices[0].header.firstMbInSlice !== 0) {
    throw new AvcSyntaxError("missing-first-macroblock", "AVC picture does not start at macroblock address zero.");
  }
  let previousAddress = -1;
  for (const { header } of slices) {
    if (header.firstMbInSlice <= previousAddress || header.firstMbInSlice >= macroblockCount) {
      throw new AvcSyntaxError("unsupported-slice-order", "AVC slices are duplicated or out of raster order.");
    }
    previousAddress = header.firstMbInSlice;
  }
}

function getMaximumStructureRecords(options, macroblockCount) {
  const requestedLimit = Number(options && options.maximumStructureRecords);
  if (!Number.isFinite(requestedLimit) || requestedLimit <= 0) return MAX_AVC_STRUCTURE_RECORDS;
  return Math.max(macroblockCount, Math.min(MAX_AVC_STRUCTURE_RECORDS, Math.floor(requestedLimit)));
}

function createPictureState(
  sequenceParameterSet,
  macroblockColumns,
  macroblockRows,
  maximumStructureRecords
) {
  return {
    sequenceParameterSet,
    macroblockColumns,
    macroblockRows,
    macroblocks: new Array(macroblockColumns * macroblockRows),
    syntaxState: new Array(macroblockColumns * macroblockRows),
    structureBudget: {
      maximumStructureRecords,
      retainedStructureRecordCount: macroblockColumns * macroblockRows,
      decodedPartitionCount: 0,
      omittedPartitionCount: 0
    },
    partitionModeCounts: new Map()
  };
}

function summarizeNalUnit(nalUnit, sliceResults) {
  const accountingAvailable = Array.isArray(sliceResults);
  const sliceResult = accountingAvailable
    ? sliceResults.find((result) => result.nalIndex === nalUnit.index)
    : null;
  return {
    index: nalUnit.index,
    type: nalUnit.type,
    name: nalTypeName(nalUnit.type),
    offset: nalUnit.offset,
    length: nalUnit.length,
    sampleBits: nalUnit.length * 8,
    attributedBits: accountingAvailable ? (sliceResult ? sliceResult.attributedBits : 0) : null,
    overheadBits: accountingAvailable
      ? nalUnit.length * 8 - (sliceResult ? sliceResult.attributedBits : 0)
      : null
  };
}

function nalTypeName(type) {
  const names = {
    1: "non-IDR slice",
    5: "IDR slice",
    6: "SEI",
    7: "SPS",
    8: "PPS",
    9: "AUD",
    12: "filler"
  };
  return names[type] || "NAL " + type;
}

function getByteLength(value) {
  if (value && Number.isFinite(value.byteLength)) return value.byteLength;
  if (Array.isArray(value)) return value.length;
  return 0;
}

// H.264 Table 9-44: rangeTabLPS for arithmetic decoding (clause 9.3.3.2.1.1).
const CABAC_RANGE_LPS = [
  [128, 176, 208, 240], [128, 167, 197, 227], [128, 158, 187, 216], [123, 150, 178, 205],
  [116, 142, 169, 195], [111, 135, 160, 185], [105, 128, 152, 175], [100, 122, 144, 166],
  [95, 116, 137, 158], [90, 110, 130, 150], [85, 104, 123, 142], [81, 99, 117, 135],
  [77, 94, 111, 128], [73, 89, 105, 122], [69, 85, 100, 116], [66, 80, 95, 110],
  [62, 76, 90, 104], [59, 72, 86, 99], [56, 69, 81, 94], [53, 65, 77, 89],
  [51, 62, 73, 85], [48, 59, 69, 80], [46, 56, 66, 76], [43, 53, 63, 72],
  [41, 50, 59, 69], [39, 48, 56, 65], [37, 45, 54, 62], [35, 43, 51, 59],
  [33, 41, 48, 56], [32, 39, 46, 53], [30, 37, 43, 50], [29, 35, 41, 48],
  [27, 33, 39, 45], [26, 31, 37, 43], [24, 30, 35, 41], [23, 28, 33, 39],
  [22, 27, 32, 37], [21, 26, 30, 35], [20, 24, 29, 33], [19, 23, 27, 31],
  [18, 22, 26, 30], [17, 21, 25, 28], [16, 20, 23, 27], [15, 19, 22, 25],
  [14, 18, 21, 24], [14, 17, 20, 23], [13, 16, 19, 22], [12, 15, 18, 21],
  [12, 14, 17, 20], [11, 14, 16, 19], [11, 13, 15, 18], [10, 12, 15, 17],
  [10, 12, 14, 16], [9, 11, 13, 15], [9, 11, 12, 14], [8, 10, 12, 14],
  [8, 9, 11, 13], [7, 9, 11, 12], [7, 9, 10, 12], [7, 8, 10, 11],
  [6, 8, 9, 11], [6, 7, 9, 10], [6, 7, 8, 9], [2, 2, 2, 2]
];

// H.264 Tables 9-45 and 9-46: pStateIdx transitions after LPS and MPS bins.
const CABAC_TRANSITION_LPS = [
  0, 0, 1, 2, 2, 4, 4, 5, 6, 7, 8, 9, 9, 11, 11, 12,
  13, 13, 15, 15, 16, 16, 18, 18, 19, 19, 21, 21, 22, 22, 23, 24,
  24, 25, 26, 26, 27, 27, 28, 29, 29, 30, 30, 30, 31, 32, 32, 33,
  33, 33, 34, 34, 35, 35, 35, 36, 36, 36, 37, 37, 37, 38, 38, 63
];

const CABAC_TRANSITION_MPS = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
  17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32,
  33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48,
  49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 62, 63
];

// H.264 Tables 9-12 through 9-33: signed (m,n) context-init pairs for I/SI slices.
// The table pairs are packed as hexadecimal int8 values for contexts 0..435 and 1012..1015.
const CABAC_I_CONTEXT_HEAD_HEX =
  "14f10236034a14f10236034ae47fe968fa35ff36073300000000000000000000000000000000000000000000000000000000000000000000" +
  "0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000" +
  "00000000000000000029003f003f003ff75304560061f9480d29033e000b01370045ef7ff3660052f94aeb6be57fe17fe87fee5fe57feb72" +
  "e27fef7bf473f07af573f43ffe44f154f368fd46f85df65ae27fff4afa61f95bec7ffc38fb52f94cea7df95df557fd4dfb47fc3ffc44f454" +
  "f93ef941083d0538fe420140003dfe4e013207340a23002c0b26012d002e052c1f11013307321c1310210e3ef36cf164f365f35bf45ef658" +
  "f054f656f953f357ed5e01460048fb4a123bf866f164005ffc4b0248f54bfd470f2ef345003e00411525f14809391036003e0c4818000f09" +
  "08190d120f090d130a250c12061d14210f1e042d013a003e073d0c260b2d0f270b2a0d2c102d0c290a311e22122a0a371133112e00591aed" +
  "16ef1aef1ee71cec21e925e521e928e426ef21f528f129fa260129111efa1b031a1625f023fc26f826fd250326052a00231027160e301b25" +
  "153c0c440261fd47fa2afb32fd36fe3e003a013ffe48ff4af75bfb43fb1bfd27fe2c002ef040f844f64efa4df656f45cf137f63cfa3efc41" +
  "f449f84cf950f758ef6ef561ec54f54ffa49fc4af356f360f561ed75f84efb21fc30fe35fd3ef347f64ff456f35af2610000fa5dfa54f84f" +
  "0042ff47003efe3cfe3bfb4bfd3efc3af742ff4f004703440a2cf93e0f240e28101b0c1d012c14241220052a01300a3e112e0940f468f561" +
  "f060f958f855f955f755f3580442fd4dfd4cfa4c0a3aff4cff53f963f25f025f004cfb4a0046f54b01440041f249033e043eff44f34b0b37" +
  "05400c460f06061307100c0e120d0d0b0d0f0f100c170d170f140e1a0e2c1128112f1811151519161f1b161d13230e320a39073ffe4dfc52" +
  "fd5e0945f46d24dd24de20e625e22ce022ee22f128f121f923fb21002602210d17230d3a1dfd1a00161e1ff923f122fd220324ff2205200b" +
  "2305220c270b1e1d221a1d2713421f151f1f1932ef78ec70ee72f555f15cf259e647f151f2500044f246e838e944e832f54a17f31af328f1" +
  "31f22c032d062c2221361352fd4bff170122012b0036fe37003d01400044f75c";
const CABAC_I_CONTEXT_TAIL_HEX = "fd46f85df65ae27f";

class CabacArithmeticReader {
  constructor(encodedBytes) {
    this.encodedBytes = encodedBytes;
    this.inputBitOffset = 0;
    this.codIRange = 510;
    this.codIOffset = this.readInputBits(9);
  }

  get consumedBitCount() {
    return this.inputBitOffset;
  }

  readInputBit() {
    if (this.inputBitOffset >= this.encodedBytes.byteLength * 8) {
      throw new AvcSyntaxError("unexpected-end-of-cabac", "Unexpected end of AVC CABAC data.");
    }
    const byte = this.encodedBytes[this.inputBitOffset >> 3];
    const bit = (byte >> (7 - (this.inputBitOffset & 7))) & 1;
    this.inputBitOffset += 1;
    return bit;
  }

  readInputBits(bitCount) {
    let value = 0;
    for (let bitIndex = 0; bitIndex < bitCount; bitIndex += 1) {
      value = value * 2 + this.readInputBit();
    }
    return value;
  }

  renormalizeInterval() {
    while (this.codIRange < 256) {
      this.codIRange *= 2;
      this.codIOffset = this.codIOffset * 2 + this.readInputBit();
    }
  }

  decodeContextBin(contextModels, contextIndex) {
    const packedModel = contextModels[contextIndex];
    let probabilityState = packedModel >> 1;
    let mostProbableSymbol = packedModel & 1;
    const rangeClass = (this.codIRange >> 6) & 3;
    const leastProbableRange = CABAC_RANGE_LPS[probabilityState][rangeClass];
    this.codIRange -= leastProbableRange;

    let decodedBin;
    if (this.codIOffset >= this.codIRange) {
      decodedBin = 1 - mostProbableSymbol;
      this.codIOffset -= this.codIRange;
      this.codIRange = leastProbableRange;
      if (probabilityState === 0) mostProbableSymbol = 1 - mostProbableSymbol;
      probabilityState = CABAC_TRANSITION_LPS[probabilityState];
    } else {
      decodedBin = mostProbableSymbol;
      probabilityState = CABAC_TRANSITION_MPS[probabilityState];
    }
    contextModels[contextIndex] = probabilityState * 2 + mostProbableSymbol;
    this.renormalizeInterval();
    return decodedBin;
  }

  decodeBypassBin() {
    this.codIOffset = this.codIOffset * 2 + this.readInputBit();
    if (this.codIOffset < this.codIRange) return 0;
    this.codIOffset -= this.codIRange;
    return 1;
  }

  decodeTerminateBin() {
    this.codIRange -= 2;
    if (this.codIOffset >= this.codIRange) return 1;
    this.renormalizeInterval();
    return 0;
  }
}

function createIntraCabacContextModels(sliceQpY) {
  const contextModels = new Uint8Array(1024);
  initializeCabacContextRange(contextModels, 0, CABAC_I_CONTEXT_HEAD_HEX, sliceQpY);
  initializeCabacContextRange(contextModels, 1012, CABAC_I_CONTEXT_TAIL_HEX, sliceQpY);
  return contextModels;
}

function initializeCabacContextRange(contextModels, firstContextIndex, packedMnHex, sliceQpY) {
  const clippedQp = clip3(0, 51, sliceQpY);
  for (let hexOffset = 0; hexOffset < packedMnHex.length; hexOffset += 4) {
    const contextIndex = firstContextIndex + hexOffset / 4;
    const m = signedInt8(Number.parseInt(packedMnHex.slice(hexOffset, hexOffset + 2), 16));
    const n = signedInt8(Number.parseInt(packedMnHex.slice(hexOffset + 2, hexOffset + 4), 16));
    const preContextState = clip3(1, 126, ((m * clippedQp) >> 4) + n);
    if (preContextState <= 63) {
      contextModels[contextIndex] = (63 - preContextState) * 2;
    } else {
      contextModels[contextIndex] = (preContextState - 64) * 2 + 1;
    }
  }
}

function signedInt8(value) {
  return value >= 128 ? value - 256 : value;
}

function clip3(minimum, maximum, value) {
  return Math.max(minimum, Math.min(maximum, value));
}

function decodeIntraSlice(slice, sliceIndex, endMacroblockAddress, pictureState) {
  const { header, nalUnit } = slice;
  const sliceQpY = 26 + header.pictureParameterSet.picInitQpMinus26 + header.sliceQpDelta;
  const qpBdOffsetY = 6 * pictureState.sequenceParameterSet.bitDepthLumaMinus8;
  if (sliceQpY < -qpBdOffsetY || sliceQpY > 51) {
    throw new AvcSyntaxError("invalid-slice-qp", "AVC SliceQPY is outside the normative bit-depth range.");
  }
  const syntaxState = createSliceSyntaxState(
    pictureState,
    sliceIndex,
    sliceQpY,
    header.pictureParameterSet
  );
  if (header.pictureParameterSet.entropyCodingModeFlag) {
    const bitReader = new RbspBitReader(header.rbsp, header.headerBitOffset);
    bitReader.alignToByte(1);
    const cabacBytes = header.rbsp.subarray(bitReader.bitOffset >> 3);
    const cabacDecoder = new CabacArithmeticReader(cabacBytes);
    syntaxState.cabacDecoder = cabacDecoder;
    syntaxState.cabacContexts = createIntraCabacContextModels(sliceQpY);
    let macroblockAddress = header.firstMbInSlice;
    for (;;) {
      if (macroblockAddress >= endMacroblockAddress) {
        throw new AvcSyntaxError("missing-end-of-slice", "AVC CABAC slice did not terminate before the next slice.");
      }
      decodeCabacIntraMacroblock(syntaxState, macroblockAddress);
      const endOfSlice = cabacDecoder.decodeTerminateBin();
      macroblockAddress += 1;
      if (endOfSlice) {
        if (macroblockAddress !== endMacroblockAddress) {
          throw new AvcSyntaxError(
            "early-end-of-slice",
            "AVC CABAC slice ended before its expected macroblock boundary."
          );
        }
        break;
      }
    }
  } else {
    const bitReader = new RbspBitReader(header.rbsp, header.headerBitOffset);
    syntaxState.bitReader = bitReader;
    for (
      let macroblockAddress = header.firstMbInSlice;
      macroblockAddress < endMacroblockAddress;
      macroblockAddress += 1
    ) {
      decodeCavlcIntraMacroblock(syntaxState, macroblockAddress);
    }
    if (bitReader.moreRbspData()) {
      throw new AvcSyntaxError("unconsumed-cavlc-syntax", "AVC CAVLC slice contains unconsumed macroblock syntax.");
    }
  }
  const attributedBits = pictureState.macroblocks
    .slice(header.firstMbInSlice, endMacroblockAddress)
    .reduce((total, macroblock) => total + macroblock.syntaxBits, 0);
  return { nalIndex: nalUnit.index, attributedBits };
}

function createSliceSyntaxState(pictureState, sliceIndex, sliceQpY, pictureParameterSet) {
  return {
    ...pictureState,
    sliceIndex,
    currentQpY: sliceQpY,
    previousMacroblockQpDeltaNonZero: false,
    pictureParameterSet,
    chromaArrayType: pictureState.sequenceParameterSet.chromaArrayType,
    bitDepthY: 8 + pictureState.sequenceParameterSet.bitDepthLumaMinus8,
    bitDepthC: 8 + pictureState.sequenceParameterSet.bitDepthChromaMinus8,
    bitReader: null,
    cabacDecoder: null,
    cabacContexts: null
  };
}

function createMacroblockSyntaxState(sliceState, macroblockAddress) {
  const syntax = {
    sliceIndex: sliceState.sliceIndex,
    mbType: -1,
    transformSize8x8: false,
    intraPredMode16x16: 0,
    intra4x4PredMode: new Int8Array(16),
    intra8x8PredMode: new Int8Array(4),
    intraChromaPredMode: 0,
    cbpLuma: 0,
    cbpChroma: 0,
    qpY: sliceState.currentQpY,
    qpDelta: 0,
    codedBlockFlag: Array.from({ length: 6 }, () => new Uint8Array(16)),
    nonZeroLuma: new Int8Array(16),
    nonZeroChroma: new Int8Array(8),
    partitionSyntaxBits: []
  };
  sliceState.syntaxState[macroblockAddress] = syntax;
  return syntax;
}

function decodeCabacIntraMacroblock(sliceState, macroblockAddress) {
  const decoder = sliceState.cabacDecoder;
  const macroblockStartBit = decoder.consumedBitCount;
  const macroblock = createMacroblockSyntaxState(sliceState, macroblockAddress);
  macroblock.mbType = decodeCabacIntraMacroblockType(sliceState, macroblockAddress);
  if (macroblock.mbType === 25) {
    throw new AvcSyntaxError("cabac-ipcm-unsupported", "AVC CABAC I_PCM restart syntax is not supported.");
  }

  if (macroblock.mbType === 0) {
    if (sliceState.pictureParameterSet.transform8x8ModeFlag) {
      macroblock.transformSize8x8 = decodeCabacTransformSize8x8Flag(sliceState, macroblockAddress);
    }
    const predictionBlockCount = macroblock.transformSize8x8 ? 4 : 16;
    for (let blockIndex = 0; blockIndex < predictionBlockCount; blockIndex += 1) {
      const startBit = decoder.consumedBitCount;
      const predictionMode = decodeCabacIntraPredictionMode(sliceState);
      macroblock.partitionSyntaxBits[blockIndex] = decoder.consumedBitCount - startBit;
      if (macroblock.transformSize8x8) {
        macroblock.intra8x8PredMode[blockIndex] = deriveIntra8x8PredictionMode(
          sliceState,
          macroblockAddress,
          blockIndex,
          predictionMode
        );
      } else {
        macroblock.intra4x4PredMode[blockIndex] = deriveIntra4x4PredictionMode(
          sliceState,
          macroblockAddress,
          blockIndex,
          predictionMode
        );
      }
    }
    if (sliceState.chromaArrayType !== 0) {
      macroblock.intraChromaPredMode = decodeCabacIntraChromaPredMode(sliceState, macroblockAddress);
    }
    [macroblock.cbpLuma, macroblock.cbpChroma] = decodeCabacCodedBlockPattern(
      sliceState,
      macroblockAddress
    );
  } else {
    macroblock.intraPredMode16x16 = (macroblock.mbType - 1) % 4;
    macroblock.cbpLuma = Math.floor((macroblock.mbType - 1) / 12) ? 15 : 0;
    macroblock.cbpChroma = Math.floor((macroblock.mbType - 1) / 4) % 3;
    if (sliceState.chromaArrayType !== 0) {
      macroblock.intraChromaPredMode = decodeCabacIntraChromaPredMode(sliceState, macroblockAddress);
    }
  }

  if (macroblock.cbpLuma > 0 || macroblock.cbpChroma > 0 || (macroblock.mbType >= 1 && macroblock.mbType <= 24)) {
    macroblock.qpDelta = decodeCabacMacroblockQpDelta(sliceState);
    updateMacroblockQp(sliceState, macroblock);
    sliceState.previousMacroblockQpDeltaNonZero = macroblock.qpDelta !== 0;
  } else {
    sliceState.previousMacroblockQpDeltaNonZero = false;
    macroblock.qpY = sliceState.currentQpY;
  }
  decodeCabacMacroblockResidual(sliceState, macroblockAddress);
  const syntaxBits = decoder.consumedBitCount - macroblockStartBit;
  storeMacroblockResult(sliceState, macroblockAddress, syntaxBits);
}

function decodeCabacIntraMacroblockType(sliceState, macroblockAddress) {
  let contextIncrement = 0;
  const left = getMacroblockNeighbor(sliceState, macroblockAddress, -1, 0);
  const top = getMacroblockNeighbor(sliceState, macroblockAddress, 0, -1);
  if (left && left.mbType !== 0) contextIncrement += 1;
  if (top && top.mbType !== 0) contextIncrement += 1;
  const decoder = sliceState.cabacDecoder;
  const contexts = sliceState.cabacContexts;
  if (decoder.decodeContextBin(contexts, 3 + contextIncrement) === 0) return 0;
  if (decoder.decodeTerminateBin() === 1) return 25;
  const codedBlockPatternLuma = decoder.decodeContextBin(contexts, 6);
  const firstChromaBin = decoder.decodeContextBin(contexts, 7);
  let codedBlockPatternChroma = 0;
  if (firstChromaBin === 1) {
    codedBlockPatternChroma = decoder.decodeContextBin(contexts, 8) === 1 ? 2 : 1;
  }
  const predictionMode = decoder.decodeContextBin(contexts, 9) * 2 + decoder.decodeContextBin(contexts, 10);
  return 1 + predictionMode + 4 * codedBlockPatternChroma + (codedBlockPatternLuma ? 12 : 0);
}

function decodeCabacTransformSize8x8Flag(sliceState, macroblockAddress) {
  let contextIncrement = 0;
  const left = getMacroblockNeighbor(sliceState, macroblockAddress, -1, 0);
  const top = getMacroblockNeighbor(sliceState, macroblockAddress, 0, -1);
  if (left && left.transformSize8x8) contextIncrement += 1;
  if (top && top.transformSize8x8) contextIncrement += 1;
  return sliceState.cabacDecoder.decodeContextBin(sliceState.cabacContexts, 399 + contextIncrement) === 1;
}

function decodeCabacIntraPredictionMode(sliceState) {
  const decoder = sliceState.cabacDecoder;
  const contexts = sliceState.cabacContexts;
  if (decoder.decodeContextBin(contexts, 68) === 1) return { previous: true, remainder: -1 };
  let remainder = decoder.decodeContextBin(contexts, 69);
  remainder |= decoder.decodeContextBin(contexts, 69) << 1;
  remainder |= decoder.decodeContextBin(contexts, 69) << 2;
  return { previous: false, remainder };
}

function decodeCabacIntraChromaPredMode(sliceState, macroblockAddress) {
  let contextIncrement = 0;
  const left = getMacroblockNeighbor(sliceState, macroblockAddress, -1, 0);
  const top = getMacroblockNeighbor(sliceState, macroblockAddress, 0, -1);
  if (left && left.intraChromaPredMode !== 0) contextIncrement += 1;
  if (top && top.intraChromaPredMode !== 0) contextIncrement += 1;
  const decoder = sliceState.cabacDecoder;
  const contexts = sliceState.cabacContexts;
  if (decoder.decodeContextBin(contexts, 64 + contextIncrement) === 0) return 0;
  if (decoder.decodeContextBin(contexts, 67) === 0) return 1;
  if (decoder.decodeContextBin(contexts, 67) === 0) return 2;
  return 3;
}

function decodeCabacCodedBlockPattern(sliceState, macroblockAddress) {
  let codedBlockPatternLuma = 0;
  const decoder = sliceState.cabacDecoder;
  const contexts = sliceState.cabacContexts;
  for (let blockIndex = 0; blockIndex < 4; blockIndex += 1) {
    const contextIncrement = deriveCabacCodedBlockPatternLumaContext(
      sliceState,
      macroblockAddress,
      blockIndex,
      codedBlockPatternLuma
    );
    if (decoder.decodeContextBin(contexts, 73 + contextIncrement) === 1) {
      codedBlockPatternLuma |= 1 << blockIndex;
    }
  }
  let codedBlockPatternChroma = 0;
  if (sliceState.chromaArrayType === 1) {
    const firstContextIncrement = deriveCabacCodedBlockPatternChromaContext(
      sliceState,
      macroblockAddress,
      false
    );
    if (decoder.decodeContextBin(contexts, 77 + firstContextIncrement) === 1) {
      const secondContextIncrement = deriveCabacCodedBlockPatternChromaContext(
        sliceState,
        macroblockAddress,
        true
      );
      codedBlockPatternChroma = decoder.decodeContextBin(contexts, 81 + secondContextIncrement) === 1 ? 2 : 1;
    }
  }
  return [codedBlockPatternLuma, codedBlockPatternChroma];
}

function deriveCabacCodedBlockPatternLumaContext(
  sliceState,
  macroblockAddress,
  blockIndex,
  currentCodedBlockPattern
) {
  const leftMacroblock = getMacroblockNeighbor(sliceState, macroblockAddress, -1, 0);
  const topMacroblock = getMacroblockNeighbor(sliceState, macroblockAddress, 0, -1);
  const neighborTerm = (macroblock, mask) => (!macroblock || (macroblock.cbpLuma & mask) !== 0 ? 0 : 1);
  let leftTerm;
  let topTerm;
  if (blockIndex === 0) {
    leftTerm = neighborTerm(leftMacroblock, 2);
    topTerm = neighborTerm(topMacroblock, 4);
  } else if (blockIndex === 1) {
    leftTerm = currentCodedBlockPattern & 1 ? 0 : 1;
    topTerm = neighborTerm(topMacroblock, 8);
  } else if (blockIndex === 2) {
    leftTerm = neighborTerm(leftMacroblock, 8);
    topTerm = currentCodedBlockPattern & 1 ? 0 : 1;
  } else {
    leftTerm = currentCodedBlockPattern & 4 ? 0 : 1;
    topTerm = currentCodedBlockPattern & 2 ? 0 : 1;
  }
  return leftTerm + 2 * topTerm;
}

function deriveCabacCodedBlockPatternChromaContext(sliceState, macroblockAddress, secondBin) {
  const left = getMacroblockNeighbor(sliceState, macroblockAddress, -1, 0);
  const top = getMacroblockNeighbor(sliceState, macroblockAddress, 0, -1);
  const threshold = secondBin ? 1 : 0;
  return Number(Boolean(left && left.cbpChroma > threshold)) +
    2 * Number(Boolean(top && top.cbpChroma > threshold));
}

function decodeCabacMacroblockQpDelta(sliceState) {
  const decoder = sliceState.cabacDecoder;
  const contexts = sliceState.cabacContexts;
  const firstContextIndex = sliceState.previousMacroblockQpDeltaNonZero ? 61 : 60;
  if (decoder.decodeContextBin(contexts, firstContextIndex) === 0) return 0;
  let unaryValue = 1;
  while (decoder.decodeContextBin(contexts, unaryValue > 1 ? 63 : 62) === 1) {
    unaryValue += 1;
    if (unaryValue > 1024) {
      throw new AvcSyntaxError("qp-delta-too-large", "AVC mb_qp_delta unary code is too large.");
    }
  }
  return unaryValue & 1 ? (unaryValue + 1) / 2 : -(unaryValue / 2);
}

function updateMacroblockQp(sliceState, macroblock) {
  const qpBdOffsetY = 6 * (sliceState.bitDepthY - 8);
  const minimumQpDelta = -(26 + qpBdOffsetY / 2);
  const maximumQpDelta = 25 + qpBdOffsetY / 2;
  if (macroblock.qpDelta < minimumQpDelta || macroblock.qpDelta > maximumQpDelta) {
    throw new AvcSyntaxError("invalid-macroblock-qp-delta", "AVC mb_qp_delta is outside the normative range.");
  }
  const qpRange = 52 + qpBdOffsetY;
  // H.264 (08/2024) Equation 7-39: add 52 + 2 * QpBdOffsetY before the modulo operation.
  macroblock.qpY = ((sliceState.currentQpY + macroblock.qpDelta + qpRange + qpBdOffsetY) % qpRange) -
    qpBdOffsetY;
  sliceState.currentQpY = macroblock.qpY;
}

const CABAC_BLOCK_CATEGORY_INTRA_16X16_DC = 0;
const CABAC_BLOCK_CATEGORY_INTRA_16X16_AC = 1;
const CABAC_BLOCK_CATEGORY_LUMA_4X4 = 2;
const CABAC_BLOCK_CATEGORY_CHROMA_DC = 3;
const CABAC_BLOCK_CATEGORY_CHROMA_AC = 4;
const CABAC_BLOCK_CATEGORY_LUMA_8X8 = 5;
// H.264 Tables 9-39 through 9-43: residual context offsets and increments.
const CABAC_CODED_BLOCK_FLAG_OFFSETS = [85, 89, 93, 97, 101, 1012];
const CABAC_SIGNIFICANT_COEFFICIENT_FLAG_OFFSETS = [105, 120, 134, 149, 152, 402];
const CABAC_LAST_SIGNIFICANT_COEFFICIENT_FLAG_OFFSETS = [166, 181, 195, 210, 213, 417];
const CABAC_COEFFICIENT_ABS_LEVEL_MINUS1_OFFSETS = [227, 237, 247, 257, 266, 426];
const CABAC_COEFFICIENT_ABS_LEVEL_EQ1_CONTEXTS = [1, 2, 3, 4, 0, 0, 0, 0];
const CABAC_COEFFICIENT_ABS_LEVEL_GT1_CONTEXTS = [5, 5, 5, 5, 6, 7, 8, 9];
const CABAC_COEFFICIENT_ABS_LEVEL_TRANSITIONS = [
  [1, 2, 3, 3, 4, 5, 6, 7],
  [4, 4, 4, 4, 5, 6, 7, 7]
];
const CABAC_LAST_COEFFICIENT_CONTEXT_8X8 = [
  0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2,
  3, 3, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4,
  5, 5, 5, 5, 6, 6, 6, 6, 7, 7, 7, 7, 8, 8, 8
];
const CABAC_SIGNIFICANT_COEFFICIENT_CONTEXT_8X8 = [
  0, 1, 2, 3, 4, 5, 5, 4, 4, 3, 3, 4, 4, 4, 5, 5,
  4, 4, 4, 4, 3, 3, 6, 7, 7, 7, 8, 9, 10, 9, 8, 7,
  7, 6, 11, 12, 13, 11, 6, 7, 8, 9, 14, 10, 9, 8, 6, 11,
  12, 13, 11, 6, 9, 14, 10, 9, 11, 12, 13, 11, 14, 10, 12
];
const LUMA_LEFT_NEIGHBOR = [-1, 0, -1, 2, 1, 4, 3, 6, -1, 8, -1, 10, 9, 12, 11, 14];
const LUMA_TOP_NEIGHBOR = [-1, -1, 0, 1, -1, -1, 4, 5, 2, 3, 8, 9, 6, 7, 12, 13];
const LUMA_LEFT_FROM_MACROBLOCK_A = [5, -1, 7, -1, -1, -1, -1, -1, 13, -1, 15, -1, -1, -1, -1, -1];
const LUMA_TOP_FROM_MACROBLOCK_B = [10, 11, -1, -1, 14, 15, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1];

function decodeCabacMacroblockResidual(sliceState, macroblockAddress) {
  const macroblock = sliceState.syntaxState[macroblockAddress];
  if (macroblock.mbType >= 1 && macroblock.mbType <= 24) {
    addCabacResidualSyntaxBits(
      sliceState,
      macroblockAddress,
      CABAC_BLOCK_CATEGORY_INTRA_16X16_DC,
      0,
      16,
      0
    );
    if (macroblock.cbpLuma > 0) {
      for (let blockIndex = 0; blockIndex < 16; blockIndex += 1) {
        if (macroblock.cbpLuma & (1 << Math.floor(blockIndex / 4))) {
          addCabacResidualSyntaxBits(
            sliceState,
            macroblockAddress,
            CABAC_BLOCK_CATEGORY_INTRA_16X16_AC,
            blockIndex,
            15,
            0
          );
        }
      }
    }
  } else if (macroblock.transformSize8x8) {
    for (let blockIndex = 0; blockIndex < 4; blockIndex += 1) {
      if (macroblock.cbpLuma & (1 << blockIndex)) {
        addCabacResidualSyntaxBits(
          sliceState,
          macroblockAddress,
          CABAC_BLOCK_CATEGORY_LUMA_8X8,
          blockIndex,
          64,
          blockIndex
        );
        macroblock.codedBlockFlag[CABAC_BLOCK_CATEGORY_LUMA_8X8][blockIndex] = 1;
      }
    }
  } else {
    for (let blockIndex = 0; blockIndex < 16; blockIndex += 1) {
      if (macroblock.cbpLuma & (1 << Math.floor(blockIndex / 4))) {
        addCabacResidualSyntaxBits(
          sliceState,
          macroblockAddress,
          CABAC_BLOCK_CATEGORY_LUMA_4X4,
          blockIndex,
          16,
          blockIndex
        );
      }
    }
  }

  if (sliceState.chromaArrayType !== 0 && macroblock.cbpChroma > 0) {
    for (let componentIndex = 0; componentIndex < 2; componentIndex += 1) {
      consumeCabacResidualBlock(
        sliceState,
        macroblockAddress,
        CABAC_BLOCK_CATEGORY_CHROMA_DC,
        componentIndex,
        4
      );
    }
    if (macroblock.cbpChroma > 1) {
      for (let componentIndex = 0; componentIndex < 2; componentIndex += 1) {
        for (let blockIndex = 0; blockIndex < 4; blockIndex += 1) {
          consumeCabacResidualBlock(
            sliceState,
            macroblockAddress,
            CABAC_BLOCK_CATEGORY_CHROMA_AC,
            componentIndex * 4 + blockIndex,
            15
          );
        }
      }
    }
  }
}

function addCabacResidualSyntaxBits(
  sliceState,
  macroblockAddress,
  blockCategory,
  blockIndex,
  maximumCoefficientCount,
  partitionIndex
) {
  const startBit = sliceState.cabacDecoder.consumedBitCount;
  consumeCabacResidualBlock(sliceState, macroblockAddress, blockCategory, blockIndex, maximumCoefficientCount);
  const syntaxBits = sliceState.cabacDecoder.consumedBitCount - startBit;
  const macroblock = sliceState.syntaxState[macroblockAddress];
  macroblock.partitionSyntaxBits[partitionIndex] = (macroblock.partitionSyntaxBits[partitionIndex] || 0) + syntaxBits;
}

function consumeCabacResidualBlock(
  sliceState,
  macroblockAddress,
  blockCategory,
  blockIndex,
  maximumCoefficientCount
) {
  const decoder = sliceState.cabacDecoder;
  const contexts = sliceState.cabacContexts;
  const macroblock = sliceState.syntaxState[macroblockAddress];
  if (blockCategory !== CABAC_BLOCK_CATEGORY_LUMA_8X8) {
    const contextIncrement = deriveCabacCodedBlockFlagContext(
      sliceState,
      macroblockAddress,
      blockCategory,
      blockIndex
    );
    const contextIndex = CABAC_CODED_BLOCK_FLAG_OFFSETS[blockCategory] + contextIncrement;
    const codedBlockFlag = decoder.decodeContextBin(contexts, contextIndex);
    macroblock.codedBlockFlag[blockCategory][blockIndex] = codedBlockFlag;
    if (codedBlockFlag === 0) return;
  }

  const significantCoefficientPositions = [];
  let explicitlySignalledLast = false;
  for (let coefficientIndex = 0; coefficientIndex < maximumCoefficientCount - 1; coefficientIndex += 1) {
    const significantContextIncrement = blockCategory === CABAC_BLOCK_CATEGORY_LUMA_8X8
      ? CABAC_SIGNIFICANT_COEFFICIENT_CONTEXT_8X8[coefficientIndex]
      : coefficientIndex;
    const significantContextIndex = CABAC_SIGNIFICANT_COEFFICIENT_FLAG_OFFSETS[blockCategory] +
      significantContextIncrement;
    if (decoder.decodeContextBin(contexts, significantContextIndex) === 1) {
      significantCoefficientPositions.push(coefficientIndex);
      const lastContextIncrement = blockCategory === CABAC_BLOCK_CATEGORY_LUMA_8X8
        ? CABAC_LAST_COEFFICIENT_CONTEXT_8X8[coefficientIndex]
        : coefficientIndex;
      const lastContextIndex = CABAC_LAST_SIGNIFICANT_COEFFICIENT_FLAG_OFFSETS[blockCategory] +
        lastContextIncrement;
      if (decoder.decodeContextBin(contexts, lastContextIndex) === 1) {
        explicitlySignalledLast = true;
        break;
      }
    }
  }
  if (!explicitlySignalledLast) significantCoefficientPositions.push(maximumCoefficientCount - 1);
  consumeCabacCoefficientLevels(sliceState, blockCategory, significantCoefficientPositions.length);
}

function consumeCabacCoefficientLevels(sliceState, blockCategory, significantCoefficientCount) {
  const decoder = sliceState.cabacDecoder;
  const contexts = sliceState.cabacContexts;
  let nodeContext = 0;
  const coefficientContextBase = CABAC_COEFFICIENT_ABS_LEVEL_MINUS1_OFFSETS[blockCategory];
  for (let coefficientIndex = significantCoefficientCount - 1; coefficientIndex >= 0; coefficientIndex -= 1) {
    let contextIncrement = CABAC_COEFFICIENT_ABS_LEVEL_EQ1_CONTEXTS[nodeContext];
    const firstBin = decoder.decodeContextBin(contexts, coefficientContextBase + contextIncrement);
    if (firstBin === 0) {
      nodeContext = CABAC_COEFFICIENT_ABS_LEVEL_TRANSITIONS[0][nodeContext];
      decoder.decodeBypassBin();
      continue;
    }

    contextIncrement = CABAC_COEFFICIENT_ABS_LEVEL_GT1_CONTEXTS[nodeContext];
    nodeContext = CABAC_COEFFICIENT_ABS_LEVEL_TRANSITIONS[1][nodeContext];
    let absoluteCoefficientLevel = 2;
    while (absoluteCoefficientLevel < 15) {
      if (decoder.decodeContextBin(contexts, coefficientContextBase + contextIncrement) === 0) break;
      absoluteCoefficientLevel += 1;
    }
    if (absoluteCoefficientLevel >= 15) consumeCabacBypassExpGolombSuffix(decoder);
    decoder.decodeBypassBin();
  }
}

function consumeCabacBypassExpGolombSuffix(decoder) {
  let prefixLength = 0;
  while (decoder.decodeBypassBin() === 1) {
    prefixLength += 1;
    if (prefixLength > 31) {
      throw new AvcSyntaxError("cabac-exp-golomb-too-large", "AVC CABAC bypass Exp-Golomb value is too large.");
    }
  }
  for (let index = 0; index < prefixLength; index += 1) decoder.decodeBypassBin();
}

function deriveCabacCodedBlockFlagContext(sliceState, macroblockAddress, blockCategory, blockIndex) {
  let leftTerm = 1;
  let topTerm = 1;
  if (blockCategory === CABAC_BLOCK_CATEGORY_INTRA_16X16_DC) {
    const left = getMacroblockNeighbor(sliceState, macroblockAddress, -1, 0);
    const top = getMacroblockNeighbor(sliceState, macroblockAddress, 0, -1);
    if (left) leftTerm = left.codedBlockFlag[blockCategory][0];
    if (top) topTerm = top.codedBlockFlag[blockCategory][0];
  } else if (
    blockCategory === CABAC_BLOCK_CATEGORY_INTRA_16X16_AC ||
    blockCategory === CABAC_BLOCK_CATEGORY_LUMA_4X4
  ) {
    [leftTerm, topTerm] = deriveLumaBlockNeighborCodedFlag(
      sliceState,
      macroblockAddress,
      blockCategory,
      blockIndex
    );
  } else if (blockCategory === CABAC_BLOCK_CATEGORY_CHROMA_DC) {
    const left = getMacroblockNeighbor(sliceState, macroblockAddress, -1, 0);
    const top = getMacroblockNeighbor(sliceState, macroblockAddress, 0, -1);
    if (left) leftTerm = left.codedBlockFlag[blockCategory][blockIndex];
    if (top) topTerm = top.codedBlockFlag[blockCategory][blockIndex];
  } else if (blockCategory === CABAC_BLOCK_CATEGORY_CHROMA_AC) {
    [leftTerm, topTerm] = deriveChromaAcBlockNeighborCodedFlag(
      sliceState,
      macroblockAddress,
      blockIndex
    );
  }
  return leftTerm + 2 * topTerm;
}

function deriveLumaBlockNeighborCodedFlag(sliceState, macroblockAddress, blockCategory, blockIndex) {
  const macroblock = sliceState.syntaxState[macroblockAddress];
  let leftTerm = 1;
  let topTerm = 1;
  const leftBlockIndex = LUMA_LEFT_NEIGHBOR[blockIndex];
  if (leftBlockIndex >= 0) {
    leftTerm = macroblock.codedBlockFlag[blockCategory][leftBlockIndex];
  } else {
    const leftMacroblock = getMacroblockNeighbor(sliceState, macroblockAddress, -1, 0);
    if (leftMacroblock) {
      leftTerm = getLumaBlockCodedFlag(leftMacroblock, LUMA_LEFT_FROM_MACROBLOCK_A[blockIndex]);
    }
  }
  const topBlockIndex = LUMA_TOP_NEIGHBOR[blockIndex];
  if (topBlockIndex >= 0) {
    topTerm = macroblock.codedBlockFlag[blockCategory][topBlockIndex];
  } else {
    const topMacroblock = getMacroblockNeighbor(sliceState, macroblockAddress, 0, -1);
    if (topMacroblock) {
      topTerm = getLumaBlockCodedFlag(topMacroblock, LUMA_TOP_FROM_MACROBLOCK_B[blockIndex]);
    }
  }
  return [leftTerm, topTerm];
}

function getLumaBlockCodedFlag(macroblock, blockIndex) {
  if (macroblock.mbType === 25) return 1;
  if (macroblock.mbType >= 1 && macroblock.mbType <= 24) {
    return macroblock.codedBlockFlag[CABAC_BLOCK_CATEGORY_INTRA_16X16_AC][blockIndex];
  }
  if (macroblock.mbType === 0 && macroblock.transformSize8x8) {
    return macroblock.codedBlockFlag[CABAC_BLOCK_CATEGORY_LUMA_8X8][Math.floor(blockIndex / 4)];
  }
  if (macroblock.mbType === 0) {
    return macroblock.codedBlockFlag[CABAC_BLOCK_CATEGORY_LUMA_4X4][blockIndex];
  }
  return 0;
}

function deriveChromaAcBlockNeighborCodedFlag(sliceState, macroblockAddress, blockIndex) {
  const macroblock = sliceState.syntaxState[macroblockAddress];
  const componentBase = Math.floor(blockIndex / 4) * 4;
  const localBlockIndex = blockIndex % 4;
  const blockX = localBlockIndex % 2;
  const blockY = Math.floor(localBlockIndex / 2);
  let leftTerm = 1;
  let topTerm = 1;
  if (blockX > 0) {
    leftTerm = macroblock.codedBlockFlag[CABAC_BLOCK_CATEGORY_CHROMA_AC][componentBase + localBlockIndex - 1];
  } else {
    const left = getMacroblockNeighbor(sliceState, macroblockAddress, -1, 0);
    if (left) {
      leftTerm = left.codedBlockFlag[CABAC_BLOCK_CATEGORY_CHROMA_AC][componentBase + blockY * 2 + 1];
    }
  }
  if (blockY > 0) {
    topTerm = macroblock.codedBlockFlag[CABAC_BLOCK_CATEGORY_CHROMA_AC][componentBase + localBlockIndex - 2];
  } else {
    const top = getMacroblockNeighbor(sliceState, macroblockAddress, 0, -1);
    if (top) topTerm = top.codedBlockFlag[CABAC_BLOCK_CATEGORY_CHROMA_AC][componentBase + 2 + blockX];
  }
  return [leftTerm, topTerm];
}

// H.264 clause 9.2, Tables 9-5 through 9-10: normative CAVLC codeword lengths and values.
const CAVLC_COEFFICIENT_TOKEN_LENGTHS = [
  [
    1, 0, 0, 0, 6, 2, 0, 0, 8, 6, 3, 0, 9, 8, 7, 5, 10, 9, 8, 6,
    11, 10, 9, 7, 13, 11, 10, 8, 13, 13, 11, 9, 13, 13, 13, 10,
    14, 14, 13, 11, 14, 14, 14, 13, 15, 15, 14, 14, 15, 15, 15, 14,
    16, 15, 15, 15, 16, 16, 16, 15, 16, 16, 16, 16, 16, 16, 16, 16
  ],
  [
    2, 0, 0, 0, 6, 2, 0, 0, 6, 5, 3, 0, 7, 6, 6, 4, 8, 6, 6, 4,
    8, 7, 7, 5, 9, 8, 8, 6, 11, 9, 9, 6, 11, 11, 11, 7,
    12, 11, 11, 9, 12, 12, 12, 11, 12, 12, 12, 11, 13, 13, 13, 12,
    13, 13, 13, 13, 13, 14, 13, 13, 14, 14, 14, 13, 14, 14, 14, 14
  ],
  [
    4, 0, 0, 0, 6, 4, 0, 0, 6, 5, 4, 0, 6, 5, 5, 4, 7, 5, 5, 4,
    7, 5, 5, 4, 7, 6, 6, 4, 7, 6, 6, 4, 8, 7, 7, 5,
    8, 8, 7, 6, 9, 8, 8, 7, 9, 9, 8, 8, 9, 9, 9, 8,
    10, 9, 9, 9, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10
  ],
  [
    6, 0, 0, 0, 6, 6, 0, 0, 6, 6, 6, 0, 6, 6, 6, 6, 6, 6, 6, 6,
    6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6,
    6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6,
    6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6
  ]
];

const CAVLC_COEFFICIENT_TOKEN_BITS = [
  [
    1, 0, 0, 0, 5, 1, 0, 0, 7, 4, 1, 0, 7, 6, 5, 3, 7, 6, 5, 3,
    7, 6, 5, 4, 15, 6, 5, 4, 11, 14, 5, 4, 8, 10, 13, 4,
    15, 14, 9, 4, 11, 10, 13, 12, 15, 14, 9, 12, 11, 10, 13, 8,
    15, 1, 9, 12, 11, 14, 13, 8, 7, 10, 9, 12, 4, 6, 5, 8
  ],
  [
    3, 0, 0, 0, 11, 2, 0, 0, 7, 7, 3, 0, 7, 10, 9, 5, 7, 6, 5, 4,
    4, 6, 5, 6, 7, 6, 5, 8, 15, 6, 5, 4, 11, 14, 13, 4,
    15, 10, 9, 4, 11, 14, 13, 12, 8, 10, 9, 8, 15, 14, 13, 12,
    11, 10, 9, 12, 7, 11, 6, 8, 9, 8, 10, 1, 7, 6, 5, 4
  ],
  [
    15, 0, 0, 0, 15, 14, 0, 0, 11, 15, 13, 0, 8, 12, 14, 12, 15, 10, 11, 11,
    11, 8, 9, 10, 9, 14, 13, 9, 8, 10, 9, 8, 15, 14, 13, 13,
    11, 14, 10, 12, 15, 10, 13, 12, 11, 14, 9, 12, 8, 10, 13, 8,
    13, 7, 9, 12, 9, 12, 11, 10, 5, 8, 7, 6, 1, 4, 3, 2
  ],
  [
    3, 0, 0, 0, 0, 1, 0, 0, 4, 5, 6, 0, 8, 9, 10, 11, 12, 13, 14, 15,
    16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31,
    32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47,
    48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63
  ]
];

const CAVLC_CHROMA_DC_COEFFICIENT_TOKEN_LENGTHS = [
  2, 0, 0, 0, 6, 1, 0, 0, 6, 6, 3, 0, 6, 7, 7, 6, 6, 8, 8, 7
];
const CAVLC_CHROMA_DC_COEFFICIENT_TOKEN_BITS = [
  1, 0, 0, 0, 7, 1, 0, 0, 4, 6, 1, 0, 3, 3, 2, 5, 2, 3, 2, 0
];
const CAVLC_TOTAL_ZEROS_LENGTHS = [
  [1, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 9],
  [3, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 6, 6, 6, 6],
  [4, 3, 3, 3, 4, 4, 3, 3, 4, 5, 5, 6, 5, 6],
  [5, 3, 4, 4, 3, 3, 3, 4, 3, 4, 5, 5, 5],
  [4, 4, 4, 3, 3, 3, 3, 3, 4, 5, 4, 5],
  [6, 5, 3, 3, 3, 3, 3, 3, 4, 3, 6],
  [6, 5, 3, 3, 3, 2, 3, 4, 3, 6],
  [6, 4, 5, 3, 2, 2, 3, 3, 6],
  [6, 6, 4, 2, 2, 3, 2, 5],
  [5, 5, 3, 2, 2, 2, 4],
  [4, 4, 3, 3, 1, 3],
  [4, 4, 2, 1, 3],
  [3, 3, 1, 2],
  [2, 2, 1],
  [1, 1]
];
const CAVLC_TOTAL_ZEROS_BITS = [
  [1, 3, 2, 3, 2, 3, 2, 3, 2, 3, 2, 3, 2, 3, 2, 1],
  [7, 6, 5, 4, 3, 5, 4, 3, 2, 3, 2, 3, 2, 1, 0],
  [5, 7, 6, 5, 4, 3, 4, 3, 2, 3, 2, 1, 1, 0],
  [3, 7, 5, 4, 6, 5, 4, 3, 3, 2, 2, 1, 0],
  [5, 4, 3, 7, 6, 5, 4, 3, 2, 1, 1, 0],
  [1, 1, 7, 6, 5, 4, 3, 2, 1, 1, 0],
  [1, 1, 5, 4, 3, 3, 2, 1, 1, 0],
  [1, 1, 1, 3, 3, 2, 2, 1, 0],
  [1, 0, 1, 3, 2, 1, 1, 1],
  [1, 0, 1, 3, 2, 1, 1],
  [0, 1, 1, 2, 1, 3],
  [0, 1, 1, 1, 1],
  [0, 1, 1, 1],
  [0, 1, 1],
  [0, 1]
];
const CAVLC_CHROMA_DC_TOTAL_ZEROS_LENGTHS = [[1, 2, 3, 3], [1, 2, 2, 0], [1, 1, 0, 0]];
const CAVLC_CHROMA_DC_TOTAL_ZEROS_BITS = [[1, 1, 1, 0], [1, 1, 0, 0], [1, 0, 0, 0]];
const CAVLC_RUN_BEFORE_LENGTHS = [
  [1, 1],
  [1, 2, 2],
  [2, 2, 2, 2],
  [2, 2, 2, 3, 3],
  [2, 2, 3, 3, 3, 3],
  [2, 3, 3, 3, 3, 3, 3],
  [3, 3, 3, 3, 3, 3, 3, 4, 5, 6, 7, 8, 9, 10, 11]
];
const CAVLC_RUN_BEFORE_BITS = [
  [1, 0],
  [1, 1, 0],
  [3, 2, 1, 0],
  [3, 2, 1, 1, 0],
  [3, 2, 3, 2, 1, 0],
  [3, 0, 1, 3, 2, 5, 4],
  [7, 6, 5, 4, 3, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1]
];
// H.264 Table 9-4: coded_block_pattern mapping for intra macroblocks with ChromaArrayType 1 or 2.
const CAVLC_INTRA_CODED_BLOCK_PATTERN = [
  47, 31, 15, 0, 23, 27, 29, 30, 7, 11, 13, 14, 39, 43, 45, 46,
  16, 3, 5, 10, 12, 19, 21, 26, 28, 35, 37, 42, 44, 1, 2, 4,
  8, 17, 18, 20, 24, 6, 9, 22, 25, 32, 33, 34, 36, 40, 38, 41
];

function decodeCavlcIntraMacroblock(sliceState, macroblockAddress) {
  const bitReader = sliceState.bitReader;
  const macroblockStartBit = bitReader.bitOffset;
  const macroblock = createMacroblockSyntaxState(sliceState, macroblockAddress);
  macroblock.mbType = bitReader.readUE();
  if (macroblock.mbType > 25) {
    throw new AvcSyntaxError("invalid-intra-macroblock-type", "Invalid AVC I-slice mb_type " + macroblock.mbType + ".");
  }
  if (macroblock.mbType === 25) {
    decodeCavlcPcmMacroblock(sliceState, macroblock);
    storeMacroblockResult(sliceState, macroblockAddress, bitReader.bitOffset - macroblockStartBit);
    return;
  }

  if (macroblock.mbType === 0) {
    if (sliceState.pictureParameterSet.transform8x8ModeFlag) {
      macroblock.transformSize8x8 = Boolean(bitReader.readBit());
    }
    const predictionBlockCount = macroblock.transformSize8x8 ? 4 : 16;
    for (let blockIndex = 0; blockIndex < predictionBlockCount; blockIndex += 1) {
      const startBit = bitReader.bitOffset;
      const previous = Boolean(bitReader.readBit());
      const predictionMode = { previous, remainder: previous ? -1 : bitReader.readBits(3) };
      macroblock.partitionSyntaxBits[blockIndex] = bitReader.bitOffset - startBit;
      if (macroblock.transformSize8x8) {
        macroblock.intra8x8PredMode[blockIndex] = deriveIntra8x8PredictionMode(
          sliceState,
          macroblockAddress,
          blockIndex,
          predictionMode
        );
      } else {
        macroblock.intra4x4PredMode[blockIndex] = deriveIntra4x4PredictionMode(
          sliceState,
          macroblockAddress,
          blockIndex,
          predictionMode
        );
      }
    }
    if (sliceState.chromaArrayType !== 0) {
      macroblock.intraChromaPredMode = bitReader.readUE();
      if (macroblock.intraChromaPredMode > 3) {
        throw new AvcSyntaxError("invalid-chroma-prediction-mode", "Invalid AVC intra_chroma_pred_mode.");
      }
    }
    const codedBlockPatternIndex = bitReader.readUE();
    if (codedBlockPatternIndex > 47) {
      throw new AvcSyntaxError("invalid-coded-block-pattern", "Invalid AVC intra coded_block_pattern.");
    }
    const codedBlockPattern = CAVLC_INTRA_CODED_BLOCK_PATTERN[codedBlockPatternIndex];
    macroblock.cbpLuma = codedBlockPattern & 0x0f;
    macroblock.cbpChroma = (codedBlockPattern >> 4) & 0x03;
  } else {
    macroblock.intraPredMode16x16 = (macroblock.mbType - 1) % 4;
    macroblock.cbpLuma = Math.floor((macroblock.mbType - 1) / 12) ? 15 : 0;
    macroblock.cbpChroma = Math.floor((macroblock.mbType - 1) / 4) % 3;
    if (sliceState.chromaArrayType !== 0) {
      macroblock.intraChromaPredMode = bitReader.readUE();
      if (macroblock.intraChromaPredMode > 3) {
        throw new AvcSyntaxError("invalid-chroma-prediction-mode", "Invalid AVC intra_chroma_pred_mode.");
      }
    }
  }

  if (macroblock.cbpLuma > 0 || macroblock.cbpChroma > 0 || (macroblock.mbType >= 1 && macroblock.mbType <= 24)) {
    macroblock.qpDelta = bitReader.readSE();
    updateMacroblockQp(sliceState, macroblock);
  } else {
    macroblock.qpY = sliceState.currentQpY;
  }
  decodeCavlcMacroblockResidual(sliceState, macroblockAddress);
  storeMacroblockResult(sliceState, macroblockAddress, bitReader.bitOffset - macroblockStartBit);
}

function decodeCavlcPcmMacroblock(sliceState, macroblock) {
  const bitReader = sliceState.bitReader;
  const pcmStartBit = bitReader.bitOffset;
  bitReader.alignToByte(0);
  const chromaSampleCount = sliceState.chromaArrayType === 0 ? 0 : 128;
  const pcmBits = 256 * sliceState.bitDepthY + chromaSampleCount * sliceState.bitDepthC;
  bitReader.skipBits(pcmBits);
  macroblock.partitionSyntaxBits[0] = bitReader.bitOffset - pcmStartBit;
  macroblock.nonZeroLuma.fill(16);
  macroblock.nonZeroChroma.fill(16);
  macroblock.qpY = sliceState.currentQpY;
}

function decodeCavlcMacroblockResidual(sliceState, macroblockAddress) {
  const macroblock = sliceState.syntaxState[macroblockAddress];
  if (macroblock.mbType >= 1 && macroblock.mbType <= 24) {
    const lumaDcCoefficientCount = deriveCavlcNonZeroCount(sliceState, macroblockAddress, 0);
    addCavlcResidualSyntaxBits(
      sliceState,
      macroblockAddress,
      lumaDcCoefficientCount,
      16,
      0,
      null
    );
    if (macroblock.cbpLuma > 0) {
      for (let blockIndex = 0; blockIndex < 16; blockIndex += 1) {
        if (macroblock.cbpLuma & (1 << Math.floor(blockIndex / 4))) {
          addCavlcResidualSyntaxBits(
            sliceState,
            macroblockAddress,
            deriveCavlcNonZeroCount(sliceState, macroblockAddress, blockIndex),
            15,
            0,
            { kind: "luma", blockIndex }
          );
        }
      }
    }
  } else if (macroblock.transformSize8x8) {
    for (let block8x8Index = 0; block8x8Index < 4; block8x8Index += 1) {
      if (!(macroblock.cbpLuma & (1 << block8x8Index))) continue;
      for (let subBlockIndex = 0; subBlockIndex < 4; subBlockIndex += 1) {
        const blockIndex = block8x8Index * 4 + subBlockIndex;
        addCavlcResidualSyntaxBits(
          sliceState,
          macroblockAddress,
          deriveCavlcNonZeroCount(sliceState, macroblockAddress, blockIndex),
          16,
          block8x8Index,
          { kind: "luma", blockIndex }
        );
      }
    }
  } else {
    for (let blockIndex = 0; blockIndex < 16; blockIndex += 1) {
      if (macroblock.cbpLuma & (1 << Math.floor(blockIndex / 4))) {
        addCavlcResidualSyntaxBits(
          sliceState,
          macroblockAddress,
          deriveCavlcNonZeroCount(sliceState, macroblockAddress, blockIndex),
          16,
          blockIndex,
          { kind: "luma", blockIndex }
        );
      }
    }
  }

  if (sliceState.chromaArrayType !== 0 && macroblock.cbpChroma > 0) {
    for (let componentIndex = 0; componentIndex < 2; componentIndex += 1) {
      consumeCavlcResidualBlock(sliceState.bitReader, -1, 4);
    }
    if (macroblock.cbpChroma > 1) {
      for (let componentIndex = 0; componentIndex < 2; componentIndex += 1) {
        for (let blockIndex = 0; blockIndex < 4; blockIndex += 1) {
          const combinedBlockIndex = componentIndex * 4 + blockIndex;
          const result = consumeCavlcResidualBlock(
            sliceState.bitReader,
            deriveCavlcChromaNonZeroCount(sliceState, macroblockAddress, combinedBlockIndex),
            15
          );
          macroblock.nonZeroChroma[combinedBlockIndex] = result.totalCoefficientCount;
        }
      }
    }
  }
}

function addCavlcResidualSyntaxBits(
  sliceState,
  macroblockAddress,
  neighboringCoefficientCount,
  maximumCoefficientCount,
  partitionIndex,
  nonZeroTarget
) {
  const startBit = sliceState.bitReader.bitOffset;
  const result = consumeCavlcResidualBlock(
    sliceState.bitReader,
    neighboringCoefficientCount,
    maximumCoefficientCount
  );
  const macroblock = sliceState.syntaxState[macroblockAddress];
  macroblock.partitionSyntaxBits[partitionIndex] = (macroblock.partitionSyntaxBits[partitionIndex] || 0) +
    sliceState.bitReader.bitOffset - startBit;
  if (nonZeroTarget && nonZeroTarget.kind === "luma") {
    macroblock.nonZeroLuma[nonZeroTarget.blockIndex] = result.totalCoefficientCount;
  }
}

function consumeCavlcResidualBlock(bitReader, neighboringCoefficientCount, maximumCoefficientCount) {
  const { totalCoefficientCount, trailingOnes } = readCavlcCoefficientToken(
    bitReader,
    neighboringCoefficientCount
  );
  if (totalCoefficientCount === 0) return { totalCoefficientCount };
  consumeCavlcLevels(bitReader, totalCoefficientCount, trailingOnes);

  let zerosLeft = totalCoefficientCount < maximumCoefficientCount
    ? readCavlcTotalZeros(bitReader, totalCoefficientCount, maximumCoefficientCount)
    : 0;
  for (let coefficientIndex = 0; coefficientIndex < totalCoefficientCount - 1 && zerosLeft > 0; coefficientIndex += 1) {
    zerosLeft -= readCavlcRunBefore(bitReader, zerosLeft);
  }
  return { totalCoefficientCount };
}

function consumeCavlcLevels(bitReader, totalCoefficientCount, trailingOnes) {
  for (let trailingOneIndex = 0; trailingOneIndex < trailingOnes; trailingOneIndex += 1) {
    bitReader.readBit();
  }
  let suffixLength = totalCoefficientCount > 10 && trailingOnes < 3 ? 1 : 0;
  for (let levelIndex = trailingOnes; levelIndex < totalCoefficientCount; levelIndex += 1) {
    const levelPrefix = readUnaryZeroPrefix(bitReader, 25, "AVC CAVLC level_prefix is too long.");
    let levelSuffixSize = suffixLength;
    if (levelPrefix === 14 && suffixLength === 0) levelSuffixSize = 4;
    else if (levelPrefix >= 15) levelSuffixSize = levelPrefix - 3;
    const levelSuffix = levelSuffixSize > 0 ? bitReader.readBits(levelSuffixSize) : 0;
    let levelCode = Math.min(15, levelPrefix) * (2 ** suffixLength) + levelSuffix;
    if (levelPrefix >= 15 && suffixLength === 0) levelCode += 15;
    if (levelPrefix >= 16) levelCode += (2 ** (levelPrefix - 3)) - 4096;
    if (levelIndex === trailingOnes && trailingOnes < 3) levelCode += 2;
    const levelValue = levelCode & 1 ? -((levelCode + 1) / 2) : levelCode / 2 + 1;
    if (suffixLength === 0) suffixLength = 1;
    if (Math.abs(levelValue) > 3 * (2 ** (suffixLength - 1)) && suffixLength < 6) suffixLength += 1;
  }
}

function readCavlcCoefficientToken(bitReader, neighboringCoefficientCount) {
  if (neighboringCoefficientCount === -1) {
    return readCoefficientTokenCodeword(
      bitReader,
      CAVLC_CHROMA_DC_COEFFICIENT_TOKEN_LENGTHS,
      CAVLC_CHROMA_DC_COEFFICIENT_TOKEN_BITS,
      4,
      8,
      "chroma DC coeff_token"
    );
  }
  const tableIndex = neighboringCoefficientCount <= 1
    ? 0
    : neighboringCoefficientCount <= 3
      ? 1
      : neighboringCoefficientCount <= 7
        ? 2
        : 3;
  return readCoefficientTokenCodeword(
    bitReader,
    CAVLC_COEFFICIENT_TOKEN_LENGTHS[tableIndex],
    CAVLC_COEFFICIENT_TOKEN_BITS[tableIndex],
    16,
    [16, 14, 10, 6][tableIndex],
    "coeff_token"
  );
}

function readCoefficientTokenCodeword(
  bitReader,
  codeLengths,
  codeValues,
  maximumTotalCoefficients,
  maximumCodeLength,
  label
) {
  let codeValue = 0;
  for (let codeLength = 1; codeLength <= maximumCodeLength; codeLength += 1) {
    codeValue = codeValue * 2 + bitReader.readBit();
    for (let totalCoefficientCount = 0; totalCoefficientCount <= maximumTotalCoefficients; totalCoefficientCount += 1) {
      const maximumTrailingOnes = Math.min(totalCoefficientCount, 3);
      for (let trailingOnes = 0; trailingOnes <= maximumTrailingOnes; trailingOnes += 1) {
        const tableIndex = 4 * totalCoefficientCount + trailingOnes;
        if (codeLengths[tableIndex] === codeLength && codeValues[tableIndex] === codeValue) {
          return { totalCoefficientCount, trailingOnes };
        }
      }
    }
  }
  throw new AvcSyntaxError("invalid-cavlc-code", "No matching AVC " + label + " code.");
}

function readUnaryZeroPrefix(bitReader, maximumZeroCount, errorMessage) {
  let leadingZeroBits = 0;
  while (bitReader.readBit() === 0) {
    leadingZeroBits += 1;
    if (leadingZeroBits > maximumZeroCount) {
      throw new AvcSyntaxError("cavlc-level-prefix-too-long", errorMessage);
    }
  }
  return leadingZeroBits;
}

function readCavlcTotalZeros(bitReader, totalCoefficientCount, maximumCoefficientCount) {
  if (maximumCoefficientCount === 4) {
    return readScalarVlcCodeword(
      bitReader,
      CAVLC_CHROMA_DC_TOTAL_ZEROS_LENGTHS[totalCoefficientCount - 1],
      CAVLC_CHROMA_DC_TOTAL_ZEROS_BITS[totalCoefficientCount - 1],
      maximumCoefficientCount - totalCoefficientCount,
      "chroma DC total_zeros"
    );
  }
  return readScalarVlcCodeword(
    bitReader,
    CAVLC_TOTAL_ZEROS_LENGTHS[totalCoefficientCount - 1],
    CAVLC_TOTAL_ZEROS_BITS[totalCoefficientCount - 1],
    maximumCoefficientCount - totalCoefficientCount,
    "total_zeros"
  );
}

function readCavlcRunBefore(bitReader, zerosLeft) {
  const tableIndex = Math.min(zerosLeft - 1, 6);
  const maximumRun = tableIndex === 6 ? Math.min(zerosLeft, 14) : Math.min(zerosLeft, tableIndex + 1);
  return readScalarVlcCodeword(
    bitReader,
    CAVLC_RUN_BEFORE_LENGTHS[tableIndex],
    CAVLC_RUN_BEFORE_BITS[tableIndex],
    maximumRun,
    "run_before"
  );
}

function readScalarVlcCodeword(bitReader, codeLengths, codeValues, maximumValue, label) {
  let maximumCodeLength = 0;
  for (let value = 0; value <= maximumValue; value += 1) {
    maximumCodeLength = Math.max(maximumCodeLength, codeLengths[value] || 0);
  }
  let codeValue = 0;
  for (let codeLength = 1; codeLength <= maximumCodeLength; codeLength += 1) {
    codeValue = codeValue * 2 + bitReader.readBit();
    for (let value = 0; value <= maximumValue; value += 1) {
      if (codeLengths[value] === codeLength && codeValues[value] === codeValue) return value;
    }
  }
  throw new AvcSyntaxError("invalid-cavlc-code", "No matching AVC " + label + " code.");
}

function deriveCavlcNonZeroCount(sliceState, macroblockAddress, blockIndex) {
  const macroblock = sliceState.syntaxState[macroblockAddress];
  let leftCount = -1;
  let topCount = -1;
  const leftBlockIndex = LUMA_LEFT_NEIGHBOR[blockIndex];
  if (leftBlockIndex >= 0) {
    leftCount = macroblock.nonZeroLuma[leftBlockIndex];
  } else {
    const leftMacroblock = getMacroblockNeighbor(sliceState, macroblockAddress, -1, 0);
    if (leftMacroblock) leftCount = leftMacroblock.nonZeroLuma[LUMA_LEFT_FROM_MACROBLOCK_A[blockIndex]];
  }
  const topBlockIndex = LUMA_TOP_NEIGHBOR[blockIndex];
  if (topBlockIndex >= 0) {
    topCount = macroblock.nonZeroLuma[topBlockIndex];
  } else {
    const topMacroblock = getMacroblockNeighbor(sliceState, macroblockAddress, 0, -1);
    if (topMacroblock) topCount = topMacroblock.nonZeroLuma[LUMA_TOP_FROM_MACROBLOCK_B[blockIndex]];
  }
  if (leftCount >= 0 && topCount >= 0) return (leftCount + topCount + 1) >> 1;
  if (leftCount >= 0) return leftCount;
  if (topCount >= 0) return topCount;
  return 0;
}

function deriveCavlcChromaNonZeroCount(sliceState, macroblockAddress, blockIndex) {
  const macroblock = sliceState.syntaxState[macroblockAddress];
  const componentBase = Math.floor(blockIndex / 4) * 4;
  const localBlockIndex = blockIndex % 4;
  const blockX = localBlockIndex % 2;
  const blockY = Math.floor(localBlockIndex / 2);
  let leftCount = -1;
  let topCount = -1;
  if (blockX > 0) {
    leftCount = macroblock.nonZeroChroma[componentBase + localBlockIndex - 1];
  } else {
    const leftMacroblock = getMacroblockNeighbor(sliceState, macroblockAddress, -1, 0);
    if (leftMacroblock) leftCount = leftMacroblock.nonZeroChroma[componentBase + blockY * 2 + 1];
  }
  if (blockY > 0) {
    topCount = macroblock.nonZeroChroma[componentBase + localBlockIndex - 2];
  } else {
    const topMacroblock = getMacroblockNeighbor(sliceState, macroblockAddress, 0, -1);
    if (topMacroblock) topCount = topMacroblock.nonZeroChroma[componentBase + 2 + blockX];
  }
  if (leftCount >= 0 && topCount >= 0) return (leftCount + topCount + 1) >> 1;
  if (leftCount >= 0) return leftCount;
  if (topCount >= 0) return topCount;
  return 0;
}

const Z_SCAN_BLOCK_X = [0, 1, 0, 1, 2, 3, 2, 3, 0, 1, 0, 1, 2, 3, 2, 3];
const Z_SCAN_BLOCK_Y = [0, 0, 1, 1, 0, 0, 1, 1, 2, 2, 3, 3, 2, 2, 3, 3];
const RASTER_TO_Z_SCAN = [0, 1, 4, 5, 2, 3, 6, 7, 8, 9, 12, 13, 10, 11, 14, 15];

function deriveIntra4x4PredictionMode(sliceState, macroblockAddress, blockIndex, codedMode) {
  let leftPredictionMode = -1;
  let topPredictionMode = -1;
  const blockX = Z_SCAN_BLOCK_X[blockIndex];
  const blockY = Z_SCAN_BLOCK_Y[blockIndex];
  const macroblock = sliceState.syntaxState[macroblockAddress];
  if (blockX > 0) {
    leftPredictionMode = macroblock.intra4x4PredMode[RASTER_TO_Z_SCAN[blockY * 4 + blockX - 1]];
  } else {
    const left = getMacroblockNeighbor(sliceState, macroblockAddress, -1, 0);
    if (left) leftPredictionMode = getNeighborIntraPredictionMode(left, 3, blockY);
  }
  if (blockY > 0) {
    topPredictionMode = macroblock.intra4x4PredMode[RASTER_TO_Z_SCAN[(blockY - 1) * 4 + blockX]];
  } else {
    const top = getMacroblockNeighbor(sliceState, macroblockAddress, 0, -1);
    if (top) topPredictionMode = getNeighborIntraPredictionMode(top, blockX, 3);
  }
  const predictedMode = leftPredictionMode < 0 || topPredictionMode < 0
    ? 2
    : Math.min(leftPredictionMode, topPredictionMode);
  if (codedMode.previous) return predictedMode;
  return codedMode.remainder >= predictedMode ? codedMode.remainder + 1 : codedMode.remainder;
}

function deriveIntra8x8PredictionMode(sliceState, macroblockAddress, blockIndex, codedMode) {
  const blockX = blockIndex % 2;
  const blockY = Math.floor(blockIndex / 2);
  const macroblock = sliceState.syntaxState[macroblockAddress];
  let leftPredictionMode = -1;
  let topPredictionMode = -1;
  if (blockX > 0) {
    leftPredictionMode = macroblock.intra8x8PredMode[blockIndex - 1];
  } else {
    const left = getMacroblockNeighbor(sliceState, macroblockAddress, -1, 0);
    if (left) leftPredictionMode = getNeighborIntraPredictionMode(left, 3, blockY * 2);
  }
  if (blockY > 0) {
    topPredictionMode = macroblock.intra8x8PredMode[blockIndex - 2];
  } else {
    const top = getMacroblockNeighbor(sliceState, macroblockAddress, 0, -1);
    if (top) topPredictionMode = getNeighborIntraPredictionMode(top, blockX * 2, 3);
  }
  const predictedMode = leftPredictionMode < 0 || topPredictionMode < 0
    ? 2
    : Math.min(leftPredictionMode, topPredictionMode);
  if (codedMode.previous) return predictedMode;
  return codedMode.remainder >= predictedMode ? codedMode.remainder + 1 : codedMode.remainder;
}

function getNeighborIntraPredictionMode(macroblock, blockX, blockY) {
  if (macroblock.mbType === 0 && macroblock.transformSize8x8) {
    return macroblock.intra8x8PredMode[Math.floor(blockY / 2) * 2 + Math.floor(blockX / 2)];
  }
  if (macroblock.mbType === 0) {
    return macroblock.intra4x4PredMode[RASTER_TO_Z_SCAN[blockY * 4 + blockX]];
  }
  return 2;
}

function getMacroblockNeighbor(sliceState, macroblockAddress, deltaX, deltaY) {
  const macroblockX = macroblockAddress % sliceState.macroblockColumns;
  const macroblockY = Math.floor(macroblockAddress / sliceState.macroblockColumns);
  const neighborX = macroblockX + deltaX;
  const neighborY = macroblockY + deltaY;
  if (
    neighborX < 0 || neighborX >= sliceState.macroblockColumns ||
    neighborY < 0 || neighborY >= sliceState.macroblockRows
  ) return null;
  const neighbor = sliceState.syntaxState[neighborY * sliceState.macroblockColumns + neighborX];
  return neighbor && neighbor.sliceIndex === sliceState.sliceIndex ? neighbor : null;
}

function storeMacroblockResult(sliceState, macroblockAddress, syntaxBits) {
  const syntax = sliceState.syntaxState[macroblockAddress];
  const macroblockColumn = macroblockAddress % sliceState.macroblockColumns;
  const macroblockRow = Math.floor(macroblockAddress / sliceState.macroblockColumns);
  const codedLeft = macroblockColumn * AVC_MACROBLOCK_SIZE;
  const codedTop = macroblockRow * AVC_MACROBLOCK_SIZE;
  const rootGeometry = getTranslatedCodedRectangle(
    sliceState.sequenceParameterSet,
    codedLeft,
    codedTop,
    AVC_MACROBLOCK_SIZE,
    AVC_MACROBLOCK_SIZE
  );
  const type = getIntraMacroblockTypeName(syntax);
  const partitionCount = getIntraPartitionCount(type);
  sliceState.structureBudget.decodedPartitionCount += partitionCount;
  sliceState.partitionModeCounts.set(
    type,
    (sliceState.partitionModeCounts.get(type) || 0) + partitionCount + 1
  );
  const retainPartitionGeometry =
    sliceState.structureBudget.retainedStructureRecordCount + partitionCount <=
      sliceState.structureBudget.maximumStructureRecords;
  const children = retainPartitionGeometry
    ? buildIntraPartitionGeometry(
      sliceState.sequenceParameterSet,
      macroblockAddress,
      codedLeft,
      codedTop,
      syntax
    )
    : [];
  if (retainPartitionGeometry) {
    sliceState.structureBudget.retainedStructureRecordCount += children.length;
  } else {
    sliceState.structureBudget.omittedPartitionCount += partitionCount;
  }
  const childSyntaxBits = children.reduce((total, child) => total + child.syntaxBits, 0);
  sliceState.macroblocks[macroblockAddress] = {
    id: "mb:" + macroblockAddress,
    macroblockIndex: macroblockAddress,
    macroblockColumn,
    macroblockRow,
    codedLeft,
    codedTop,
    left: rootGeometry.left,
    top: rootGeometry.top,
    width: rootGeometry.width,
    height: rootGeometry.height,
    codedWidth: AVC_MACROBLOCK_SIZE,
    codedHeight: AVC_MACROBLOCK_SIZE,
    codedBlockWidth: AVC_MACROBLOCK_SIZE,
    codedBlockHeight: AVC_MACROBLOCK_SIZE,
    depth: 0,
    type,
    syntaxBits,
    ownBits: syntaxBits - childSyntaxBits,
    subtreeBits: syntaxBits,
    childSyntaxBits,
    unattributedSyntaxBits: syntaxBits - childSyntaxBits,
    omittedDescendantCount: retainPartitionGeometry ? 0 : partitionCount,
    qpY: syntax.qpY,
    codedBlockPatternLuma: syntax.cbpLuma,
    codedBlockPatternChroma: syntax.cbpChroma,
    children
  };
}

function getIntraMacroblockTypeName(syntax) {
  if (syntax.mbType === 25) return "I_PCM";
  if (syntax.mbType !== 0) return "I_16x16";
  return syntax.transformSize8x8 ? "I_8x8" : "I_4x4";
}

function getIntraPartitionCount(type) {
  if (type === "I_8x8") return 4;
  if (type === "I_4x4") return 16;
  return 1;
}

function buildIntraPartitionGeometry(
  sequenceParameterSet,
  macroblockAddress,
  macroblockCodedLeft,
  macroblockCodedTop,
  syntax
) {
  const type = getIntraMacroblockTypeName(syntax);
  if (type === "I_16x16" || type === "I_PCM") {
    const geometry = getTranslatedCodedRectangle(
      sequenceParameterSet,
      macroblockCodedLeft,
      macroblockCodedTop,
      AVC_MACROBLOCK_SIZE,
      AVC_MACROBLOCK_SIZE
    );
    return [{
      id: "mb:" + macroblockAddress + "/partition:0",
      codedLeft: macroblockCodedLeft,
      codedTop: macroblockCodedTop,
      left: geometry.left,
      top: geometry.top,
      width: geometry.width,
      height: geometry.height,
      codedWidth: AVC_MACROBLOCK_SIZE,
      codedHeight: AVC_MACROBLOCK_SIZE,
      codedBlockWidth: AVC_MACROBLOCK_SIZE,
      codedBlockHeight: AVC_MACROBLOCK_SIZE,
      depth: 1,
      type,
      syntaxBits: syntax.partitionSyntaxBits[0] || 0,
      children: []
    }];
  }
  const partitionSize = type === "I_8x8" ? 8 : 4;
  const partitionCount = type === "I_8x8" ? 4 : 16;
  const partitionsPerRow = AVC_MACROBLOCK_SIZE / partitionSize;
  const children = [];
  for (let blockIndex = 0; blockIndex < partitionCount; blockIndex += 1) {
    const partitionColumn = type === "I_8x8" ? blockIndex % 2 : Z_SCAN_BLOCK_X[blockIndex];
    const partitionRow = type === "I_8x8" ? Math.floor(blockIndex / 2) : Z_SCAN_BLOCK_Y[blockIndex];
    const relativeLeft = partitionColumn * partitionSize;
    const relativeTop = partitionRow * partitionSize;
    const geometry = getTranslatedCodedRectangle(
      sequenceParameterSet,
      macroblockCodedLeft + relativeLeft,
      macroblockCodedTop + relativeTop,
      partitionSize,
      partitionSize
    );
    children.push({
      id: "mb:" + macroblockAddress + "/partition:" + blockIndex,
      partitionIndex: blockIndex,
      partitionColumn,
      partitionRow,
      codedLeft: macroblockCodedLeft + relativeLeft,
      codedTop: macroblockCodedTop + relativeTop,
      left: geometry.left,
      top: geometry.top,
      width: geometry.width,
      height: geometry.height,
      codedWidth: partitionSize,
      codedHeight: partitionSize,
      codedBlockWidth: partitionSize,
      codedBlockHeight: partitionSize,
      depth: 1,
      type,
      syntaxBits: syntax.partitionSyntaxBits[blockIndex] || 0,
      predictionMode: type === "I_8x8"
        ? syntax.intra8x8PredMode[blockIndex]
        : syntax.intra4x4PredMode[blockIndex],
      children: []
    });
  }
  if (children.length !== partitionsPerRow * partitionsPerRow) {
    throw new AvcSyntaxError("invalid-partition-geometry", "AVC partition geometry is inconsistent.");
  }
  return children;
}

export {
  AvcSyntaxError,
  parseAvcFrameInternals,
  parseAvcParameterSets,
  parsePpsNalUnit,
  parseSliceHeader,
  parseSpsNalUnit,
  splitLengthPrefixedNalUnits
};
