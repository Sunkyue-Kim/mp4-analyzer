const MAX_PARAMETER_SET_BYTES = 1024 * 1024;
const MAX_NAL_UNIT_COUNT = 65536;
const MAX_EXPONENTIAL_GOLOMB_PREFIX_BITS = 31;
const MAX_ROOT_UNITS = 100_000;

class HevcInternalsUnavailableError extends Error {
  constructor(reason) {
    super(reason);
    this.name = "HevcInternalsUnavailableError";
  }
}

class HevcBitReader {
  constructor(bytes) {
    this.bytes = bytes;
    this.bitOffset = 0;
  }

  get bitsRemaining() {
    return this.bytes.byteLength * 8 - this.bitOffset;
  }

  readBit() {
    if (this.bitsRemaining <= 0) throw new HevcInternalsUnavailableError("Truncated HEVC syntax.");
    const byte = this.bytes[this.bitOffset >> 3];
    const value = (byte >> (7 - (this.bitOffset & 7))) & 1;
    this.bitOffset += 1;
    return value;
  }

  readBits(bitCount) {
    if (!Number.isInteger(bitCount) || bitCount < 0 || bitCount > 32 || this.bitsRemaining < bitCount) {
      throw new HevcInternalsUnavailableError("Invalid or truncated HEVC fixed-width field.");
    }
    let value = 0;
    for (let bitIndex = 0; bitIndex < bitCount; bitIndex += 1) {
      value = value * 2 + this.readBit();
    }
    return value;
  }

  skipBits(bitCount) {
    if (!Number.isInteger(bitCount) || bitCount < 0 || this.bitsRemaining < bitCount) {
      throw new HevcInternalsUnavailableError("Truncated HEVC syntax while skipping a field.");
    }
    this.bitOffset += bitCount;
  }

  readUnsignedExponentialGolomb() {
    let leadingZeroBitCount = 0;
    while (this.readBit() === 0) {
      leadingZeroBitCount += 1;
      if (leadingZeroBitCount > MAX_EXPONENTIAL_GOLOMB_PREFIX_BITS) {
        throw new HevcInternalsUnavailableError("HEVC Exp-Golomb value exceeds the parser safety limit.");
      }
    }
    const suffix = leadingZeroBitCount ? this.readBits(leadingZeroBitCount) : 0;
    return Math.pow(2, leadingZeroBitCount) - 1 + suffix;
  }
}

function parseHevcFrameInternals(sampleBytes, codecConfig, track = null) {
  const sampleBits = sampleBytes instanceof Uint8Array ? sampleBytes.byteLength * 8 : 0;
  try {
    if (!(sampleBytes instanceof Uint8Array)) {
      throw new HevcInternalsUnavailableError("HEVC frame internals require a Uint8Array sample.");
    }
    const sampleNalUnits = parseLengthPrefixedNalUnits(
      sampleBytes,
      codecConfig && codecConfig.nalLengthSize
    );
    const parameterSets = collectConfigurationParameterSets(codecConfig);
    const selectedParameterSet = selectSequenceParameterSetInNalOrder(sampleNalUnits, parameterSets);
    return buildRootUnitResult(
      selectedParameterSet.sequenceParameterSet,
      sampleBits,
      track
    );
  } catch (error) {
    const reason = error instanceof HevcInternalsUnavailableError
      ? error.message
      : "HEVC root-unit parsing failed safely.";
    return {
      kind: "unavailable",
      complete: false,
      reason,
      sampleBits,
      warnings: []
    };
  }
}

function parseLengthPrefixedNalUnits(sampleBytes, nalLengthSizeValue) {
  const nalLengthSize = Number(nalLengthSizeValue);
  if (!Number.isInteger(nalLengthSize) || nalLengthSize < 1 || nalLengthSize > 4) {
    throw new HevcInternalsUnavailableError("HEVC hvcC nalLengthSize is missing or invalid.");
  }
  const nalUnits = [];
  let offset = 0;
  while (offset < sampleBytes.byteLength) {
    if (nalUnits.length >= MAX_NAL_UNIT_COUNT) {
      throw new HevcInternalsUnavailableError("HEVC sample contains too many NAL units.");
    }
    if (offset + nalLengthSize > sampleBytes.byteLength) {
      throw new HevcInternalsUnavailableError("Truncated HEVC NAL length prefix.");
    }
    let nalUnitLength = 0;
    for (let byteIndex = 0; byteIndex < nalLengthSize; byteIndex += 1) {
      nalUnitLength = nalUnitLength * 256 + sampleBytes[offset + byteIndex];
    }
    offset += nalLengthSize;
    if (nalUnitLength < 2 || offset + nalUnitLength > sampleBytes.byteLength) {
      throw new HevcInternalsUnavailableError("Invalid HEVC length-prefixed NAL unit boundary.");
    }
    nalUnits.push(parseNalUnitHeader(sampleBytes.subarray(offset, offset + nalUnitLength)));
    offset += nalUnitLength;
  }
  return nalUnits;
}

function parseNalUnitHeader(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 2 || (bytes[0] & 0x80)) {
    throw new HevcInternalsUnavailableError("Invalid HEVC NAL unit header.");
  }
  const temporalIdPlusOne = bytes[1] & 0x07;
  if (!temporalIdPlusOne) throw new HevcInternalsUnavailableError("Invalid HEVC temporal_id_plus1 value.");
  return {
    bytes,
    type: (bytes[0] >> 1) & 0x3f,
    layerId: ((bytes[0] & 1) << 5) | (bytes[1] >> 3),
    temporalId: temporalIdPlusOne - 1
  };
}

function collectConfigurationParameterSets(codecConfig) {
  const sequenceParameterSets = new Map();
  const pictureParameterSets = new Map();
  const sequenceParameterSetBytes = new Map();
  const pictureParameterSetBytes = new Map();
  const parameterSets = {
    sequenceParameterSets,
    pictureParameterSets,
    sequenceParameterSetBytes,
    pictureParameterSetBytes
  };
  const configurationArrays = codecConfig && Array.isArray(codecConfig.arrays) ? codecConfig.arrays : [];
  for (const configurationArray of configurationArrays) {
    for (const storedNalUnit of configurationArray.nalUnits || []) {
      const bytes = normalizeStoredNalUnitBytes(storedNalUnit);
      if (bytes) addParameterSet(bytes, parameterSets);
    }
  }
  return parameterSets;
}

function normalizeStoredNalUnitBytes(storedNalUnit) {
  const candidate = storedNalUnit && (storedNalUnit.bytes || storedNalUnit.data || storedNalUnit.rawBytes);
  if (candidate instanceof Uint8Array) return candidate;
  if (Array.isArray(candidate)) return new Uint8Array(candidate);
  return null;
}

function addParameterSet(bytes, parameterSets) {
  if (bytes.byteLength > MAX_PARAMETER_SET_BYTES) {
    throw new HevcInternalsUnavailableError("HEVC parameter set exceeds the parser safety limit.");
  }
  const nalUnit = parseNalUnitHeader(bytes);
  if (nalUnit.layerId !== 0) return;
  if (nalUnit.type !== 33 && nalUnit.type !== 34) return;
  const rawByteSequencePayload = removeEmulationPreventionBytes(bytes.subarray(2));
  if (nalUnit.type === 33) {
    const sequenceParameterSet = parseSequenceParameterSet(rawByteSequencePayload);
    const changedExistingParameterSet = installParameterSet(
      parameterSets.sequenceParameterSets,
      parameterSets.sequenceParameterSetBytes,
      sequenceParameterSet.id,
      sequenceParameterSet,
      bytes
    );
    return { type: nalUnit.type, id: sequenceParameterSet.id, changedExistingParameterSet };
  } else if (nalUnit.type === 34) {
    const pictureParameterSet = parsePictureParameterSetReference(rawByteSequencePayload);
    const changedExistingParameterSet = installParameterSet(
      parameterSets.pictureParameterSets,
      parameterSets.pictureParameterSetBytes,
      pictureParameterSet.id,
      pictureParameterSet,
      bytes
    );
    return { type: nalUnit.type, id: pictureParameterSet.id, changedExistingParameterSet };
  }
  return null;
}

function installParameterSet(values, byteValues, id, value, bytes) {
  const previousBytes = byteValues.get(id);
  if (previousBytes && byteArraysEqual(previousBytes, bytes)) return false;
  const changedExistingParameterSet = values.has(id);
  values.set(id, value);
  byteValues.set(id, bytes.slice());
  return changedExistingParameterSet;
}

function byteArraysEqual(left, right) {
  if (!(left instanceof Uint8Array) || !(right instanceof Uint8Array) || left.byteLength !== right.byteLength) {
    return false;
  }
  for (let byteIndex = 0; byteIndex < left.byteLength; byteIndex += 1) {
    if (left[byteIndex] !== right[byteIndex]) return false;
  }
  return true;
}

function selectSequenceParameterSetInNalOrder(sampleNalUnits, parameterSets) {
  let selectedSequenceParameterSet = null;
  let hasVideoCodingLayerNalUnit = false;
  for (const nalUnit of sampleNalUnits) {
    if (nalUnit.layerId !== 0) continue;
    if (nalUnit.type === 33 || nalUnit.type === 34) {
      const installedParameterSet = addParameterSet(nalUnit.bytes, parameterSets);
      if (hasVideoCodingLayerNalUnit && installedParameterSet && installedParameterSet.changedExistingParameterSet) {
        throw new HevcInternalsUnavailableError(
          "HEVC parameter set " + installedParameterSet.id +
            " changes after coded slices begin; one exact root geometry cannot be asserted."
        );
      }
      continue;
    }
    if (nalUnit.type > 31) continue;
    hasVideoCodingLayerNalUnit = true;
    if (!parameterSets.sequenceParameterSets.size) {
      throw new HevcInternalsUnavailableError(
        "Raw SPS bytes are unavailable before the coded slice in decoding order."
      );
    }
    const pictureParameterSetId = parseSlicePictureParameterSetId(nalUnit);
    const pictureParameterSet = parameterSets.pictureParameterSets.get(pictureParameterSetId);
    if (!pictureParameterSet) {
      throw new HevcInternalsUnavailableError(
        "HEVC sample references unavailable PPS " + pictureParameterSetId +
          "; parameter sets appearing later in decoding order cannot be applied retroactively."
      );
    }
    const sequenceParameterSet = parameterSets.sequenceParameterSets.get(
      pictureParameterSet.sequenceParameterSetId
    );
    if (!sequenceParameterSet) {
      throw new HevcInternalsUnavailableError("HEVC PPS references a missing SPS.");
    }
    if (selectedSequenceParameterSet && selectedSequenceParameterSet !== sequenceParameterSet) {
      throw new HevcInternalsUnavailableError("HEVC sample slices reference multiple SPS geometries.");
    }
    selectedSequenceParameterSet = sequenceParameterSet;
  }
  if (!hasVideoCodingLayerNalUnit) {
    throw new HevcInternalsUnavailableError("The HEVC sample does not contain a base-layer coded slice.");
  }
  if (!selectedSequenceParameterSet) {
    throw new HevcInternalsUnavailableError("Unable to select an HEVC SPS from the sample PPS references.");
  }
  return { sequenceParameterSet: selectedSequenceParameterSet };
}

function parseSlicePictureParameterSetId(nalUnit) {
  const rawByteSequencePayload = removeEmulationPreventionBytes(nalUnit.bytes.subarray(2));
  const reader = new HevcBitReader(rawByteSequencePayload);
  reader.readBit();
  if (nalUnit.type >= 16 && nalUnit.type <= 23) reader.readBit();
  return reader.readUnsignedExponentialGolomb();
}

function parsePictureParameterSetReference(bytes) {
  const reader = new HevcBitReader(bytes);
  return {
    id: reader.readUnsignedExponentialGolomb(),
    sequenceParameterSetId: reader.readUnsignedExponentialGolomb()
  };
}

function parseSequenceParameterSet(bytes) {
  const reader = new HevcBitReader(bytes);
  const videoParameterSetId = reader.readBits(4);
  const maximumSubLayersMinusOne = reader.readBits(3);
  if (maximumSubLayersMinusOne > 6) {
    throw new HevcInternalsUnavailableError("Invalid HEVC maximum sub-layer count.");
  }
  reader.readBit();
  const profile = parseProfileTierLevel(reader, maximumSubLayersMinusOne);
  const id = reader.readUnsignedExponentialGolomb();
  const chromaFormat = reader.readUnsignedExponentialGolomb();
  if (chromaFormat > 3) throw new HevcInternalsUnavailableError("Invalid HEVC chroma format.");
  const separateColourPlane = chromaFormat === 3 ? Boolean(reader.readBit()) : false;
  const width = reader.readUnsignedExponentialGolomb();
  const height = reader.readUnsignedExponentialGolomb();
  if (!width || !height || width > 65536 || height > 65536) {
    throw new HevcInternalsUnavailableError("Invalid or unsupported HEVC coded dimensions.");
  }
  const conformanceWindow = { left: 0, right: 0, top: 0, bottom: 0 };
  if (reader.readBit()) {
    conformanceWindow.left = reader.readUnsignedExponentialGolomb();
    conformanceWindow.right = reader.readUnsignedExponentialGolomb();
    conformanceWindow.top = reader.readUnsignedExponentialGolomb();
    conformanceWindow.bottom = reader.readUnsignedExponentialGolomb();
  }
  const bitDepthLuma = reader.readUnsignedExponentialGolomb() + 8;
  const bitDepthChroma = reader.readUnsignedExponentialGolomb() + 8;
  const log2MaximumPictureOrderCountLeastSignificantBits =
    reader.readUnsignedExponentialGolomb() + 4;
  if (bitDepthLuma > 16 || bitDepthChroma > 16 ||
      log2MaximumPictureOrderCountLeastSignificantBits > 16) {
    throw new HevcInternalsUnavailableError("Unsupported HEVC bit depth or picture-order-count width.");
  }
  const subLayerOrderingInfoPresent = Boolean(reader.readBit());
  const firstOrderingLayer = subLayerOrderingInfoPresent ? 0 : maximumSubLayersMinusOne;
  for (let layerIndex = firstOrderingLayer; layerIndex <= maximumSubLayersMinusOne; layerIndex += 1) {
    reader.readUnsignedExponentialGolomb();
    reader.readUnsignedExponentialGolomb();
    reader.readUnsignedExponentialGolomb();
  }
  const log2MinimumCodingBlockSize = reader.readUnsignedExponentialGolomb() + 3;
  const log2CodingTreeBlockSize =
    log2MinimumCodingBlockSize + reader.readUnsignedExponentialGolomb();
  if (log2MinimumCodingBlockSize < 3 || log2MinimumCodingBlockSize > 6 ||
      log2CodingTreeBlockSize < log2MinimumCodingBlockSize || log2CodingTreeBlockSize > 6) {
    throw new HevcInternalsUnavailableError("Unsupported HEVC coding-tree block size.");
  }
  const codingTreeUnitSize = Math.pow(2, log2CodingTreeBlockSize);
  const codingTreeBlockWidth = Math.ceil(width / codingTreeUnitSize);
  const codingTreeBlockHeight = Math.ceil(height / codingTreeUnitSize);
  if (codingTreeBlockWidth * codingTreeBlockHeight > MAX_ROOT_UNITS) {
    throw new HevcInternalsUnavailableError("HEVC CTU grid exceeds the parser safety limit.");
  }
  const croppedDimensions = calculateCroppedDimensions(
    width,
    height,
    chromaFormat,
    separateColourPlane,
    conformanceWindow
  );
  return {
    id,
    videoParameterSetId,
    profileIdc: profile.profileIdc,
    levelIdc: profile.levelIdc,
    maximumSubLayersMinusOne,
    chromaFormat,
    separateColourPlane,
    width,
    height,
    displayWidth: croppedDimensions.width,
    displayHeight: croppedDimensions.height,
    conformanceWindow,
    bitDepthLuma,
    bitDepthChroma,
    log2MaximumPictureOrderCountLeastSignificantBits,
    log2MinimumCodingBlockSize,
    log2CodingTreeBlockSize,
    codingTreeBlockWidth,
    codingTreeBlockHeight
  };
}

function parseProfileTierLevel(reader, maximumSubLayersMinusOne) {
  reader.readBits(2);
  reader.readBit();
  const profileIdc = reader.readBits(5);
  reader.skipBits(32 + 4 + 44);
  const levelIdc = reader.readBits(8);
  const profilePresentFlags = [];
  const levelPresentFlags = [];
  for (let layerIndex = 0; layerIndex < maximumSubLayersMinusOne; layerIndex += 1) {
    profilePresentFlags.push(Boolean(reader.readBit()));
    levelPresentFlags.push(Boolean(reader.readBit()));
  }
  if (maximumSubLayersMinusOne > 0) reader.skipBits((8 - maximumSubLayersMinusOne) * 2);
  for (let layerIndex = 0; layerIndex < maximumSubLayersMinusOne; layerIndex += 1) {
    if (profilePresentFlags[layerIndex]) reader.skipBits(88);
    if (levelPresentFlags[layerIndex]) reader.skipBits(8);
  }
  return { profileIdc, levelIdc };
}

function calculateCroppedDimensions(width, height, chromaFormat, separateColourPlane, conformanceWindow) {
  let horizontalCropUnit = 1;
  let verticalCropUnit = 1;
  if (!separateColourPlane && chromaFormat === 1) {
    horizontalCropUnit = 2;
    verticalCropUnit = 2;
  } else if (!separateColourPlane && chromaFormat === 2) {
    horizontalCropUnit = 2;
  }
  const croppedWidth = width - horizontalCropUnit * (conformanceWindow.left + conformanceWindow.right);
  const croppedHeight = height - verticalCropUnit * (conformanceWindow.top + conformanceWindow.bottom);
  if (croppedWidth <= 0 || croppedHeight <= 0) {
    throw new HevcInternalsUnavailableError("Invalid HEVC conformance window.");
  }
  return { width: croppedWidth, height: croppedHeight };
}

function buildRootUnitResult(sequenceParameterSet, sampleBits, track) {
  if (sequenceParameterSet.conformanceWindow.left || sequenceParameterSet.conformanceWindow.top) {
    throw new HevcInternalsUnavailableError(
      "HEVC left/top conformance-window offsets are not mapped to display coordinates exactly."
    );
  }
  const codingTreeUnitSize = Math.pow(2, sequenceParameterSet.log2CodingTreeBlockSize);
  const roots = [];
  for (let rowIndex = 0; rowIndex < sequenceParameterSet.codingTreeBlockHeight; rowIndex += 1) {
    for (let columnIndex = 0; columnIndex < sequenceParameterSet.codingTreeBlockWidth; columnIndex += 1) {
      const left = columnIndex * codingTreeUnitSize;
      const top = rowIndex * codingTreeUnitSize;
      roots.push({
        id: `ctu:${rowIndex}:${columnIndex}`,
        left,
        top,
        width: codingTreeUnitSize,
        height: codingTreeUnitSize,
        depth: 0,
        type: "CTU",
        syntaxBits: null,
        children: [],
        metadata: {
          row: rowIndex,
          column: columnIndex,
          visibleWidth: Math.min(codingTreeUnitSize, sequenceParameterSet.width - left),
          visibleHeight: Math.min(codingTreeUnitSize, sequenceParameterSet.height - top)
        }
      });
    }
  }
  const warnings = [
    "HEVC CABAC child partitions are not decoded; only exact SPS-signalled CTU roots are shown, " +
    "with no inferred block bits."
  ];
  return {
    kind: "hevc-frame-internals",
    complete: true,
    exact: false,
    rootGeometryExact: true,
    treeComplete: false,
    granularity: "root-units",
    roots,
    blocks: roots,
    sampleBits,
    attributedBits: null,
    overheadBits: null,
    unattributedBits: sampleBits,
    unitName: "CTU",
    unitWidth: codingTreeUnitSize,
    unitHeight: codingTreeUnitSize,
    codedWidth: sequenceParameterSet.codingTreeBlockWidth * codingTreeUnitSize,
    codedHeight: sequenceParameterSet.codingTreeBlockHeight * codingTreeUnitSize,
    columns: sequenceParameterSet.codingTreeBlockWidth,
    rows: sequenceParameterSet.codingTreeBlockHeight,
    structureRecordCount: roots.length,
    warnings,
    metadata: {
      codec: "HEVC / H.265",
      sequenceParameterSetId: sequenceParameterSet.id,
      profileIdc: sequenceParameterSet.profileIdc,
      levelIdc: sequenceParameterSet.levelIdc,
      codedWidth: sequenceParameterSet.width,
      codedHeight: sequenceParameterSet.height,
      displayWidth: sequenceParameterSet.displayWidth,
      displayHeight: sequenceParameterSet.displayHeight,
      trackWidth: track && Number.isFinite(track.width) ? track.width : null,
      trackHeight: track && Number.isFinite(track.height) ? track.height : null,
      codingTreeUnitSize,
      minimumCodingUnitSize: Math.pow(2, sequenceParameterSet.log2MinimumCodingBlockSize),
      accounting: "unattributed"
    }
  };
}

function removeEmulationPreventionBytes(bytes) {
  const output = [];
  let consecutiveZeroByteCount = 0;
  for (let byteIndex = 0; byteIndex < bytes.byteLength; byteIndex += 1) {
    const byte = bytes[byteIndex];
    if (consecutiveZeroByteCount >= 2 && byte === 0x03) {
      const followingByte = bytes[byteIndex + 1];
      if (followingByte === undefined || followingByte > 0x03) {
        throw new HevcInternalsUnavailableError("Invalid HEVC emulation-prevention byte.");
      }
      consecutiveZeroByteCount = 0;
      continue;
    }
    output.push(byte);
    consecutiveZeroByteCount = byte === 0 ? consecutiveZeroByteCount + 1 : 0;
  }
  return new Uint8Array(output);
}

export { parseHevcFrameInternals };
