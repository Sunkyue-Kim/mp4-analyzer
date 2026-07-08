const MAX_VIDEO_DISPLAY_CELLS = 1800;

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

function buildFrameInternalsModel(row, track) {
  if (!row || !track) {
    return {
      kind: "empty",
      title: "No frame selected",
      note: "Select a frame row to inspect its nominal internal structure."
    };
  }
  if (track.handlerType === "vide") return buildVideoInternalsModel(row, track);
  if (track.handlerType === "soun") return buildAudioInternalsModel(row, track);
  return {
    kind: "unsupported",
    title: "Internal structure unavailable",
    note: "This track type does not expose a supported nominal frame structure."
  };
}

function buildVideoInternalsModel(row, track) {
  const descriptor = VIDEO_CODING_UNITS.find((candidate) => candidate.matches(track));
  const width = Math.max(0, Math.round(Number(track.width) || 0));
  const height = Math.max(0, Math.round(Number(track.height) || 0));
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
    nominalColumns,
    nominalRows,
    nominalUnitCount: nominalColumns * nominalRows,
    displayColumns,
    displayRows,
    displayCellCount: displayColumns * displayRows,
    aggregation,
    accuracy: descriptor.accuracy,
    note: descriptor.note,
    cells
  };
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
    cell.intensity = sampleSize > 0 ? clamp(byteEstimate * cells.length / sampleSize, 0.12, 1) : 0.12;
    delete cell.weight;
  }
  return cells;
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
  buildFrameInternalsModel
};
