import {
  getCodecBySampleEntryType,
  loadCodecImplementation
} from "./registry.js";

const MAX_FRAME_INTERNALS_SAMPLE_BYTES = 32 * 1024 * 1024;

function findTrackForSample(analysis, sampleRow) {
  if (!analysis || !sampleRow || !Array.isArray(analysis.tracks)) return null;
  return analysis.tracks.find((track) => String(track.trackId) === String(sampleRow.trackId)) || null;
}

function createUnavailableResult(track, reason, details = {}) {
  return {
    kind: "unavailable",
    complete: false,
    codec: track && track.codec || "unknown",
    codecFamily: details.codecFamily || track && track.codec || "unknown",
    reason,
    warnings: Array.isArray(details.warnings) ? details.warnings : []
  };
}

async function readSampleBytes(analysis, sampleRow) {
  if (!analysis || !analysis.reader || typeof analysis.reader.readRange !== "function") {
    throw new Error("The active analysis does not expose a range reader.");
  }
  const offset = BigInt(sampleRow.offset);
  const size = BigInt(sampleRow.size);
  if (offset < 0n || size < 0n) throw new Error("Sample offset and size must be non-negative.");
  if (size > BigInt(MAX_FRAME_INTERNALS_SAMPLE_BYTES)) {
    throw new Error("Selected sample exceeds the 32 MiB frame-internals safety limit.");
  }
  if (typeof analysis.reader.readExactRange === "function") {
    const bytes = await analysis.reader.readExactRange(offset, size);
    if (BigInt(bytes.byteLength) !== size) {
      throw new Error("Sample range is truncated: expected " + size.toString() + " bytes, got " + bytes.byteLength + ".");
    }
    return bytes;
  }
  const bytes = await analysis.reader.readRange(offset, size);
  if (BigInt(bytes.byteLength) !== size) {
    throw new Error("Sample range is truncated: expected " + size.toString() + " bytes, got " + bytes.byteLength + ".");
  }
  return bytes;
}

async function analyzeFrameInternals(analysis, sampleRow) {
  const track = findTrackForSample(analysis, sampleRow);
  if (!track) return createUnavailableResult(null, "The selected sample track is unavailable.");
  if (track.handlerType !== "vide") {
    return createUnavailableResult(track, "Block structure applies to video coding tracks only.");
  }
  const codecDescriptor = getCodecBySampleEntryType(track.codec);
  if (!codecDescriptor) {
    return createUnavailableResult(track, "No native JavaScript block-syntax parser is registered for this codec.");
  }
  const implementation = await loadCodecImplementation(codecDescriptor);
  if (!implementation || typeof implementation.parseFrameInternals !== "function") {
    return createUnavailableResult(track, "The native JavaScript block-syntax parser is not implemented for this codec.", {
      codecFamily: codecDescriptor.label
    });
  }
  try {
    const sampleBytes = await readSampleBytes(analysis, sampleRow);
    const result = await implementation.parseFrameInternals(sampleBytes, track.codecConfig || null, track);
    if (!result || result.complete !== true) {
      return {
        ...createUnavailableResult(track, result && result.reason || "The frame uses syntax that this parser cannot traverse exactly.", {
          codecFamily: codecDescriptor.label,
          warnings: result && result.warnings
        }),
        ...(result || {})
      };
    }
    return {
      ...result,
      complete: true,
      codec: track.codec,
      codecFamily: result.codecFamily || codecDescriptor.label,
      sampleBits: sampleBytes.byteLength * 8
    };
  } catch (error) {
    return createUnavailableResult(track, error && error.message ? error.message : String(error), {
      codecFamily: codecDescriptor.label
    });
  }
}

export {
  MAX_FRAME_INTERNALS_SAMPLE_BYTES,
  analyzeFrameInternals,
  createUnavailableResult,
  findTrackForSample,
  readSampleBytes
};
