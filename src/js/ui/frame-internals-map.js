const DEFAULT_HEATMAP_BUCKET_COUNT = 32;
const MINIMUM_SPATIAL_BUCKET_COUNT = 8;
const MAXIMUM_SPATIAL_BUCKET_COUNT = 64;
export const FRAME_INTERNALS_PATH_CELL_LIMIT = 2048;
export const PACKED_FRAME_INTERNALS_SPATIAL_INDEX_KIND = "packed-frame-internals-spatial-index";

const PACKED_CELL_NUMERIC_FIELDS = Object.freeze({
  displayPixelLeft: 0,
  displayPixelTop: 1,
  displayPixelRight: 2,
  displayPixelBottom: 3,
  pixelLeft: 4,
  pixelTop: 5,
  pixelRight: 6,
  pixelBottom: 7,
  codedBlockWidth: 8,
  codedBlockHeight: 9,
  depth: 10,
  ownBits: 11,
  subtreeBits: 12,
  aggregatedDescendantCount: 13,
  rootIndex: 14,
  nominalUnits: 15,
  index: 16,
  displayBlockWidth: 17,
  displayBlockHeight: 18
});
const PACKED_CELL_NUMERIC_STRIDE = Object.keys(PACKED_CELL_NUMERIC_FIELDS).length;
const UTF8_TEXT_ENCODER = new TextEncoder();
const UTF8_TEXT_DECODER = new TextDecoder();

export function buildFrameInternalsPathGroups(cells, options = {}) {
  const heatmapBucketCount = normalizePositiveInteger(
    options.heatmapBucketCount,
    DEFAULT_HEATMAP_BUCKET_COUNT
  );
  const maximumCellsPerPath = normalizePositiveInteger(
    options.maximumCellsPerPath,
    FRAME_INTERNALS_PATH_CELL_LIMIT
  );
  const groupsByBucket = new Map();

  for (const cell of Array.isArray(cells) ? cells : []) {
    const bounds = getFrameInternalsDisplayBounds(cell);
    if (bounds.right <= bounds.left || bounds.bottom <= bounds.top) continue;
    const heatmapBucketIndex = getHeatmapBucketIndex(cell, heatmapBucketCount);
    let bucketGroups = groupsByBucket.get(heatmapBucketIndex);
    if (!bucketGroups) {
      bucketGroups = [];
      groupsByBucket.set(heatmapBucketIndex, bucketGroups);
    }
    let group = bucketGroups.at(-1);
    if (!group || group.cellCount >= maximumCellsPerPath) {
      group = {
        heatmapBucketIndex,
        pathSegments: [],
        redTotal: 0,
        greenTotal: 0,
        blueTotal: 0,
        alphaTotal: 0,
        cellCount: 0
      };
      bucketGroups.push(group);
    }
    const color = getCellColor(cell);
    group.pathSegments.push(renderRectanglePath(bounds));
    group.redTotal += color.red;
    group.greenTotal += color.green;
    group.blueTotal += color.blue;
    group.alphaTotal += getCellAlpha(cell);
    group.cellCount += 1;
  }

  return Array.from(groupsByBucket.entries())
    .sort((left, right) => left[0] - right[0])
    .flatMap(([, bucketGroups]) => bucketGroups)
    .map((group) => ({
      heatmapBucketIndex: group.heatmapBucketIndex,
      pathData: group.pathSegments.join(""),
      red: Math.round(group.redTotal / group.cellCount),
      green: Math.round(group.greenTotal / group.cellCount),
      blue: Math.round(group.blueTotal / group.cellCount),
      alpha: group.alphaTotal / group.cellCount,
      cellCount: group.cellCount
    }));
}

export function createPackedFrameInternalsSpatialIndex(model, options = {}) {
  const cells = Array.isArray(model && model.cells) ? model.cells : [];
  const mediaWidth = Math.max(1, Number(model && model.mediaWidth) || 1);
  const mediaHeight = Math.max(1, Number(model && model.mediaHeight) || 1);
  const spatialBucketLayout = selectPackedSpatialBucketLayout(
    cells,
    mediaWidth,
    mediaHeight,
    options.maximumBucketCount
  );
  const numericValues = new Float64Array(cells.length * PACKED_CELL_NUMERIC_STRIDE);
  const identifierValues = new Array(cells.length);
  const typeValues = [];
  const typeIndexesByValue = new Map();
  const typeIndexes = new Uint32Array(cells.length);
  const partitionModeValues = [];
  const partitionModeIndexesByValue = new Map();
  const partitionModeIndexes = new Uint32Array(cells.length);

  cells.forEach((cell, cellIndex) => {
    writePackedCellNumericValues(numericValues, cellIndex, cell);
    identifierValues[cellIndex] = String(
      cell && cell.id !== null && cell.id !== undefined ? cell.id : ""
    );
    typeIndexes[cellIndex] = internStringValue(
      String(cell && cell.type || "block"),
      typeValues,
      typeIndexesByValue
    );
    partitionModeIndexes[cellIndex] = internStringValue(
      String(cell && (cell.partitionMode || cell.type) || "block"),
      partitionModeValues,
      partitionModeIndexesByValue
    );
  });

  const bucketOffsets = new Uint32Array(spatialBucketLayout.bucketCounts.length + 1);
  for (let bucketIndex = 0; bucketIndex < spatialBucketLayout.bucketCounts.length; bucketIndex += 1) {
    bucketOffsets[bucketIndex + 1] = bucketOffsets[bucketIndex] + spatialBucketLayout.bucketCounts[bucketIndex];
  }
  const bucketWriteOffsets = bucketOffsets.slice(0, -1);
  const bucketCellIndexes = new Uint32Array(bucketOffsets.at(-1));
  cells.forEach((cell, cellIndex) => {
    visitSpatialBuckets(
      getFrameInternalsDisplayBounds(cell),
      mediaWidth,
      mediaHeight,
      spatialBucketLayout.columns,
      spatialBucketLayout.rows,
      (bucketIndex) => {
        bucketCellIndexes[bucketWriteOffsets[bucketIndex]] = cellIndex;
        bucketWriteOffsets[bucketIndex] += 1;
      }
    );
  });

  return {
    kind: PACKED_FRAME_INTERNALS_SPATIAL_INDEX_KIND,
    version: 1,
    cellCount: cells.length,
    mediaWidth,
    mediaHeight,
    bucketColumnCount: spatialBucketLayout.columns,
    bucketRowCount: spatialBucketLayout.rows,
    numericStride: PACKED_CELL_NUMERIC_STRIDE,
    numericValues,
    identifierData: packStringValues(identifierValues),
    typeValues,
    typeIndexes,
    partitionModeValues,
    partitionModeIndexes,
    bucketOffsets,
    bucketCellIndexes
  };
}

export function createFrameInternalsSpatialIndex(model, options = {}) {
  const cells = Array.isArray(model && model.cells) ? model.cells : [];
  const mediaWidth = Math.max(1, Number(model && model.mediaWidth) || 1);
  const mediaHeight = Math.max(1, Number(model && model.mediaHeight) || 1);
  const spatialBucketCounts = getSpatialBucketCounts(
    cells.length,
    mediaWidth,
    mediaHeight,
    options.maximumBucketCount
  );
  const buckets = Array.from(
    { length: spatialBucketCounts.columns * spatialBucketCounts.rows },
    () => []
  );

  cells.forEach((cell, cellIndex) => {
    const bounds = getFrameInternalsDisplayBounds(cell);
    const firstColumn = getSpatialBucketCoordinate(
      bounds.left,
      mediaWidth,
      spatialBucketCounts.columns
    );
    const lastColumn = getSpatialBucketCoordinate(
      Math.max(bounds.left, bounds.right - Number.EPSILON),
      mediaWidth,
      spatialBucketCounts.columns
    );
    const firstRow = getSpatialBucketCoordinate(
      bounds.top,
      mediaHeight,
      spatialBucketCounts.rows
    );
    const lastRow = getSpatialBucketCoordinate(
      Math.max(bounds.top, bounds.bottom - Number.EPSILON),
      mediaHeight,
      spatialBucketCounts.rows
    );
    for (let bucketRow = firstRow; bucketRow <= lastRow; bucketRow += 1) {
      for (let bucketColumn = firstColumn; bucketColumn <= lastColumn; bucketColumn += 1) {
        buckets[bucketRow * spatialBucketCounts.columns + bucketColumn].push(cellIndex);
      }
    }
  });

  return {
    cells,
    mediaWidth,
    mediaHeight,
    bucketColumnCount: spatialBucketCounts.columns,
    bucketRowCount: spatialBucketCounts.rows,
    buckets
  };
}

export function findFrameInternalsCell(spatialIndex, mapCoordinateX, mapCoordinateY) {
  if (isPackedFrameInternalsSpatialIndex(spatialIndex)) {
    return findPackedFrameInternalsCell(spatialIndex, mapCoordinateX, mapCoordinateY);
  }
  if (!spatialIndex || !Array.isArray(spatialIndex.cells)) return null;
  const coordinateX = Number(mapCoordinateX);
  const coordinateY = Number(mapCoordinateY);
  if (
    !Number.isFinite(coordinateX) ||
    !Number.isFinite(coordinateY) ||
    coordinateX < 0 ||
    coordinateY < 0 ||
    coordinateX > spatialIndex.mediaWidth ||
    coordinateY > spatialIndex.mediaHeight
  ) {
    return null;
  }
  const bucketColumn = getSpatialBucketCoordinate(
    coordinateX,
    spatialIndex.mediaWidth,
    spatialIndex.bucketColumnCount
  );
  const bucketRow = getSpatialBucketCoordinate(
    coordinateY,
    spatialIndex.mediaHeight,
    spatialIndex.bucketRowCount
  );
  const candidateIndexes = spatialIndex.buckets[
    bucketRow * spatialIndex.bucketColumnCount + bucketColumn
  ] || [];

  for (const candidateIndex of candidateIndexes) {
    const cell = spatialIndex.cells[candidateIndex];
    const bounds = getFrameInternalsDisplayBounds(cell);
    if (
      coordinateX >= bounds.left &&
      coordinateX <= bounds.right &&
      coordinateY >= bounds.top &&
      coordinateY <= bounds.bottom
    ) {
      return cell;
    }
  }
  return null;
}

export function getPackedFrameInternalsSpatialIndexTransferables(spatialIndex) {
  if (!isPackedFrameInternalsSpatialIndex(spatialIndex)) return [];
  return [
    spatialIndex.numericValues,
    spatialIndex.identifierData && spatialIndex.identifierData.encodedBytes,
    spatialIndex.identifierData && spatialIndex.identifierData.offsets,
    spatialIndex.typeIndexes,
    spatialIndex.partitionModeIndexes,
    spatialIndex.bucketOffsets,
    spatialIndex.bucketCellIndexes
  ].filter((value) => ArrayBuffer.isView(value)).map((value) => value.buffer);
}

export function getFrameInternalsDisplayBounds(cell) {
  return {
    left: getFiniteNumber(cell && cell.displayPixelLeft, cell && cell.pixelLeft),
    top: getFiniteNumber(cell && cell.displayPixelTop, cell && cell.pixelTop),
    right: getFiniteNumber(cell && cell.displayPixelRight, cell && cell.pixelRight),
    bottom: getFiniteNumber(cell && cell.displayPixelBottom, cell && cell.pixelBottom)
  };
}

function getHeatmapBucketIndex(cell, heatmapBucketCount) {
  const rawGlobalPercentile = cell && cell.globalPercentile;
  const globalPercentile = Number(rawGlobalPercentile);
  const normalizedPercentile = isPresentFiniteValue(rawGlobalPercentile, globalPercentile)
    ? clamp(globalPercentile, 0, 1)
    : clamp((getCellAlpha(cell) - 0.72) / 0.28, 0, 1);
  return Math.min(
    heatmapBucketCount - 1,
    Math.floor(normalizedPercentile * heatmapBucketCount)
  );
}

function getCellColor(cell) {
  const color = cell && cell.color;
  return {
    red: clampColorChannel(color && color.red, 31),
    green: clampColorChannel(color && color.green, 122),
    blue: clampColorChannel(color && color.blue, 140)
  };
}

function getCellAlpha(cell) {
  const rawIntensity = cell && cell.intensity;
  const intensity = Number(rawIntensity);
  return isPresentFiniteValue(rawIntensity, intensity) ? clamp(intensity, 0, 1) : 0.75;
}

function clampColorChannel(value, fallbackValue) {
  if (value === null || value === undefined || value === "") return fallbackValue;
  const numberValue = Number(value);
  return Math.round(clamp(Number.isFinite(numberValue) ? numberValue : fallbackValue, 0, 255));
}

function renderRectanglePath(bounds) {
  return "M" + formatSvgNumber(bounds.left) + " " + formatSvgNumber(bounds.top) +
    "H" + formatSvgNumber(bounds.right) +
    "V" + formatSvgNumber(bounds.bottom) +
    "H" + formatSvgNumber(bounds.left) + "Z";
}

function formatSvgNumber(value) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return "0";
  return Math.abs(numberValue - Math.round(numberValue)) < 0.001
    ? String(Math.round(numberValue))
    : numberValue.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

function getSpatialBucketCounts(cellCount, mediaWidth, mediaHeight, maximumBucketCount) {
  const maximumCount = Math.max(
    MINIMUM_SPATIAL_BUCKET_COUNT,
    normalizePositiveInteger(maximumBucketCount, MAXIMUM_SPATIAL_BUCKET_COUNT)
  );
  const aspectRatio = mediaWidth / mediaHeight;
  const targetBucketCount = clamp(
    Math.ceil(Math.sqrt(Math.max(1, cellCount))),
    MINIMUM_SPATIAL_BUCKET_COUNT,
    maximumCount
  );
  return {
    columns: Math.max(
      MINIMUM_SPATIAL_BUCKET_COUNT,
      Math.min(maximumCount, Math.round(targetBucketCount * Math.sqrt(aspectRatio)))
    ),
    rows: Math.max(
      MINIMUM_SPATIAL_BUCKET_COUNT,
      Math.min(maximumCount, Math.round(targetBucketCount / Math.sqrt(aspectRatio)))
    )
  };
}

function selectPackedSpatialBucketLayout(cells, mediaWidth, mediaHeight, maximumBucketCount) {
  const initialBucketCounts = getSpatialBucketCounts(
    cells.length,
    mediaWidth,
    mediaHeight,
    maximumBucketCount
  );
  let columns = initialBucketCounts.columns;
  let rows = initialBucketCounts.rows;
  while (true) {
    const bucketCounts = countPackedSpatialBucketMemberships(
      cells,
      mediaWidth,
      mediaHeight,
      columns,
      rows
    );
    const candidateCount = sumTypedArrayValues(bucketCounts);
    const targetCandidateCount = Math.max(bucketCounts.length, cells.length * 16);
    if (candidateCount <= targetCandidateCount || (columns === 1 && rows === 1)) {
      return { columns, rows, bucketCounts };
    }
    columns = Math.max(1, Math.ceil(columns / 2));
    rows = Math.max(1, Math.ceil(rows / 2));
  }
}

function countPackedSpatialBucketMemberships(cells, mediaWidth, mediaHeight, columns, rows) {
  const bucketCounts = new Uint32Array(columns * rows);
  for (const cell of cells) {
    visitSpatialBuckets(
      getFrameInternalsDisplayBounds(cell),
      mediaWidth,
      mediaHeight,
      columns,
      rows,
      (bucketIndex) => {
        bucketCounts[bucketIndex] += 1;
      }
    );
  }
  return bucketCounts;
}

function visitSpatialBuckets(bounds, mediaWidth, mediaHeight, columns, rows, visitor) {
  const firstColumn = getSpatialBucketCoordinate(bounds.left, mediaWidth, columns);
  const lastColumn = getSpatialBucketCoordinate(
    Math.max(bounds.left, bounds.right - Number.EPSILON),
    mediaWidth,
    columns
  );
  const firstRow = getSpatialBucketCoordinate(bounds.top, mediaHeight, rows);
  const lastRow = getSpatialBucketCoordinate(
    Math.max(bounds.top, bounds.bottom - Number.EPSILON),
    mediaHeight,
    rows
  );
  for (let bucketRow = firstRow; bucketRow <= lastRow; bucketRow += 1) {
    for (let bucketColumn = firstColumn; bucketColumn <= lastColumn; bucketColumn += 1) {
      visitor(bucketRow * columns + bucketColumn);
    }
  }
}

function findPackedFrameInternalsCell(spatialIndex, mapCoordinateX, mapCoordinateY) {
  const coordinateX = Number(mapCoordinateX);
  const coordinateY = Number(mapCoordinateY);
  if (
    !Number.isFinite(coordinateX) ||
    !Number.isFinite(coordinateY) ||
    coordinateX < 0 ||
    coordinateY < 0 ||
    coordinateX > spatialIndex.mediaWidth ||
    coordinateY > spatialIndex.mediaHeight
  ) {
    return null;
  }
  const bucketColumn = getSpatialBucketCoordinate(
    coordinateX,
    spatialIndex.mediaWidth,
    spatialIndex.bucketColumnCount
  );
  const bucketRow = getSpatialBucketCoordinate(
    coordinateY,
    spatialIndex.mediaHeight,
    spatialIndex.bucketRowCount
  );
  const bucketIndex = bucketRow * spatialIndex.bucketColumnCount + bucketColumn;
  const candidateStartIndex = spatialIndex.bucketOffsets[bucketIndex];
  const candidateEndIndex = spatialIndex.bucketOffsets[bucketIndex + 1];
  for (let candidateOffset = candidateStartIndex; candidateOffset < candidateEndIndex; candidateOffset += 1) {
    const cellIndex = spatialIndex.bucketCellIndexes[candidateOffset];
    const numericOffset = cellIndex * spatialIndex.numericStride;
    if (
      coordinateX >= spatialIndex.numericValues[numericOffset + PACKED_CELL_NUMERIC_FIELDS.displayPixelLeft] &&
      coordinateX <= spatialIndex.numericValues[numericOffset + PACKED_CELL_NUMERIC_FIELDS.displayPixelRight] &&
      coordinateY >= spatialIndex.numericValues[numericOffset + PACKED_CELL_NUMERIC_FIELDS.displayPixelTop] &&
      coordinateY <= spatialIndex.numericValues[numericOffset + PACKED_CELL_NUMERIC_FIELDS.displayPixelBottom]
    ) {
      return restorePackedFrameInternalsCell(spatialIndex, cellIndex);
    }
  }
  return null;
}

function restorePackedFrameInternalsCell(spatialIndex, cellIndex) {
  const numericOffset = cellIndex * spatialIndex.numericStride;
  const numericValues = spatialIndex.numericValues;
  const readNumericValue = (fieldName) => numericValues[
    numericOffset + PACKED_CELL_NUMERIC_FIELDS[fieldName]
  ];
  const ownBits = readNullablePackedNumber(readNumericValue("ownBits"));
  const subtreeBits = readNullablePackedNumber(readNumericValue("subtreeBits"));
  const codedBlockWidth = readNumericValue("codedBlockWidth");
  const codedBlockHeight = readNumericValue("codedBlockHeight");
  return {
    id: unpackStringValue(spatialIndex.identifierData, cellIndex),
    type: spatialIndex.typeValues[spatialIndex.typeIndexes[cellIndex]] || "block",
    partitionMode: spatialIndex.partitionModeValues[spatialIndex.partitionModeIndexes[cellIndex]] || "block",
    displayPixelLeft: readNumericValue("displayPixelLeft"),
    displayPixelTop: readNumericValue("displayPixelTop"),
    displayPixelRight: readNumericValue("displayPixelRight"),
    displayPixelBottom: readNumericValue("displayPixelBottom"),
    pixelLeft: readNumericValue("pixelLeft"),
    pixelTop: readNumericValue("pixelTop"),
    pixelRight: readNumericValue("pixelRight"),
    pixelBottom: readNumericValue("pixelBottom"),
    codedBlockWidth,
    codedBlockHeight,
    blockWidth: codedBlockWidth,
    blockHeight: codedBlockHeight,
    displayBlockWidth: readNumericValue("displayBlockWidth"),
    displayBlockHeight: readNumericValue("displayBlockHeight"),
    depth: readNumericValue("depth"),
    ownBits,
    syntaxBits: ownBits,
    subtreeBits,
    attributedBitsPerPixel: subtreeBits === null
      ? null
      : subtreeBits / Math.max(1, codedBlockWidth * codedBlockHeight),
    aggregatedDescendantCount: readNumericValue("aggregatedDescendantCount"),
    rootIndex: readNumericValue("rootIndex"),
    nominalUnits: readNumericValue("nominalUnits"),
    index: readNumericValue("index")
  };
}

function isPackedFrameInternalsSpatialIndex(spatialIndex) {
  return Boolean(
    spatialIndex &&
    spatialIndex.kind === PACKED_FRAME_INTERNALS_SPATIAL_INDEX_KIND &&
    ArrayBuffer.isView(spatialIndex.numericValues) &&
    ArrayBuffer.isView(spatialIndex.bucketOffsets) &&
    ArrayBuffer.isView(spatialIndex.bucketCellIndexes)
  );
}

function writePackedCellNumericValues(numericValues, cellIndex, cell) {
  const numericOffset = cellIndex * PACKED_CELL_NUMERIC_STRIDE;
  const displayBounds = getFrameInternalsDisplayBounds(cell);
  const codedBlockWidth = getFiniteNumber(
    cell && cell.codedBlockWidth,
    cell && cell.blockWidth
  );
  const codedBlockHeight = getFiniteNumber(
    cell && cell.codedBlockHeight,
    cell && cell.blockHeight
  );
  const values = {
    displayPixelLeft: displayBounds.left,
    displayPixelTop: displayBounds.top,
    displayPixelRight: displayBounds.right,
    displayPixelBottom: displayBounds.bottom,
    pixelLeft: getFiniteNumber(cell && cell.pixelLeft, displayBounds.left),
    pixelTop: getFiniteNumber(cell && cell.pixelTop, displayBounds.top),
    pixelRight: getFiniteNumber(cell && cell.pixelRight, displayBounds.right),
    pixelBottom: getFiniteNumber(cell && cell.pixelBottom, displayBounds.bottom),
    codedBlockWidth,
    codedBlockHeight,
    depth: getFiniteNumber(cell && cell.depth, 0),
    ownBits: writeNullablePackedNumber(cell && (cell.ownBits ?? cell.syntaxBits)),
    subtreeBits: writeNullablePackedNumber(cell && cell.subtreeBits),
    aggregatedDescendantCount: getFiniteNumber(cell && cell.aggregatedDescendantCount, 0),
    rootIndex: getFiniteNumber(cell && cell.rootIndex, 0),
    nominalUnits: getFiniteNumber(cell && cell.nominalUnits, 0),
    index: getFiniteNumber(cell && cell.index, cellIndex),
    displayBlockWidth: getFiniteNumber(cell && cell.displayBlockWidth, displayBounds.right - displayBounds.left),
    displayBlockHeight: getFiniteNumber(cell && cell.displayBlockHeight, displayBounds.bottom - displayBounds.top)
  };
  for (const [fieldName, fieldOffset] of Object.entries(PACKED_CELL_NUMERIC_FIELDS)) {
    numericValues[numericOffset + fieldOffset] = values[fieldName];
  }
}

function packStringValues(values) {
  const encodedValues = values.map((value) => UTF8_TEXT_ENCODER.encode(
    String(value === null || value === undefined ? "" : value)
  ));
  const offsets = new Uint32Array(encodedValues.length + 1);
  for (let valueIndex = 0; valueIndex < encodedValues.length; valueIndex += 1) {
    offsets[valueIndex + 1] = offsets[valueIndex] + encodedValues[valueIndex].byteLength;
  }
  const encodedBytes = new Uint8Array(offsets.at(-1));
  for (let valueIndex = 0; valueIndex < encodedValues.length; valueIndex += 1) {
    encodedBytes.set(encodedValues[valueIndex], offsets[valueIndex]);
  }
  return { encodedBytes, offsets };
}

function unpackStringValue(packedStringValues, valueIndex) {
  if (
    !packedStringValues ||
    !ArrayBuffer.isView(packedStringValues.encodedBytes) ||
    !ArrayBuffer.isView(packedStringValues.offsets)
  ) return "";
  const startOffset = packedStringValues.offsets[valueIndex];
  const endOffset = packedStringValues.offsets[valueIndex + 1];
  return UTF8_TEXT_DECODER.decode(
    packedStringValues.encodedBytes.subarray(startOffset, endOffset)
  );
}

function internStringValue(value, values, indexesByValue) {
  const existingIndex = indexesByValue.get(value);
  if (existingIndex !== undefined) return existingIndex;
  const valueIndex = values.length;
  values.push(value);
  indexesByValue.set(value, valueIndex);
  return valueIndex;
}

function writeNullablePackedNumber(value) {
  if (value === null || value === undefined || value === "") return Number.NaN;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : Number.NaN;
}

function readNullablePackedNumber(value) {
  return Number.isFinite(value) ? value : null;
}

function sumTypedArrayValues(values) {
  let total = 0;
  for (const value of values) total += value;
  return total;
}

function getSpatialBucketCoordinate(value, mediaLength, bucketCount) {
  const normalizedValue = clamp(Number(value) / Math.max(1, mediaLength), 0, 1);
  return Math.min(bucketCount - 1, Math.floor(normalizedValue * bucketCount));
}

function getFiniteNumber(primaryValue, fallbackValue) {
  const primaryNumber = Number(primaryValue);
  if (isPresentFiniteValue(primaryValue, primaryNumber)) return primaryNumber;
  const fallbackNumber = Number(fallbackValue);
  return isPresentFiniteValue(fallbackValue, fallbackNumber) ? fallbackNumber : 0;
}

function isPresentFiniteValue(rawValue, numberValue) {
  return rawValue !== null && rawValue !== undefined && rawValue !== "" && Number.isFinite(numberValue);
}

function normalizePositiveInteger(value, fallbackValue) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue > 0
    ? Math.max(1, Math.round(numberValue))
    : fallbackValue;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}
