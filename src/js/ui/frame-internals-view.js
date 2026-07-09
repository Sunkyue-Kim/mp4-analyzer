import {
  clamp,
  formatBytes,
  formatMetricNumber
} from "../core/analyzer-core.js";
import {
  getLanguage,
  t
} from "../i18n/catalogs.js";
import {
  escapeHtml,
  getFrameTypeClass
} from "./ui-helpers.js";

export function renderVideoFrameInternals(model, options = {}) {
  const frameClass = getFrameTypeClass(model.frameType);
  const stats = [
    [t("frameInternals.codec"), model.codecFamily],
    [t("frameInternals.frame"), options.frameLabel || t("value.notAvailable")],
    [t("frameInternals.unit"), model.unitName + " " + model.unitWidth + "x" + model.unitHeight],
    [t("frameInternals.mediaSize"), formatVideoMediaSize(model)],
    [t("frameInternals.nominalGrid"), model.nominalColumns + "x" + model.nominalRows + " (" + model.nominalUnitCount + ")"],
    [t("frameInternals.displayedGrid"), formatVideoDisplayedGrid(model)],
    [t("frameInternals.partitionModes"), formatPartitionModes(model.partitionModes)],
    [t("frameInternals.sampleSize"), formatBytes(model.sampleSize)],
    [t("frameInternals.colorScale"), formatFrameInternalsColorScale(model.colorScale)],
    [t("frameInternals.accuracy"), t("frameInternals.nominal")]
  ];
  return '<div class="frame-internals-layout">' +
    '<div class="frame-internals-summary">' +
    '<div class="frame-internals-title-row"><strong>' + escapeHtml(model.title) + '</strong><span class="pill ' + frameClass + '">' + escapeHtml(formatFrameTypeLabel(model.frameType)) + '</span></div>' +
    '<p class="frame-internals-note">' + escapeHtml(model.note) + '</p>' +
    renderFrameInternalsStats(stats) +
    '</div>' +
    '<div class="block-heatmap-wrap">' +
    '<div class="block-map" style="' + renderVideoBlockMapStyle(model) + '">' +
    model.cells.map((cell) => renderVideoBlockCell(cell, model, frameClass)).join("") +
    '</div>' +
    '<p class="frame-internals-note">' + escapeHtml(t("frameInternals.videoEstimateNote")) + '</p>' +
    '</div>' +
    '</div>';
}

function renderVideoBlockMapStyle(model) {
  const mediaWidth = Math.max(1, Number(model.mediaWidth) || 1);
  const mediaHeight = Math.max(1, Number(model.mediaHeight) || 1);
  const maxHeight = Math.max(160, Number(model.mapMaxHeight) || 280);
  const maxWidth = Math.max(1, Math.round(maxHeight * mediaWidth / mediaHeight));
  return [
    "--frame-aspect-ratio:" + mediaWidth + " / " + mediaHeight,
    "--frame-map-max-width:" + maxWidth + "px"
  ].join(";");
}

function formatVideoDisplayedGrid(model) {
  const blocks = model.partitionBlockCount || model.displayCellCount || 0;
  const roots = model.displayColumns && model.displayRows ? model.displayColumns + "x" + model.displayRows : t("value.notAvailable");
  const depth = model.maxPartitionDepth ? ", " + t("frameInternals.maxDepth", { depth: model.maxPartitionDepth }) : "";
  const aggregation = model.aggregation > 1 ? ", " + t("frameInternals.rootAggregation", { value: model.aggregation }) : "";
  return t("frameInternals.partitionBlocks", { count: blocks }) + " (" + roots + depth + aggregation + ")";
}

function formatPartitionModes(modes) {
  if (!Array.isArray(modes) || !modes.length) return t("value.notAvailable");
  return modes.slice(0, 4).map((entry) => entry.mode + " " + entry.count).join(", ");
}

function formatVideoMediaSize(model) {
  const displaySize = model.mediaWidth + "x" + model.mediaHeight;
  const encodedWidth = Number(model.encodedWidth) || 0;
  const encodedHeight = Number(model.encodedHeight) || 0;
  const rotationDegrees = Number(model.displayRotationDegrees) || 0;
  const details = [];
  if (rotationDegrees) details.push(t("frameInternals.rotatedDegrees", { degrees: rotationDegrees }));
  if (encodedWidth && encodedHeight && (encodedWidth !== model.mediaWidth || encodedHeight !== model.mediaHeight)) {
    details.push(t("frameInternals.encodedSize", { size: encodedWidth + "x" + encodedHeight }));
  }
  return details.length ? displaySize + " (" + details.join(", ") + ")" : displaySize;
}

function renderVideoBlockCell(cell, model, frameClass) {
  const displayBounds = getDisplayCellBounds(cell);
  const title = model.unitName + " " + (cell.blockWidth || 0) + "x" + (cell.blockHeight || 0) + " @ " + cell.pixelLeft + "," + cell.pixelTop;
  const tooltipRows = [
    [t("frameInternals.tooltip.encodedPixelRange"), cell.pixelLeft + "," + cell.pixelTop + " - " + cell.pixelRight + "," + cell.pixelBottom],
    [t("frameInternals.tooltip.displayPixelRange"), formatCellBounds(displayBounds)],
    [t("frameInternals.tooltip.blockSize"), (cell.blockWidth || 0) + "x" + (cell.blockHeight || 0)],
    [t("frameInternals.tooltip.partition"), cell.partitionMode || t("value.notAvailable")],
    [t("frameInternals.tooltip.depth"), cell.depth || 0],
    [t("frameInternals.tooltip.estimatedBytes"), formatBytes(cell.estimatedBytes)],
    [t("frameInternals.tooltip.byteDensity"), formatByteDensity(cell.estimatedBytesPerPixel, cell.normalizedByteDensity)],
    [t("frameInternals.tooltip.globalPercentile"), formatMetricNumber((cell.globalPercentile || 0) * 100, 1) + "%"],
    [t("frameInternals.tooltip.nominalUnits"), cell.nominalUnits],
    [t("frameInternals.tooltip.accuracy"), t("frameInternals.tooltip.nominalEstimate")]
  ];
  return '<div class="block-cell ' + frameClass + '"' +
    renderFrameInternalsTooltipAttributes({
      title,
      rows: tooltipRows,
      note: t("frameInternals.videoEstimateNote")
    }) +
    ' style="' + renderVideoBlockCellStyle(cell, model) + '"></div>';
}

function renderVideoBlockCellStyle(cell, model) {
  const color = cell.color || { red: 31, green: 122, blue: 140 };
  const alpha = Number.isFinite(cell.intensity) ? cell.intensity : 0.75;
  const displayBounds = getDisplayCellBounds(cell);
  const mediaWidth = Math.max(1, Number(model.mediaWidth) || 1);
  const mediaHeight = Math.max(1, Number(model.mediaHeight) || 1);
  return [
    '--cell-red:' + color.red,
    '--cell-green:' + color.green,
    '--cell-blue:' + color.blue,
    '--cell-alpha:' + alpha.toFixed(3),
    '--cell-left:' + (displayBounds.left * 100 / mediaWidth).toFixed(5) + '%',
    '--cell-top:' + (displayBounds.top * 100 / mediaHeight).toFixed(5) + '%',
    '--cell-width:' + ((displayBounds.right - displayBounds.left) * 100 / mediaWidth).toFixed(5) + '%',
    '--cell-height:' + ((displayBounds.bottom - displayBounds.top) * 100 / mediaHeight).toFixed(5) + '%',
    '--cell-depth:' + (cell.depth || 0)
  ].join(";");
}

function getDisplayCellBounds(cell) {
  return {
    left: getFiniteNumber(cell.displayPixelLeft, cell.pixelLeft),
    top: getFiniteNumber(cell.displayPixelTop, cell.pixelTop),
    right: getFiniteNumber(cell.displayPixelRight, cell.pixelRight),
    bottom: getFiniteNumber(cell.displayPixelBottom, cell.pixelBottom)
  };
}

function formatCellBounds(bounds) {
  return formatCellCoordinate(bounds.left) + "," + formatCellCoordinate(bounds.top) +
    " - " + formatCellCoordinate(bounds.right) + "," + formatCellCoordinate(bounds.bottom);
}

function formatCellCoordinate(value) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return "0";
  return Math.abs(numberValue - Math.round(numberValue)) < 0.001
    ? String(Math.round(numberValue))
    : formatMetricNumber(numberValue, 2);
}

function formatByteDensity(bytesPerPixel, normalizedByteDensity) {
  const density = Number(bytesPerPixel);
  const normalized = Number(normalizedByteDensity);
  if (!Number.isFinite(density) || density < 0) return t("value.notAvailable");
  const normalizedText = Number.isFinite(normalized) && normalized >= 0
    ? ", " + formatMetricNumber(normalized, 2) + "x"
    : "";
  return formatMetricNumber(density, density < 0.01 ? 4 : 3) + " B/px" + normalizedText;
}

function getFiniteNumber(primaryValue, fallbackValue) {
  const primaryNumber = Number(primaryValue);
  if (Number.isFinite(primaryNumber)) return primaryNumber;
  const fallbackNumber = Number(fallbackValue);
  return Number.isFinite(fallbackNumber) ? fallbackNumber : 0;
}

function formatFrameInternalsColorScale(colorScale) {
  if (!colorScale) return t("value.notAvailable");
  if (colorScale.mode === "global-track-percentile") {
    return t("frameInternals.globalTrackPercentile", {
      count: colorScale.sampleCount,
      values: colorScale.valueCount
    });
  }
  if (colorScale.mode === "selected-frame-percentile") return t("frameInternals.selectedFramePercentile");
  return t("value.notAvailable");
}

export function renderAudioFrameInternals(model, options = {}) {
  const stats = [
    [t("frameInternals.codec"), model.title],
    [t("frameInternals.frame"), options.frameLabel || t("value.notAvailable")],
    [t("frameInternals.sampleSize"), formatBytes(model.sampleSize)],
    [t("frameInternals.sampleRate"), model.sampleRate ? formatMetricNumber(model.sampleRate, 0) + " Hz" : t("value.notAvailable")],
    [t("frameInternals.activeBandwidth"), formatAudioFrequency(model.activeBandwidthHz)],
    [t("frameInternals.channels"), model.channelCount || t("value.notAvailable")]
  ];
  return '<div class="frame-internals-layout">' +
    '<div class="frame-internals-summary">' +
    '<div class="frame-internals-title-row"><strong>' + escapeHtml(t("frameInternals.audioBands")) + '</strong><span class="pill aac">' + escapeHtml(formatFrameTypeLabel(model.frameType)) + '</span></div>' +
    '<p class="frame-internals-note">' + escapeHtml(model.note) + '</p>' +
    renderFrameInternalsStats(stats) +
    '</div>' +
    '<div class="block-heatmap-wrap">' +
    '<div class="audio-band-plot">' + model.bands.map(renderAudioBandRow).join("") + '</div>' +
    '<p class="frame-internals-note">' + escapeHtml(t("frameInternals.audioEstimateNote")) + '</p>' +
    '</div>' +
    '</div>';
}

function renderAudioBandRow(band) {
  const widthPercent = clamp(band.ratio * 100, band.active ? 2 : 0.8, 100);
  const tooltipRows = [
    [t("frameInternals.tooltip.frequencyRange"), band.range],
    [t("frameInternals.tooltip.estimatedBytes"), formatBytes(band.estimatedBytes)],
    [t("frameInternals.tooltip.relativeShare"), formatMetricNumber(band.ratio * 100, 1) + "%"],
    [t("frameInternals.tooltip.accuracy"), t("frameInternals.tooltip.nominalEstimate")]
  ];
  return '<div class="audio-band-row"' +
    renderFrameInternalsTooltipAttributes({
      title: band.label,
      rows: tooltipRows,
      note: t("frameInternals.audioEstimateNote")
    }) +
    '>' +
    '<div class="audio-band-label">' + escapeHtml(band.label) + '<br><small>' + escapeHtml(band.range) + '</small></div>' +
    '<div class="audio-band-bar"><span class="audio-band-fill" style="width:' + widthPercent.toFixed(3) + '%;--band-alpha:' + band.intensity.toFixed(3) + '"></span></div>' +
    '<div class="audio-band-size">' + escapeHtml(formatBytes(band.estimatedBytes)) + '</div>' +
    '</div>';
}

export function renderFrameInternalsTooltipAttributes(payload) {
  const rows = Array.isArray(payload.rows)
    ? payload.rows.filter((row) => row && row[0] !== undefined && row[1] !== undefined)
    : [];
  const normalizedPayload = {
    title: String(payload.title || ""),
    rows: rows.map(([label, value]) => [String(label), String(value)]),
    note: String(payload.note || "")
  };
  const accessibleLabel = [
    normalizedPayload.title,
    ...normalizedPayload.rows.map(([label, value]) => label + ": " + value),
    normalizedPayload.note
  ].filter(Boolean).join(". ");
  return ' data-inspection-tooltip="' + escapeHtml(JSON.stringify(normalizedPayload)) + '"' +
    ' aria-label="' + escapeHtml(accessibleLabel) + '"';
}

export function renderFrameInternalsTooltip(payload) {
  const rows = payload.rows.map((row) => {
    const label = row && row[0] !== undefined ? String(row[0]) : "";
    const value = row && row[1] !== undefined ? String(row[1]) : "";
    if (!label || !value) return "";
    return '<div class="tooltip-row"><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(value) + '</strong></div>';
  }).join("");
  return '<div class="tooltip-title">' + escapeHtml(payload.title) + '</div>' +
    '<div class="tooltip-rows">' + rows + '</div>' +
    (payload.note ? '<div class="tooltip-note">' + escapeHtml(payload.note) + '</div>' : "");
}

function renderFrameInternalsStats(stats) {
  return '<div class="frame-internals-stats">' + stats.map(([label, value]) =>
    '<div class="frame-internals-stat"><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(String(value)) + '</strong></div>'
  ).join("") + '</div>';
}

export function formatFrameTypeLabel(type) {
  if (type === "unknown") return t("value.unknown");
  if (type === "audio") return t("value.audio");
  if (type === "sample") return t("value.sample");
  if (String(type).startsWith("mixed") && getLanguage() === "ko") return type.replace("mixed", "혼합");
  return type;
}

function formatAudioFrequency(value) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue <= 0) return t("value.notAvailable");
  return numberValue >= 1000 ? formatMetricNumber(numberValue / 1000, 1) + " kHz" : formatMetricNumber(numberValue, 0) + " Hz";
}
