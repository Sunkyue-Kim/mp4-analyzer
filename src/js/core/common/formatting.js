import { t } from "../../i18n/catalogs.js";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function formatBytes(value) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return String(value);
  const units = ["B", "KB", "MB", "GB", "TB"];
  let current = numberValue;
  let unitIndex = 0;
  while (current >= 1024 && unitIndex < units.length - 1) {
    current /= 1024;
    unitIndex += 1;
  }
  return (unitIndex === 0 ? current.toFixed(0) : current.toFixed(2)) + " " + units[unitIndex];
}

function formatBitsPerSecond(value) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return t("value.notAvailable");
  const units = ["bps", "Kbps", "Mbps", "Gbps"];
  let current = numberValue;
  let unitIndex = 0;
  while (current >= 1000 && unitIndex < units.length - 1) {
    current /= 1000;
    unitIndex += 1;
  }
  return (unitIndex === 0 ? current.toFixed(0) : current.toFixed(2)) + " " + units[unitIndex];
}

function formatPreviewBitrate(value) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue <= 0) return "";
  if (numberValue < 10_000_000) return formatSignificantDigits(numberValue / 1000, 4) + " kbps";
  return formatSignificantDigits(numberValue / 1_000_000, 4) + " Mbps";
}

function formatSignificantDigits(value, significantDigits) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue === 0) return "0";
  const decimals = Math.max(0, significantDigits - Math.floor(Math.log10(Math.abs(numberValue))) - 1);
  return numberValue.toFixed(Math.min(3, decimals));
}

function formatMetricNumber(value, digits) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return t("value.notAvailable");
  return numberValue.toFixed(digits);
}

function formatTime(value, timescale) {
  if (!timescale) return String(value);
  const seconds = Number(value) / Number(timescale);
  if (!Number.isFinite(seconds)) return String(value);
  return seconds.toFixed(6) + "s";
}

export {
  clamp,
  formatBytes,
  formatBitsPerSecond,
  formatPreviewBitrate,
  formatMetricNumber,
  formatTime
};
