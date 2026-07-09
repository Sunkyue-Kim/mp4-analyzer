const MAX_VIDEO_DISPLAY_CELLS = 1800;
const MAX_GLOBAL_DISTRIBUTION_VALUES = 120000;

const HEAT_COLOR_STOPS = [
  { percentile: 0, red: 226, green: 245, blue: 241 },
  { percentile: 0.25, red: 116, green: 209, blue: 188 },
  { percentile: 0.5, red: 28, green: 164, blue: 135 },
  { percentile: 0.75, red: 255, green: 191, blue: 0 },
  { percentile: 0.9, red: 247, green: 124, blue: 60 },
  { percentile: 1, red: 198, green: 40, blue: 40 }
];

const VIDEO_CODING_UNITS = [
  {
    matches: (track) => track.codecDescriptor === "avc" || ["avc1", "avc2", "avc3", "avc4"].includes(track.codec),
    codecFamily: "AVC / H.264",
    unitName: "macroblock",
    unitWidth: 16,
    unitHeight: 16,
    accuracy: "nominal-exact-grid",
    note: "AVC uses a 16x16 macroblock raster. Internal prediction partitions and transform blocks require slice-data syntax decoding."
  },
  {
    matches: (track) => track.codecDescriptor === "hevc" || ["hvc1", "hev1"].includes(track.codec),
    codecFamily: "HEVC / H.265",
    unitName: "CTU",
    unitWidth: 64,
    unitHeight: 64,
    accuracy: "nominal-grid",
    note: "HEVC CTU size is signaled in SPS. This view uses the common 64x64 CTU nominal grid until SPS partition parsing is added."
  },
  {
    matches: (track) => track.codec === "V_VP9" || track.codecDescriptor === "V_VP9" || String(track.codec).toLowerCase() === "vp9",
    codecFamily: "VP9",
    unitName: "superblock",
    unitWidth: 64,
    unitHeight: 64,
    accuracy: "nominal-grid",
    note: "VP9 superblock partition data is entropy coded in frame payloads. This view shows a nominal 64x64 superblock grid."
  },
  {
    matches: (track) => track.codec === "av01" || track.codecDescriptor === "av1",
    codecFamily: "AV1",
    unitName: "superblock",
    unitWidth: 128,
    unitHeight: 128,
    accuracy: "future-nominal-grid",
    note: "AV1 can use 64x64 or 128x128 superblocks. This placeholder assumes 128x128 until AV1 sequence header parsing is added."
  }
];

const AUDIO_BANDS = [
  { label: "Sub", range: "20-60 Hz", startHz: 20, endHz: 60 },
  { label: "Bass", range: "60-250 Hz", startHz: 60, endHz: 250 },
  { label: "Low mid", range: "250-500 Hz", startHz: 250, endHz: 500 },
  { label: "Mid", range: "500 Hz-2 kHz", startHz: 500, endHz: 2000 },
  { label: "High mid", range: "2-4 kHz", startHz: 2000, endHz: 4000 },
  { label: "Presence", range: "4-6 kHz", startHz: 4000, endHz: 6000 },
  { label: "Brilliance", range: "6-12 kHz", startHz: 6000, endHz: 12000 },
  { label: "Air", range: "12-20 kHz", startHz: 12000, endHz: 20000 }
];

function buildFrameInternalsModel(row, track, options = {}) {
  if (!row || !track) {
    return {
      kind: "empty",
      title: "No frame selected",
      note: "Select a frame row to inspect its nominal internal structure."
    };
  }
  if (track.handlerType === "vide") return buildVideoInternalsModel(row, track, options);
  if (track.handlerType === "soun") return buildAudioInternalsModel(row, track);
  return {
    kind: "unsupported",
    title: "Internal structure unavailable",
    note: "This track type does not expose a supported nominal frame structure."
  };
}

function buildVideoInternalsModel(row, track, options = {}) {
  const descriptor = VIDEO_CODING_UNITS.find((candidate) => candidate.matches(track));
  const dimensions = getVideoTrackDimensions(track);
  const width = dimensions.displayWidth;
  const height = dimensions.displayHeight;
  if (!descriptor || !width || !height) {
    return {
      kind: "unsupported",
      title: "Video block view unavailable",
      note: "This video codec or track size is not mapped to a nominal coding-unit grid yet.",
      codec: track.codec
    };
  }

  const nominalColumns = Math.max(1, Math.ceil(width / descriptor.unitWidth));
  const nominalRows = Math.max(1, Math.ceil(height / descriptor.unitHeight));
  const aggregation = Math.max(1, Math.ceil(Math.sqrt((nominalColumns * nominalRows) / MAX_VIDEO_DISPLAY_CELLS)));
  const displayColumns = Math.ceil(nominalColumns / aggregation);
  const displayRows = Math.ceil(nominalRows / aggregation);
  const cells = buildVideoCells({
    row,
    descriptor,
    width,
    height,
    nominalColumns,
    nominalRows,
    displayColumns,
    displayRows,
    aggregation
  });
  const colorScale = options.colorScale || buildFrameInternalsColorScale(track, options.sampleRows, {
    descriptor,
    width,
    height,
    nominalColumns,
    nominalRows,
    displayColumns,
    displayRows,
    aggregation,
    fallbackCells: cells
  });
  applyVideoColorScale(cells, colorScale);

  return {
    kind: "video-grid",
    title: descriptor.codecFamily + " " + descriptor.unitName + " grid",
    codecFamily: descriptor.codecFamily,
    codec: track.codec,
    frameType: row.frameType || "unknown",
    sampleSize: Number(row.size) || 0,
    unitName: descriptor.unitName,
    unitWidth: descriptor.unitWidth,
    unitHeight: descriptor.unitHeight,
    mediaWidth: width,
    mediaHeight: height,
    encodedWidth: dimensions.encodedWidth,
    encodedHeight: dimensions.encodedHeight,
    displayRotationDegrees: dimensions.displayRotationDegrees,
    nominalColumns,
    nominalRows,
    nominalUnitCount: nominalColumns * nominalRows,
    displayColumns,
    displayRows,
    displayCellCount: displayColumns * displayRows,
    aggregation,
    accuracy: descriptor.accuracy,
    colorScale: summarizeColorScale(colorScale),
    note: descriptor.note,
    cells
  };
}

function buildFrameInternalsColorScale(track, sampleRows, options = {}) {
  if (!track || track.handlerType !== "vide") return buildValueDistribution([], "unavailable", 0);
  const descriptor = options.descriptor || VIDEO_CODING_UNITS.find((candidate) => candidate.matches(track));
  const dimensions = getVideoTrackDimensions(track);
  const width = options.width || dimensions.displayWidth;
  const height = options.height || dimensions.displayHeight;
  if (!descriptor || !width || !height) return buildValueDistribution([], "unavailable", 0);

  const nominalColumns = options.nominalColumns || Math.max(1, Math.ceil(width / descriptor.unitWidth));
  const nominalRows = options.nominalRows || Math.max(1, Math.ceil(height / descriptor.unitHeight));
  const aggregation = options.aggregation || Math.max(1, Math.ceil(Math.sqrt((nominalColumns * nominalRows) / MAX_VIDEO_DISPLAY_CELLS)));
  const displayColumns = options.displayColumns || Math.ceil(nominalColumns / aggregation);
  const displayRows = options.displayRows || Math.ceil(nominalRows / aggregation);
  const rows = getVideoScaleRows(track, sampleRows);

  if (!rows.length) {
    const fallbackValues = (options.fallbackCells || [])
      .map((cell) => Number(cell.estimatedBytes) || 0)
      .filter((value) => value >= 0);
    return buildValueDistribution(fallbackValues, "selected-frame-percentile", fallbackValues.length ? 1 : 0);
  }

  const scaleOptions = {
    descriptor,
    width,
    height,
    nominalColumns,
    nominalRows,
    displayColumns,
    displayRows,
    aggregation
  };
  const cellCount = Math.max(1, displayColumns * displayRows);
  const cellStride = Math.max(1, Math.ceil((rows.length * cellCount) / MAX_GLOBAL_DISTRIBUTION_VALUES));
  const sampledValues = [];
  for (const sampleRow of rows) {
    const sampleSize = Math.max(0, Number(sampleRow.size) || 0);
    if (!sampleSize) continue;
    const totalWeight = calculateVideoTotalWeight(scaleOptions, sampleRow);
    if (totalWeight <= 0) continue;
    for (let linearIndex = 0; linearIndex < cellCount; linearIndex += cellStride) {
      const rowIndex = Math.floor(linearIndex / displayColumns);
      const columnIndex = linearIndex % displayColumns;
      const weight = getVideoCellWeight(scaleOptions, sampleRow, rowIndex, columnIndex);
      sampledValues.push(sampleSize * weight / totalWeight);
    }
  }
  return buildValueDistribution(sampledValues, "global-track-percentile", rows.length);
}

function getVideoTrackDimensions(track) {
  const encodedWidth = positiveRoundedDimension(track.encodedWidth) || positiveRoundedDimension(track.width);
  const encodedHeight = positiveRoundedDimension(track.encodedHeight) || positiveRoundedDimension(track.height);
  const displayWidth = positiveRoundedDimension(track.displayWidth) || encodedWidth;
  const displayHeight = positiveRoundedDimension(track.displayHeight) || encodedHeight;
  return {
    encodedWidth,
    encodedHeight,
    displayWidth,
    displayHeight,
    displayRotationDegrees: normalizeRotationDegrees(track.displayRotationDegrees)
  };
}

function positiveRoundedDimension(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue > 0 ? Math.round(numberValue) : 0;
}

function normalizeRotationDegrees(value) {
  const numberValue = Number(value) || 0;
  let normalized = numberValue % 360;
  if (normalized > 180) normalized -= 360;
  if (normalized <= -180) normalized += 360;
  return Object.is(normalized, -0) ? 0 : normalized;
}

function getVideoScaleRows(track, sampleRows) {
  if (!Array.isArray(sampleRows)) return [];
  return sampleRows.filter((row) =>
    row &&
    String(row.trackId) === String(track.trackId) &&
    Math.max(0, Number(row.size) || 0) > 0
  );
}

function buildVideoCells(options) {
  const cells = [];
  let totalWeight = 0;
  for (let rowIndex = 0; rowIndex < options.displayRows; rowIndex += 1) {
    for (let columnIndex = 0; columnIndex < options.displayColumns; columnIndex += 1) {
      const unitColumnStart = columnIndex * options.aggregation;
      const unitColumnEnd = Math.min(options.nominalColumns, unitColumnStart + options.aggregation);
      const unitRowStart = rowIndex * options.aggregation;
      const unitRowEnd = Math.min(options.nominalRows, unitRowStart + options.aggregation);
      const nominalUnits = Math.max(1, (unitColumnEnd - unitColumnStart) * (unitRowEnd - unitRowStart));
      const weight = nominalUnits * getSyntheticSpatialWeight(options.row, rowIndex, columnIndex, options.displayRows, options.displayColumns);
      totalWeight += weight;
      cells.push({
        rowIndex,
        columnIndex,
        unitColumnStart,
        unitColumnEnd,
        unitRowStart,
        unitRowEnd,
        nominalUnits,
        pixelLeft: unitColumnStart * options.descriptor.unitWidth,
        pixelTop: unitRowStart * options.descriptor.unitHeight,
        pixelRight: Math.min(options.width, unitColumnEnd * options.descriptor.unitWidth),
        pixelBottom: Math.min(options.height, unitRowEnd * options.descriptor.unitHeight),
        weight
      });
    }
  }
  const sampleSize = Math.max(0, Number(options.row.size) || 0);
  for (const cell of cells) {
    const byteEstimate = totalWeight > 0 ? sampleSize * cell.weight / totalWeight : 0;
    cell.estimatedBytes = byteEstimate;
    cell.localRatio = sampleSize > 0 ? byteEstimate * cells.length / sampleSize : 0;
    delete cell.weight;
  }
  return cells;
}

function calculateVideoTotalWeight(options, row) {
  let totalWeight = 0;
  for (let rowIndex = 0; rowIndex < options.displayRows; rowIndex += 1) {
    for (let columnIndex = 0; columnIndex < options.displayColumns; columnIndex += 1) {
      totalWeight += getVideoCellWeight(options, row, rowIndex, columnIndex);
    }
  }
  return totalWeight;
}

function getVideoCellWeight(options, row, rowIndex, columnIndex) {
  const unitColumnStart = columnIndex * options.aggregation;
  const unitColumnEnd = Math.min(options.nominalColumns, unitColumnStart + options.aggregation);
  const unitRowStart = rowIndex * options.aggregation;
  const unitRowEnd = Math.min(options.nominalRows, unitRowStart + options.aggregation);
  const nominalUnits = Math.max(1, (unitColumnEnd - unitColumnStart) * (unitRowEnd - unitRowStart));
  return nominalUnits * getSyntheticSpatialWeight(row, rowIndex, columnIndex, options.displayRows, options.displayColumns);
}

function applyVideoColorScale(cells, colorScale) {
  const values = colorScale && colorScale.values || [];
  for (const cell of cells) {
    const percentile = getPercentileRank(values, cell.estimatedBytes);
    const color = getPercentileHeatColor(percentile);
    cell.globalPercentile = percentile;
    cell.intensity = getPercentileAlpha(percentile);
    cell.color = color;
  }
}

function buildValueDistribution(values, mode, sampleCount) {
  const sortedValues = values
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value >= 0)
    .sort((left, right) => left - right);
  if (!sortedValues.length) sortedValues.push(0);
  return {
    mode,
    values: sortedValues,
    valueCount: sortedValues.length,
    sampleCount,
    min: sortedValues[0],
    max: sortedValues[sortedValues.length - 1],
    p10: getQuantile(sortedValues, 0.1),
    p25: getQuantile(sortedValues, 0.25),
    p50: getQuantile(sortedValues, 0.5),
    p75: getQuantile(sortedValues, 0.75),
    p90: getQuantile(sortedValues, 0.9),
    p95: getQuantile(sortedValues, 0.95),
    p99: getQuantile(sortedValues, 0.99)
  };
}

function summarizeColorScale(colorScale) {
  const { values, ...summary } = colorScale || buildValueDistribution([], "unavailable", 0);
  return summary;
}

function getQuantile(sortedValues, percentile) {
  if (!sortedValues.length) return 0;
  const position = clamp(percentile, 0, 1) * (sortedValues.length - 1);
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  if (lowerIndex === upperIndex) return sortedValues[lowerIndex];
  const ratio = position - lowerIndex;
  return sortedValues[lowerIndex] * (1 - ratio) + sortedValues[upperIndex] * ratio;
}

function getPercentileRank(sortedValues, value) {
  if (!sortedValues.length) return 0.5;
  const minimum = sortedValues[0];
  const maximum = sortedValues[sortedValues.length - 1];
  if (maximum <= minimum) return 0.5;
  const index = upperBound(sortedValues, value);
  return clamp((index - 1) / (sortedValues.length - 1), 0, 1);
}

function upperBound(sortedValues, value) {
  let low = 0;
  let high = sortedValues.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (sortedValues[middle] <= value) low = middle + 1;
    else high = middle;
  }
  return low;
}

function getPercentileAlpha(percentile) {
  const mappedPercentile = getNonlinearHeatPercentile(percentile);
  return 0.72 + mappedPercentile * 0.28;
}

function getPercentileHeatColor(percentile) {
  const mappedPercentile = getNonlinearHeatPercentile(percentile);
  let lowerStop = HEAT_COLOR_STOPS[0];
  let upperStop = HEAT_COLOR_STOPS[HEAT_COLOR_STOPS.length - 1];
  for (let index = 1; index < HEAT_COLOR_STOPS.length; index += 1) {
    if (mappedPercentile <= HEAT_COLOR_STOPS[index].percentile) {
      lowerStop = HEAT_COLOR_STOPS[index - 1];
      upperStop = HEAT_COLOR_STOPS[index];
      break;
    }
  }
  const span = Math.max(0.000001, upperStop.percentile - lowerStop.percentile);
  const ratio = clamp((mappedPercentile - lowerStop.percentile) / span, 0, 1);
  return {
    red: Math.round(lowerStop.red + (upperStop.red - lowerStop.red) * ratio),
    green: Math.round(lowerStop.green + (upperStop.green - lowerStop.green) * ratio),
    blue: Math.round(lowerStop.blue + (upperStop.blue - lowerStop.blue) * ratio)
  };
}

function getNonlinearHeatPercentile(percentile) {
  const value = clamp(percentile, 0, 1);
  if (value < 0.5) return 0.38 * Math.pow(value / 0.5, 0.9);
  if (value < 0.9) return 0.38 + 0.42 * Math.pow((value - 0.5) / 0.4, 0.72);
  return 0.8 + 0.2 * Math.pow((value - 0.9) / 0.1, 0.45);
}

function getSyntheticSpatialWeight(row, rowIndex, columnIndex, rowCount, columnCount) {
  const x = columnCount <= 1 ? 0.5 : columnIndex / (columnCount - 1);
  const y = rowCount <= 1 ? 0.5 : rowIndex / (rowCount - 1);
  const centerX = x - 0.5;
  const centerY = y - 0.5;
  const centerBias = 1.1 - Math.min(0.65, Math.sqrt(centerX * centerX + centerY * centerY));
  const type = row.frameType || "";
  const typeBias = type === "I" || type === "IDR" ? 1.15 : type === "B" ? 0.92 : 1;
  return Math.max(0.1, centerBias * typeBias * (0.72 + deterministicNoise(row, rowIndex, columnIndex) * 0.56));
}

function deterministicNoise(row, rowIndex, columnIndex) {
  let value = (
    (Number(row.trackId) || 0) * 73856093 ^
    (Number(row.sampleIndex) || 0) * 19349663 ^
    rowIndex * 83492791 ^
    columnIndex * 2654435761
  ) >>> 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  return ((value >>> 0) % 1000) / 999;
}

function buildAudioInternalsModel(row, track) {
  const sampleSize = Math.max(0, Number(row.size) || 0);
  const sampleRate = getAudioSampleRate(track);
  const activeBandwidthHz = getActiveAudioBandwidth(row, track, sampleRate);
  const weights = AUDIO_BANDS.map((band, index) => getAudioBandWeight(band, index, row, activeBandwidthHz));
  const totalWeight = weights.reduce((sum, value) => sum + value, 0) || 1;
  const bands = AUDIO_BANDS.map((band, index) => {
    const estimatedBytes = sampleSize * weights[index] / totalWeight;
    return {
      ...band,
      active: band.startHz < activeBandwidthHz,
      estimatedBytes,
      ratio: sampleSize > 0 ? estimatedBytes / sampleSize : 0,
      intensity: clamp(weights[index] / Math.max(...weights), 0.12, 1)
    };
  });
  return {
    kind: "audio-bands",
    title: (track.codecConfig && track.codecConfig.audioObjectTypeName || track.codec || "Audio") + " band budget",
    codec: track.codec,
    frameType: row.frameType || "audio",
    sampleSize,
    sampleRate,
    activeBandwidthHz,
    channelCount: track.channelCount || 0,
    note: "This is a packet-size and codec-metadata estimate. Exact per-band bit allocation requires codec payload decoding.",
    bands
  };
}

function getAudioSampleRate(track) {
  const configRate = track.codecConfig && (track.codecConfig.samplingFrequency || track.codecConfig.inputSampleRate);
  return Math.max(0, Number(configRate || track.sampleRate || 0));
}

function getActiveAudioBandwidth(row, track, sampleRate) {
  const tags = (row.nalTypes || []).map((value) => String(value));
  const bandwidthTag = tags.find((value) => /^(NB|MB|WB|SWB|FB)$/.test(value));
  const bandwidthMap = { NB: 4000, MB: 6000, WB: 8000, SWB: 12000, FB: 20000 };
  if (bandwidthTag) return bandwidthMap[bandwidthTag];
  const nyquist = sampleRate > 0 ? sampleRate / 2 : 20000;
  return Math.max(4000, Math.min(20000, nyquist));
}

function getAudioBandWeight(band, index, row, activeBandwidthHz) {
  if (band.startHz >= activeBandwidthHz) return 0.04;
  const activeEnd = Math.min(band.endHz, activeBandwidthHz);
  const activeSpan = Math.max(0, activeEnd - band.startHz);
  const spanWeight = Math.log2(1 + activeSpan / 40);
  return Math.max(0.08, spanWeight * (0.72 + deterministicNoise(row, index, band.endHz) * 0.56));
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

export {
  AUDIO_BANDS,
  VIDEO_CODING_UNITS,
  buildFrameInternalsColorScale,
  buildFrameInternalsModel
};
