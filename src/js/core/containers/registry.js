import { readResourcePrefix } from "../common/binary.js";

const CONTAINER_DESCRIPTORS = [
  {
    id: "webm",
    label: "WebM / Matroska",
    loadAnalyzer: () => import("./webm/analyzer.js").then((module) => module.webmContainer),
    matches(file, header) {
      return hasExtension(file, ".webm") || file.type === "video/webm" || file.type === "audio/webm" ||
        startsWithBytes(header, [0x1a, 0x45, 0xdf, 0xa3]);
    }
  },
  {
    id: "ogg-opus",
    label: "Ogg Opus",
    loadAnalyzer: () => import("./ogg/analyzer.js").then((module) => module.oggOpusContainer),
    matches(file, header) {
      return hasExtension(file, ".opus") || file.type === "audio/ogg" || file.type === "audio/opus" ||
        startsWithText(header, "OggS");
    }
  },
  {
    id: "mp3",
    label: "MP3 / MPEG Audio",
    loadAnalyzer: () => import("./mp3/analyzer.js").then((module) => module.mp3Container),
    matches(file, header) {
      return hasExtension(file, ".mp3") || file.type === "audio/mpeg" || file.type === "audio/mp3" ||
        startsWithText(header, "ID3") || looksLikeMp3Frame(header);
    }
  },
  {
    id: "isobmff",
    label: "ISO BMFF / MP4",
    loadAnalyzer: () => import("./isobmff/analyzer.js").then((module) => module.isoBmffContainer),
    matches(file, header) {
      return hasExtension(file, ".mp4") || hasExtension(file, ".m4v") || hasExtension(file, ".mov") ||
        file.type === "video/mp4" || file.type === "video/quicktime" ||
        hasIsoBmffBoxSignature(header);
    }
  }
];

const analyzerPromises = new Map();

export const CONTAINER_ANALYZERS = CONTAINER_DESCRIPTORS;

export async function analyzeFileWithRegisteredContainer(file, options) {
  const header = await readHeader(file);
  const descriptors = getCandidateContainerDescriptors(file, header);
  for (const descriptor of descriptors) {
    const analyzer = await loadContainerAnalyzer(descriptor);
    if (await analyzer.canAnalyze(file, options)) {
      const analysis = await analyzer.analyzeFile(file, options);
      analysis.container = { id: analyzer.id, label: analyzer.label };
      return analysis;
    }
  }
  throw new Error("No registered container analyzer accepted this file.");
}

export function getCandidateContainerDescriptors(file, header = new Uint8Array()) {
  const matched = CONTAINER_DESCRIPTORS.filter((descriptor) => descriptor.matches(file, header));
  return matched.length ? matched : CONTAINER_DESCRIPTORS;
}

async function loadContainerAnalyzer(descriptor) {
  if (!analyzerPromises.has(descriptor.id)) {
    analyzerPromises.set(descriptor.id, descriptor.loadAnalyzer());
  }
  return analyzerPromises.get(descriptor.id);
}

async function readHeader(file) {
  return readResourcePrefix(file, 64);
}

function hasExtension(file, extension) {
  return String(file && file.name || "").toLowerCase().endsWith(extension);
}

function startsWithText(bytes, text) {
  if (!bytes || bytes.byteLength < text.length) return false;
  for (let index = 0; index < text.length; index += 1) {
    if (bytes[index] !== text.charCodeAt(index)) return false;
  }
  return true;
}

function startsWithBytes(bytes, expectedBytes) {
  if (!bytes || bytes.byteLength < expectedBytes.length) return false;
  for (let index = 0; index < expectedBytes.length; index += 1) {
    if (bytes[index] !== expectedBytes[index]) return false;
  }
  return true;
}

function looksLikeMp3Frame(bytes) {
  return Boolean(bytes && bytes.byteLength >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);
}

function hasIsoBmffBoxSignature(bytes) {
  if (!bytes || bytes.byteLength < 8) return false;
  const boxType = String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]);
  return new Set(["ftyp", "moov", "mdat", "free", "skip", "wide", "uuid"]).has(boxType);
}
