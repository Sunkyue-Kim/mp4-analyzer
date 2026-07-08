import { t } from "../i18n/catalogs.js";

const CACHE_CHUNK_BYTES = 4 * 1024 * 1024;
const MAX_CACHE_BYTES = 64 * 1024 * 1024;
const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const ROW_HEIGHT = 32;
const GRAPH_ROW_HEIGHT = 30;
const METRIC_CHART_WIDTH = 1000;
const METRIC_CHART_HEIGHT = 230;
const METRIC_CHART_PADDING = { left: 64, right: 22, top: 18, bottom: 30 };

const CONTAINER_BOXES = new Set([
  "moov", "trak", "mdia", "minf", "stbl", "edts", "dinf", "mvex", "moof", "traf",
  "mfra", "udta", "ilst", "tref", "ipro", "sinf", "schi"
]);

const FULLBOX_CONTAINER_OFFSETS = new Map([
  ["meta", 4]
]);

const PARSED_FIELD_BOXES = new Set([
  "ftyp", "mvhd", "tkhd", "mdhd", "hdlr", "stsd", "stts", "ctts", "stss", "stsc",
  "stsz", "stz2", "stco", "co64", "trex", "mfhd", "tfhd", "tfdt", "trun"
]);

const VIDEO_SAMPLE_ENTRIES = new Set([
  "avc1", "avc2", "avc3", "avc4", "hvc1", "hev1", "av01", "encv", "mp4v",
  "ap4h", "ap4x", "apch", "apcn", "apcs", "apco", "aprn", "aprh"
]);
const AUDIO_SAMPLE_ENTRIES = new Set(["mp4a", "enca", "ac-3", "ec-3", "Opus", "alac"]);
const AUDIO_SAMPLE_RATES = [
  96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050,
  16000, 12000, 11025, 8000, 7350
];
const AUDIO_OBJECT_TYPE_NAMES = {
  1: "AAC Main",
  2: "AAC LC",
  3: "AAC SSR",
  4: "AAC LTP",
  5: "SBR",
  6: "AAC Scalable",
  17: "ER AAC LC",
  29: "PS",
  42: "USAC"
};
const HEVC_IRAP_NAL_TYPES = new Set([16, 17, 18, 19, 20, 21, 22, 23]);
const BOX_TYPE_INFO = {
  ftyp: {
    name: "File Type Box",
    description: "Declares the MP4/QuickTime brand, minor version, and compatible brands."
  },
  moov: {
    name: "Movie Box",
    description: "Top-level metadata container for tracks, timing, and sample tables."
  },
  mdat: {
    name: "Media Data Box",
    description: "Contains encoded media payload bytes referenced by sample tables."
  },
  free: {
    name: "Free Space Box",
    description: "Padding or reserved bytes that can be overwritten later."
  },
  skip: {
    name: "Skip Box",
    description: "Padding or ignored bytes, similar to free."
  },
  wide: {
    name: "Wide Box",
    description: "Legacy QuickTime padding used to reserve space for large-size boxes."
  },
  uuid: {
    name: "UUID Box",
    description: "Vendor-specific extension box identified by a 16-byte UUID."
  },
  trak: {
    name: "Track Box",
    description: "Container for one media track, such as video, audio, or subtitles."
  },
  tkhd: {
    name: "Track Header Box",
    description: "Track-level ID, duration, dimensions, layer, and display metadata."
  },
  edts: {
    name: "Edit Box",
    description: "Container for edit-list timing adjustments."
  },
  elst: {
    name: "Edit List Box",
    description: "Maps presentation timeline segments to media timeline ranges."
  },
  mdia: {
    name: "Media Box",
    description: "Container for media timing, handler, and media information."
  },
  mdhd: {
    name: "Media Header Box",
    description: "Track media timescale, duration, and language."
  },
  hdlr: {
    name: "Handler Reference Box",
    description: "Declares the track handler type, such as vide or soun."
  },
  minf: {
    name: "Media Information Box",
    description: "Container for media-specific header, data references, and sample table."
  },
  vmhd: {
    name: "Video Media Header Box",
    description: "Video-track presentation metadata such as graphics mode."
  },
  smhd: {
    name: "Sound Media Header Box",
    description: "Audio-track presentation metadata such as balance."
  },
  hmhd: {
    name: "Hint Media Header Box",
    description: "Hint-track metadata for streaming."
  },
  nmhd: {
    name: "Null Media Header Box",
    description: "Generic media header for tracks without a specialized media header."
  },
  dinf: {
    name: "Data Information Box",
    description: "Container describing where media data is located."
  },
  dref: {
    name: "Data Reference Box",
    description: "Lists data references used by sample entries."
  },
  url: {
    name: "Data Entry URL Box",
    description: "A URL data reference, often self-contained in MP4 files."
  },
  urn: {
    name: "Data Entry URN Box",
    description: "A URN data reference for media data."
  },
  stbl: {
    name: "Sample Table Box",
    description: "Container for tables that map samples to timing, sizes, chunks, and offsets."
  },
  stsd: {
    name: "Sample Description Box",
    description: "Declares codec sample entries and codec configuration boxes."
  },
  stts: {
    name: "Decoding Time to Sample Box",
    description: "Maps samples to decode durations and DTS progression."
  },
  ctts: {
    name: "Composition Time to Sample Box",
    description: "Stores PTS offsets relative to DTS for reordered frames."
  },
  stsc: {
    name: "Sample to Chunk Box",
    description: "Maps sample runs to chunk numbers and samples-per-chunk."
  },
  stsz: {
    name: "Sample Size Box",
    description: "Stores per-sample byte sizes or one constant sample size."
  },
  stz2: {
    name: "Compact Sample Size Box",
    description: "Stores compact 4/8/16-bit per-sample sizes."
  },
  stco: {
    name: "Chunk Offset Box",
    description: "Stores 32-bit file offsets for media data chunks."
  },
  co64: {
    name: "64-bit Chunk Offset Box",
    description: "Stores 64-bit file offsets for media data chunks."
  },
  stss: {
    name: "Sync Sample Box",
    description: "Lists random-access sync samples, usually keyframes."
  },
  stsh: {
    name: "Shadow Sync Sample Box",
    description: "Maps non-sync samples to shadow sync samples."
  },
  sdtp: {
    name: "Sample Dependency Type Box",
    description: "Stores per-sample dependency flags for random access and prediction."
  },
  sbgp: {
    name: "Sample to Group Box",
    description: "Maps sample ranges to sample groups."
  },
  sgpd: {
    name: "Sample Group Description Box",
    description: "Describes sample groups referenced by sbgp."
  },
  saiz: {
    name: "Sample Auxiliary Information Sizes Box",
    description: "Stores sizes for auxiliary per-sample information."
  },
  saio: {
    name: "Sample Auxiliary Information Offsets Box",
    description: "Stores offsets for auxiliary per-sample information."
  },
  mvhd: {
    name: "Movie Header Box",
    description: "Movie-level timescale, duration, rate, volume, and next track ID."
  },
  mvex: {
    name: "Movie Extends Box",
    description: "Declares that the file uses movie fragments and default fragment settings."
  },
  mehd: {
    name: "Movie Extends Header Box",
    description: "Stores overall fragmented movie duration."
  },
  trex: {
    name: "Track Extends Box",
    description: "Default sample description, duration, size, and flags for fragments."
  },
  moof: {
    name: "Movie Fragment Box",
    description: "Container for one fragmented MP4 fragment's track runs."
  },
  mfhd: {
    name: "Movie Fragment Header Box",
    description: "Fragment sequence number."
  },
  traf: {
    name: "Track Fragment Box",
    description: "Container for one track's fragment metadata and sample runs."
  },
  tfhd: {
    name: "Track Fragment Header Box",
    description: "Track ID and default sample values for following trun boxes."
  },
  tfdt: {
    name: "Track Fragment Decode Time Box",
    description: "Base decode time for the first sample in a track fragment."
  },
  trun: {
    name: "Track Run Box",
    description: "Per-sample duration, size, flags, composition offsets, and data offset in fragments."
  },
  mfra: {
    name: "Movie Fragment Random Access Box",
    description: "Container for random-access indices into movie fragments."
  },
  tfra: {
    name: "Track Fragment Random Access Box",
    description: "Random-access entries for one track in fragmented media."
  },
  mfro: {
    name: "Movie Fragment Random Access Offset Box",
    description: "Stores the size of the mfra box for backward lookup."
  },
  meta: {
    name: "Metadata Box",
    description: "Container for timed or file-level metadata."
  },
  ilst: {
    name: "Item List Box",
    description: "QuickTime/iTunes metadata item list."
  },
  udta: {
    name: "User Data Box",
    description: "Container for user data and metadata."
  },
  tref: {
    name: "Track Reference Box",
    description: "Container for references between tracks."
  },
  sinf: {
    name: "Protection Scheme Information Box",
    description: "Container for encryption or protection scheme metadata."
  },
  frma: {
    name: "Original Format Box",
    description: "Stores the original unprotected sample entry format."
  },
  schm: {
    name: "Scheme Type Box",
    description: "Identifies the protection or restricted scheme."
  },
  schi: {
    name: "Scheme Information Box",
    description: "Container for scheme-specific protection information."
  },
  avcC: {
    name: "AVC Configuration Box",
    description: "H.264/AVC decoder configuration including profile, level, SPS/PPS, and NAL length size."
  },
  hvcC: {
    name: "HEVC Configuration Box",
    description: "H.265/HEVC decoder configuration including profile, level, VPS/SPS/PPS, and NAL length size."
  },
  esds: {
    name: "Elementary Stream Descriptor Box",
    description: "MPEG-4 descriptors, commonly carrying AAC AudioSpecificConfig for mp4a tracks."
  },
  pasp: {
    name: "Pixel Aspect Ratio Box",
    description: "Horizontal and vertical pixel aspect ratio spacing."
  },
  colr: {
    name: "Colour Information Box",
    description: "Color primaries, transfer characteristics, matrix coefficients, or ICC profile."
  },
  clap: {
    name: "Clean Aperture Box",
    description: "Clean aperture dimensions and offsets for display cropping."
  },
  btrt: {
    name: "Bitrate Box",
    description: "Buffer size, maximum bitrate, and average bitrate hints."
  },
  avc1: {
    name: "AVC Sample Entry",
    description: "H.264/AVC video sample entry using avcC codec configuration."
  },
  avc3: {
    name: "AVC3 Sample Entry",
    description: "H.264/AVC video sample entry where parameter sets may appear in samples."
  },
  hvc1: {
    name: "HEVC Sample Entry",
    description: "H.265/HEVC video sample entry using hvcC codec configuration."
  },
  hev1: {
    name: "HEV1 Sample Entry",
    description: "H.265/HEVC sample entry where parameter sets may appear in samples."
  },
  mp4a: {
    name: "MPEG-4 Audio Sample Entry",
    description: "Audio sample entry, commonly AAC with esds decoder configuration."
  },
  ap4h: {
    name: "Apple ProRes 4444 Sample Entry",
    description: "Apple ProRes 4444 video sample entry."
  }
};

function toBig(value) {
  return typeof value === "bigint" ? value : BigInt(value);
}

function toSafeNumber(value, context) {
  const bigValue = toBig(value);
  if (bigValue > MAX_SAFE_BIGINT) {
    throw new Error(context + " is too large for browser File.slice(): " + bigValue.toString());
  }
  return Number(bigValue);
}

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

function hexByte(value) {
  return value.toString(16).padStart(2, "0");
}

function fourCcFromBytes(bytes, offset) {
  return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
}

function safeJsonReplacer(key, value) {
  if (typeof value === "bigint") return value.toString();
  if (key.endsWith("Big")) return undefined;
  return value;
}

class ByteCursor {
  constructor(bytes) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  get length() {
    return this.bytes.byteLength;
  }

  ensure(offset, size) {
    return offset >= 0 && offset + size <= this.length;
  }

  uint8(offset) {
    if (!this.ensure(offset, 1)) throw new Error("Unexpected EOF at " + offset);
    return this.view.getUint8(offset);
  }

  uint16(offset) {
    if (!this.ensure(offset, 2)) throw new Error("Unexpected EOF at " + offset);
    return this.view.getUint16(offset, false);
  }

  int32(offset) {
    if (!this.ensure(offset, 4)) throw new Error("Unexpected EOF at " + offset);
    return this.view.getInt32(offset, false);
  }

  uint32(offset) {
    if (!this.ensure(offset, 4)) throw new Error("Unexpected EOF at " + offset);
    return this.view.getUint32(offset, false);
  }

  uint64(offset) {
    const high = this.uint32(offset);
    const low = this.uint32(offset + 4);
    return (BigInt(high) << 32n) + BigInt(low);
  }

  string(offset, length) {
    if (!this.ensure(offset, length)) throw new Error("Unexpected EOF at " + offset);
    let result = "";
    for (let index = 0; index < length; index += 1) {
      const byte = this.bytes[offset + index];
      if (byte === 0) break;
      result += String.fromCharCode(byte);
    }
    return result;
  }

  bytesAt(offset, length) {
    if (!this.ensure(offset, length)) throw new Error("Unexpected EOF at " + offset);
    return this.bytes.subarray(offset, offset + length);
  }
}

function readFullBoxHeader(cursor) {
  return {
    version: cursor.uint8(0),
    flags: (cursor.uint8(1) << 16) | (cursor.uint8(2) << 8) | cursor.uint8(3)
  };
}

class BlobRangeReader {
  constructor(file) {
    this.file = file;
    this.cache = new Map();
    this.cacheBytes = 0;
    this.cancelled = false;
  }

  cancel() {
    this.cancelled = true;
  }

  async readRange(offsetBig, lengthBig) {
    if (this.cancelled) throw new Error("Analysis cancelled.");
    const offset = toSafeNumber(offsetBig, "offset");
    const length = toSafeNumber(lengthBig, "length");
    if (length <= 0) return new Uint8Array(0);
    const result = new Uint8Array(length);
    let written = 0;
    let cursor = offset;
    const end = offset + length;
    while (cursor < end) {
      if (this.cancelled) throw new Error("Analysis cancelled.");
      const chunkIndex = Math.floor(cursor / CACHE_CHUNK_BYTES);
      const chunkStart = chunkIndex * CACHE_CHUNK_BYTES;
      const chunk = await this.readChunk(chunkIndex);
      const localStart = cursor - chunkStart;
      const copyLength = Math.min(chunk.byteLength - localStart, end - cursor);
      result.set(chunk.subarray(localStart, localStart + copyLength), written);
      written += copyLength;
      cursor += copyLength;
    }
    return result;
  }

  async readChunk(chunkIndex) {
    const cached = this.cache.get(chunkIndex);
    if (cached) {
      this.cache.delete(chunkIndex);
      this.cache.set(chunkIndex, cached);
      return cached.bytes;
    }
    const chunkStart = chunkIndex * CACHE_CHUNK_BYTES;
    const chunkEnd = Math.min(chunkStart + CACHE_CHUNK_BYTES, this.file.size);
    const buffer = await this.file.slice(chunkStart, chunkEnd).arrayBuffer();
    const bytes = new Uint8Array(buffer);
    this.cache.set(chunkIndex, { bytes, size: bytes.byteLength });
    this.cacheBytes += bytes.byteLength;
    this.evict();
    return bytes;
  }

  evict() {
    while (this.cacheBytes > MAX_CACHE_BYTES && this.cache.size > 1) {
      const firstKey = this.cache.keys().next().value;
      const item = this.cache.get(firstKey);
      this.cache.delete(firstKey);
      this.cacheBytes -= item.size;
    }
  }
}

async function readBoxPayload(reader, node, maxBytes) {
  const payloadSize = node.sizeBig - BigInt(node.headerSize);
  if (payloadSize < 0n) throw new Error("Invalid payload size for " + node.path);
  if (maxBytes && payloadSize > BigInt(maxBytes)) {
    node.warnings.push("Payload too large to parse inline: " + payloadSize.toString() + " bytes.");
    return null;
  }
  return reader.readRange(node.offsetBig + BigInt(node.headerSize), payloadSize);
}

async function parseBoxes(reader, startBig, endBig, parentPath, depth, warnings, progress) {
  const nodes = [];
  let offset = startBig;
  let guard = 0;
  while (offset + 8n <= endBig) {
    if (reader.cancelled) throw new Error("Analysis cancelled.");
    guard += 1;
    if (guard > 100000) {
      warnings.push("Stopped parsing " + parentPath + " after 100000 boxes.");
      break;
    }
    const remaining = endBig - offset;
    const headerProbe = await reader.readRange(offset, remaining < 32n ? remaining : 32n);
    if (headerProbe.byteLength < 8) break;
    const cursor = new ByteCursor(headerProbe);
    const size32 = cursor.uint32(0);
    const type = cursor.string(4, 4);
    let headerSize = 8;
    let boxSizeBig = BigInt(size32);
    if (size32 === 1) {
      if (headerProbe.byteLength < 16) {
        warnings.push("Truncated large-size box header at " + offset.toString());
        break;
      }
      boxSizeBig = cursor.uint64(8);
      headerSize = 16;
    } else if (size32 === 0) {
      boxSizeBig = endBig - offset;
    }
    if (type === "uuid") headerSize += 16;
    if (boxSizeBig < BigInt(headerSize)) {
      warnings.push("Invalid size for box " + type + " at " + offset.toString());
      break;
    }
    let boxEnd = offset + boxSizeBig;
    const nodeWarnings = [];
    if (boxEnd > endBig) {
      nodeWarnings.push("Box exceeds parent bounds. Clamped for parsing.");
      boxEnd = endBig;
    }
    const path = parentPath ? parentPath + "/" + type + "[" + nodes.length + "]" : type + "[" + nodes.length + "]";
    const node = {
      type,
      path,
      offset: offset.toString(),
      offsetBig: offset,
      size: boxSizeBig.toString(),
      sizeBig: boxSizeBig,
      headerSize,
      children: [],
      fields: {},
      warnings: nodeWarnings
    };
    await parseKnownBoxFields(reader, node);
    const containerSkip = FULLBOX_CONTAINER_OFFSETS.get(type) || 0;
    const childStart = offset + BigInt(headerSize + containerSkip);
    if ((CONTAINER_BOXES.has(type) || FULLBOX_CONTAINER_OFFSETS.has(type)) && depth < 24 && childStart < boxEnd) {
      node.children = await parseBoxes(reader, childStart, boxEnd, path, depth + 1, warnings, progress);
    }
    nodes.push(node);
    if (progress && depth === 0) progress("Parsing boxes", Number(offset * 100n / endBig));
    if (boxSizeBig === 0n) break;
    offset = offset + boxSizeBig;
  }
  return nodes;
}

async function parseKnownBoxFields(reader, node) {
  if (node.type === "mdat") {
    node.fields.dataStart = (node.offsetBig + BigInt(node.headerSize)).toString();
    node.fields.dataSize = (node.sizeBig - BigInt(node.headerSize)).toString();
    return;
  }
  if (!PARSED_FIELD_BOXES.has(node.type)) return;
  const smallBoxMax = 128 * 1024 * 1024;
  const payload = await readBoxPayload(reader, node, smallBoxMax);
  if (!payload) return;
  const cursor = new ByteCursor(payload);
  try {
    if (node.type === "ftyp") parseFtyp(cursor, node);
    else if (node.type === "mvhd") parseMvhd(cursor, node);
    else if (node.type === "tkhd") parseTkhd(cursor, node);
    else if (node.type === "mdhd") parseMdhd(cursor, node);
    else if (node.type === "hdlr") parseHdlr(cursor, node);
    else if (node.type === "stsd") parseStsd(cursor, node);
    else if (node.type === "stts") parseStts(cursor, node);
    else if (node.type === "ctts") parseCtts(cursor, node);
    else if (node.type === "stss") parseStss(cursor, node);
    else if (node.type === "stsc") parseStsc(cursor, node);
    else if (node.type === "stsz") parseStsz(cursor, node);
    else if (node.type === "stz2") parseStz2(cursor, node);
    else if (node.type === "stco") parseStco(cursor, node, false);
    else if (node.type === "co64") parseStco(cursor, node, true);
    else if (node.type === "trex") parseTrex(cursor, node);
    else if (node.type === "mfhd") parseMfhd(cursor, node);
    else if (node.type === "tfhd") parseTfhd(cursor, node);
    else if (node.type === "tfdt") parseTfdt(cursor, node);
    else if (node.type === "trun") parseTrun(cursor, node);
  } catch (error) {
    node.warnings.push("Could not parse fields: " + error.message);
  }
}

function parseFtyp(cursor, node) {
  if (cursor.length < 8) return;
  const brands = [];
  for (let offset = 8; offset + 4 <= cursor.length; offset += 4) brands.push(cursor.string(offset, 4));
  node.fields = {
    majorBrand: cursor.string(0, 4),
    minorVersion: cursor.uint32(4),
    compatibleBrands: brands
  };
}

function parseMvhd(cursor, node) {
  const full = readFullBoxHeader(cursor);
  const timescale = full.version === 1 ? cursor.uint32(20) : cursor.uint32(12);
  const duration = full.version === 1 ? cursor.uint64(24).toString() : cursor.uint32(16).toString();
  node.fields = { version: full.version, flags: full.flags, timescale, duration };
}

function parseTkhd(cursor, node) {
  const full = readFullBoxHeader(cursor);
  const trackId = full.version === 1 ? cursor.uint32(20) : cursor.uint32(12);
  const duration = full.version === 1 ? cursor.uint64(28).toString() : cursor.uint32(20).toString();
  const widthRaw = cursor.uint32(cursor.length - 8);
  const heightRaw = cursor.uint32(cursor.length - 4);
  node.fields = {
    version: full.version,
    flags: full.flags,
    trackId,
    duration,
    width: widthRaw / 65536,
    height: heightRaw / 65536
  };
}

function parseMdhd(cursor, node) {
  const full = readFullBoxHeader(cursor);
  const timescale = full.version === 1 ? cursor.uint32(20) : cursor.uint32(12);
  const duration = full.version === 1 ? cursor.uint64(24).toString() : cursor.uint32(16).toString();
  const languageOffset = full.version === 1 ? 32 : 20;
  let language = "";
  if (cursor.ensure(languageOffset, 2)) {
    const packed = cursor.uint16(languageOffset);
    language = String.fromCharCode(((packed >> 10) & 31) + 0x60, ((packed >> 5) & 31) + 0x60, (packed & 31) + 0x60);
  }
  node.fields = { version: full.version, flags: full.flags, timescale, duration, language };
}

function parseHdlr(cursor, node) {
  const full = readFullBoxHeader(cursor);
  const handlerType = cursor.string(8, 4);
  const name = cursor.length > 24 ? cursor.string(24, cursor.length - 24) : "";
  node.fields = { version: full.version, flags: full.flags, handlerType, name };
}

function parseStsd(cursor, node) {
  const full = readFullBoxHeader(cursor);
  const entryCount = cursor.uint32(4);
  const entries = [];
  let offset = 8;
  for (let index = 0; index < entryCount && offset + 8 <= cursor.length; index += 1) {
    const entryStart = offset;
    const entrySize = cursor.uint32(offset);
    const format = cursor.string(offset + 4, 4);
    const entry = { index: index + 1, format, size: entrySize, boxes: [] };
    const entryEnd = Math.min(entryStart + entrySize, cursor.length);
    if (VIDEO_SAMPLE_ENTRIES.has(format) && entryStart + 86 <= entryEnd) {
      entry.dataReferenceIndex = cursor.uint16(entryStart + 14);
      entry.width = cursor.uint16(entryStart + 32);
      entry.height = cursor.uint16(entryStart + 34);
      entry.depth = cursor.uint16(entryStart + 82);
      parseSampleEntryChildren(cursor, entryStart + 86, entryEnd, entry);
    } else if (AUDIO_SAMPLE_ENTRIES.has(format) && entryStart + 36 <= entryEnd) {
      entry.dataReferenceIndex = cursor.uint16(entryStart + 14);
      entry.channelCount = cursor.uint16(entryStart + 24);
      entry.sampleSize = cursor.uint16(entryStart + 26);
      entry.sampleRate = cursor.uint32(entryStart + 32) / 65536;
      parseSampleEntryChildren(cursor, entryStart + 36, entryEnd, entry);
    } else {
      parseSampleEntryChildren(cursor, entryStart + 16, entryEnd, entry);
    }
    entries.push(entry);
    if (entrySize <= 0) break;
    offset += entrySize;
  }
  node.fields = { version: full.version, flags: full.flags, entryCount, entries };
}

function parseSampleEntryChildren(cursor, start, end, entry) {
  let offset = start;
  while (offset + 8 <= end) {
    const childSize = cursor.uint32(offset);
    const childType = cursor.string(offset + 4, 4);
    if (childSize < 8 || offset + childSize > end) break;
    const child = { type: childType, size: childSize };
    if (childType === "avcC") {
      child.fields = parseAvcC(cursor.bytesAt(offset + 8, childSize - 8));
      entry.avcConfig = child.fields;
    } else if (childType === "hvcC") {
      child.fields = parseHevcC(cursor.bytesAt(offset + 8, childSize - 8));
      entry.hevcConfig = child.fields;
    } else if (childType === "esds") {
      child.fields = parseEsds(cursor.bytesAt(offset + 8, childSize - 8));
      entry.audioConfig = child.fields.audioConfig || null;
      entry.esds = child.fields;
    } else if (childType === "pasp" && childSize >= 16) {
      child.fields = { hSpacing: cursor.uint32(offset + 8), vSpacing: cursor.uint32(offset + 12) };
    } else if (childType === "colr") {
      child.fields = { colorType: cursor.string(offset + 8, 4) };
    }
    entry.boxes.push(child);
    offset += childSize;
  }
}

function parseAvcC(bytes) {
  const cursor = new ByteCursor(bytes);
  if (cursor.length < 7) return { error: "avcC too short" };
  const profile = cursor.uint8(1);
  const compatibility = cursor.uint8(2);
  const level = cursor.uint8(3);
  const nalLengthSize = (cursor.uint8(4) & 0x03) + 1;
  const spsCount = cursor.uint8(5) & 0x1f;
  const sps = [];
  let offset = 6;
  for (let index = 0; index < spsCount && offset + 2 <= cursor.length; index += 1) {
    const length = cursor.uint16(offset);
    offset += 2;
    if (offset + length > cursor.length) break;
    sps.push({ length, previewHex: Array.from(cursor.bytesAt(offset, Math.min(length, 10))).map(hexByte).join("") });
    offset += length;
  }
  let ppsCount = 0;
  const pps = [];
  if (offset < cursor.length) {
    ppsCount = cursor.uint8(offset);
    offset += 1;
    for (let index = 0; index < ppsCount && offset + 2 <= cursor.length; index += 1) {
      const length = cursor.uint16(offset);
      offset += 2;
      if (offset + length > cursor.length) break;
      pps.push({ length, previewHex: Array.from(cursor.bytesAt(offset, Math.min(length, 10))).map(hexByte).join("") });
      offset += length;
    }
  }
  return {
    configurationVersion: cursor.uint8(0),
    profile,
    compatibility,
    level,
    codecString: "avc1." + hexByte(profile) + hexByte(compatibility) + hexByte(level),
    nalLengthSize,
    spsCount: sps.length,
    ppsCount: pps.length,
    sps,
    pps
  };
}

function parseHevcC(bytes) {
  const cursor = new ByteCursor(bytes);
  if (cursor.length < 23) return { error: "hvcC too short" };
  const profileTierByte = cursor.uint8(1);
  const generalProfileSpace = profileTierByte >> 6;
  const generalTierFlag = Boolean(profileTierByte & 0x20);
  const generalProfileIdc = profileTierByte & 0x1f;
  const generalProfileCompatibilityFlags = cursor.uint32(2);
  let constraintHex = "";
  for (let offset = 6; offset < 12; offset += 1) constraintHex += hexByte(cursor.uint8(offset));
  const generalLevelIdc = cursor.uint8(12);
  const minSpatialSegmentationIdc = cursor.uint16(13) & 0x0fff;
  const parallelismType = cursor.uint8(15) & 0x03;
  const chromaFormat = cursor.uint8(16) & 0x03;
  const bitDepthLuma = (cursor.uint8(17) & 0x07) + 8;
  const bitDepthChroma = (cursor.uint8(18) & 0x07) + 8;
  const averageFrameRate = cursor.uint16(19);
  const packed = cursor.uint8(21);
  const constantFrameRate = packed >> 6;
  const numTemporalLayers = (packed >> 3) & 0x07;
  const temporalIdNested = Boolean(packed & 0x04);
  const nalLengthSize = (packed & 0x03) + 1;
  const arrayCount = cursor.uint8(22);
  const arrays = [];
  let offset = 23;
  for (let arrayIndex = 0; arrayIndex < arrayCount && offset + 3 <= cursor.length; arrayIndex += 1) {
    const arrayHeader = cursor.uint8(offset);
    offset += 1;
    const arrayCompleteness = Boolean(arrayHeader & 0x80);
    const nalUnitType = arrayHeader & 0x3f;
    const nalUnitCount = cursor.uint16(offset);
    offset += 2;
    const nalUnits = [];
    for (let nalIndex = 0; nalIndex < nalUnitCount && offset + 2 <= cursor.length; nalIndex += 1) {
      const nalUnitLength = cursor.uint16(offset);
      offset += 2;
      if (offset + nalUnitLength > cursor.length) break;
      nalUnits.push({
        length: nalUnitLength,
        previewHex: Array.from(cursor.bytesAt(offset, Math.min(nalUnitLength, 12))).map(hexByte).join("")
      });
      offset += nalUnitLength;
    }
    arrays.push({ arrayCompleteness, nalUnitType, nalUnitTypeName: hevcNalTypeName(nalUnitType), nalUnitCount: nalUnits.length, nalUnits });
  }
  return {
    configurationVersion: cursor.uint8(0),
    codecString: "hvc1.profile" + generalProfileIdc + ".L" + generalLevelIdc,
    generalProfileSpace,
    generalTierFlag,
    generalProfileIdc,
    generalProfileCompatibilityFlags,
    generalConstraintIndicatorFlags: constraintHex,
    generalLevelIdc,
    minSpatialSegmentationIdc,
    parallelismType,
    chromaFormat,
    bitDepthLuma,
    bitDepthChroma,
    averageFrameRate,
    constantFrameRate,
    numTemporalLayers,
    temporalIdNested,
    nalLengthSize,
    arrayCount: arrays.length,
    arrays
  };
}

function parseEsds(bytes) {
  const cursor = new ByteCursor(bytes);
  if (cursor.length < 4) return { error: "esds too short" };
  const full = readFullBoxHeader(cursor);
  const descriptors = parseDescriptors(cursor, 4, cursor.length, 0);
  const decoderConfig = findDescriptor(descriptors, 0x04);
  const decoderSpecificInfo = findDescriptor(descriptors, 0x05);
  const audioConfig = decoderSpecificInfo ? parseAudioSpecificConfig(decoderSpecificInfo.bytes) : null;
  if (audioConfig && decoderConfig && decoderConfig.objectTypeIndication === 0x40) {
    audioConfig.codecString = "mp4a.40." + audioConfig.audioObjectType;
  }
  return {
    version: full.version,
    flags: full.flags,
    descriptors,
    objectTypeIndication: decoderConfig ? decoderConfig.objectTypeIndication : null,
    streamType: decoderConfig ? decoderConfig.streamType : null,
    bufferSizeDB: decoderConfig ? decoderConfig.bufferSizeDB : null,
    maxBitrate: decoderConfig ? decoderConfig.maxBitrate : null,
    avgBitrate: decoderConfig ? decoderConfig.avgBitrate : null,
    audioConfig
  };
}

function parseDescriptors(cursor, start, end, depth) {
  const descriptors = [];
  let offset = start;
  while (offset + 2 <= end && depth < 8) {
    const tag = cursor.uint8(offset);
    const sizeInfo = readDescriptorSize(cursor, offset + 1, end);
    if (!sizeInfo) break;
    const headerSize = 1 + sizeInfo.bytesRead;
    const dataStart = offset + headerSize;
    const dataEnd = dataStart + sizeInfo.size;
    if (dataEnd > end) break;
    const descriptor = {
      tag,
      tagName: descriptorTagName(tag),
      size: sizeInfo.size,
      bytes: Array.from(cursor.bytesAt(dataStart, sizeInfo.size))
    };
    parseDescriptorFields(cursor, descriptor, dataStart, dataEnd, depth);
    descriptors.push(descriptor);
    offset = dataEnd;
  }
  return descriptors;
}

function readDescriptorSize(cursor, offset, end) {
  let size = 0;
  let bytesRead = 0;
  while (offset + bytesRead < end && bytesRead < 4) {
    const byte = cursor.uint8(offset + bytesRead);
    size = (size << 7) | (byte & 0x7f);
    bytesRead += 1;
    if ((byte & 0x80) === 0) return { size, bytesRead };
  }
  return null;
}

function parseDescriptorFields(cursor, descriptor, start, end, depth) {
  if (descriptor.tag === 0x03 && start + 3 <= end) {
    descriptor.esId = cursor.uint16(start);
    const flags = cursor.uint8(start + 2);
    descriptor.flags = flags;
    let childStart = start + 3;
    if (flags & 0x80) childStart += 2;
    if (flags & 0x40 && childStart < end) childStart += 1 + cursor.uint8(childStart);
    if (flags & 0x20) childStart += 2;
    descriptor.children = parseDescriptors(cursor, childStart, end, depth + 1);
  } else if (descriptor.tag === 0x04 && start + 13 <= end) {
    descriptor.objectTypeIndication = cursor.uint8(start);
    descriptor.streamType = cursor.uint8(start + 1) >> 2;
    descriptor.upStream = Boolean(cursor.uint8(start + 1) & 0x02);
    descriptor.bufferSizeDB = (cursor.uint8(start + 2) << 16) | (cursor.uint8(start + 3) << 8) | cursor.uint8(start + 4);
    descriptor.maxBitrate = cursor.uint32(start + 5);
    descriptor.avgBitrate = cursor.uint32(start + 9);
    descriptor.children = parseDescriptors(cursor, start + 13, end, depth + 1);
  }
}

function findDescriptor(descriptors, tag) {
  for (const descriptor of descriptors || []) {
    if (descriptor.tag === tag) return descriptor;
    const found = findDescriptor(descriptor.children || [], tag);
    if (found) return found;
  }
  return null;
}

function descriptorTagName(tag) {
  const names = {
    0x03: "ES_Descriptor",
    0x04: "DecoderConfigDescriptor",
    0x05: "DecoderSpecificInfo",
    0x06: "SLConfigDescriptor"
  };
  return names[tag] || "Descriptor 0x" + tag.toString(16);
}

function parseAudioSpecificConfig(bytesLike) {
  const bytes = bytesLike instanceof Uint8Array ? bytesLike : new Uint8Array(bytesLike);
  const bitReader = new BitReader(bytes);
  let audioObjectType = readAudioObjectType(bitReader);
  let samplingFrequencyIndex = bitReader.readBits(4);
  let samplingFrequency = samplingFrequencyIndex === 0x0f ? bitReader.readBits(24) : AUDIO_SAMPLE_RATES[samplingFrequencyIndex] || null;
  const channelConfiguration = bitReader.readBits(4);
  let extensionAudioObjectType = null;
  let extensionSamplingFrequency = null;
  if (audioObjectType === 5 || audioObjectType === 29) {
    extensionAudioObjectType = audioObjectType;
    samplingFrequencyIndex = bitReader.readBits(4);
    extensionSamplingFrequency = samplingFrequencyIndex === 0x0f ? bitReader.readBits(24) : AUDIO_SAMPLE_RATES[samplingFrequencyIndex] || null;
    audioObjectType = readAudioObjectType(bitReader);
  }
  return {
    audioObjectType,
    audioObjectTypeName: AUDIO_OBJECT_TYPE_NAMES[audioObjectType] || "Audio object type " + audioObjectType,
    samplingFrequencyIndex,
    samplingFrequency,
    channelConfiguration,
    channelDescription: describeChannelConfiguration(channelConfiguration),
    extensionAudioObjectType,
    extensionSamplingFrequency
  };
}

function readAudioObjectType(bitReader) {
  const value = bitReader.readBits(5);
  return value === 31 ? 32 + bitReader.readBits(6) : value;
}

function describeChannelConfiguration(channelConfiguration) {
  const names = {
    0: "defined in program config element",
    1: "mono",
    2: "stereo",
    3: "3 channels",
    4: "4 channels",
    5: "5 channels",
    6: "5.1 channels",
    7: "7.1 channels"
  };
  return names[channelConfiguration] || channelConfiguration + " channels";
}

function parseStts(cursor, node) {
  const full = readFullBoxHeader(cursor);
  const entryCount = cursor.uint32(4);
  const entries = [];
  let offset = 8;
  for (let index = 0; index < entryCount && offset + 8 <= cursor.length; index += 1) {
    entries.push({ sampleCount: cursor.uint32(offset), sampleDelta: cursor.uint32(offset + 4) });
    offset += 8;
  }
  node.fields = { version: full.version, flags: full.flags, entryCount, entries };
}

function parseCtts(cursor, node) {
  const full = readFullBoxHeader(cursor);
  const entryCount = cursor.uint32(4);
  const entries = [];
  let offset = 8;
  for (let index = 0; index < entryCount && offset + 8 <= cursor.length; index += 1) {
    entries.push({
      sampleCount: cursor.uint32(offset),
      sampleOffset: full.version === 1 ? cursor.int32(offset + 4) : cursor.uint32(offset + 4)
    });
    offset += 8;
  }
  node.fields = { version: full.version, flags: full.flags, entryCount, entries };
}

function parseStss(cursor, node) {
  const full = readFullBoxHeader(cursor);
  const entryCount = cursor.uint32(4);
  const samples = [];
  let offset = 8;
  for (let index = 0; index < entryCount && offset + 4 <= cursor.length; index += 1) {
    samples.push(cursor.uint32(offset));
    offset += 4;
  }
  node.fields = { version: full.version, flags: full.flags, entryCount, samples };
}

function parseStsc(cursor, node) {
  const full = readFullBoxHeader(cursor);
  const entryCount = cursor.uint32(4);
  const entries = [];
  let offset = 8;
  for (let index = 0; index < entryCount && offset + 12 <= cursor.length; index += 1) {
    entries.push({
      firstChunk: cursor.uint32(offset),
      samplesPerChunk: cursor.uint32(offset + 4),
      sampleDescriptionIndex: cursor.uint32(offset + 8)
    });
    offset += 12;
  }
  node.fields = { version: full.version, flags: full.flags, entryCount, entries };
}

function parseStsz(cursor, node) {
  const full = readFullBoxHeader(cursor);
  const sampleSize = cursor.uint32(4);
  const sampleCount = cursor.uint32(8);
  const sizes = [];
  let offset = 12;
  if (sampleSize === 0) {
    for (let index = 0; index < sampleCount && offset + 4 <= cursor.length; index += 1) {
      sizes.push(cursor.uint32(offset));
      offset += 4;
    }
  }
  node.fields = { version: full.version, flags: full.flags, sampleSize, sampleCount, sizes };
}

function parseStz2(cursor, node) {
  const full = readFullBoxHeader(cursor);
  const fieldSize = cursor.uint8(7);
  const sampleCount = cursor.uint32(8);
  const sizes = [];
  let offset = 12;
  if (fieldSize === 4) {
    for (let index = 0; index < sampleCount && offset < cursor.length; index += 1) {
      const byte = cursor.uint8(offset);
      sizes.push(index % 2 === 0 ? byte >> 4 : byte & 0x0f);
      if (index % 2 === 1) offset += 1;
    }
  } else if (fieldSize === 8) {
    for (let index = 0; index < sampleCount && offset < cursor.length; index += 1) {
      sizes.push(cursor.uint8(offset));
      offset += 1;
    }
  } else if (fieldSize === 16) {
    for (let index = 0; index < sampleCount && offset + 2 <= cursor.length; index += 1) {
      sizes.push(cursor.uint16(offset));
      offset += 2;
    }
  }
  node.fields = { version: full.version, flags: full.flags, fieldSize, sampleCount, sizes };
}

function parseStco(cursor, node, isCo64) {
  const full = readFullBoxHeader(cursor);
  const entryCount = cursor.uint32(4);
  const offsets = [];
  let offset = 8;
  for (let index = 0; index < entryCount; index += 1) {
    if (isCo64) {
      if (offset + 8 > cursor.length) break;
      const value = cursor.uint64(offset);
      offsets.push(value <= MAX_SAFE_BIGINT ? Number(value) : value.toString());
      offset += 8;
    } else {
      if (offset + 4 > cursor.length) break;
      offsets.push(cursor.uint32(offset));
      offset += 4;
    }
  }
  node.fields = { version: full.version, flags: full.flags, entryCount, offsets };
}

function parseTrex(cursor, node) {
  const full = readFullBoxHeader(cursor);
  node.fields = {
    version: full.version,
    flags: full.flags,
    trackId: cursor.uint32(4),
    defaultSampleDescriptionIndex: cursor.uint32(8),
    defaultSampleDuration: cursor.uint32(12),
    defaultSampleSize: cursor.uint32(16),
    defaultSampleFlags: cursor.uint32(20)
  };
}

function parseMfhd(cursor, node) {
  const full = readFullBoxHeader(cursor);
  node.fields = { version: full.version, flags: full.flags, sequenceNumber: cursor.uint32(4) };
}

function parseTfhd(cursor, node) {
  const full = readFullBoxHeader(cursor);
  let offset = 8;
  const fields = { version: full.version, flags: full.flags, trackId: cursor.uint32(4) };
  if (full.flags & 0x000001) {
    fields.baseDataOffset = cursor.uint64(offset).toString();
    offset += 8;
  }
  if (full.flags & 0x000002) {
    fields.sampleDescriptionIndex = cursor.uint32(offset);
    offset += 4;
  }
  if (full.flags & 0x000008) {
    fields.defaultSampleDuration = cursor.uint32(offset);
    offset += 4;
  }
  if (full.flags & 0x000010) {
    fields.defaultSampleSize = cursor.uint32(offset);
    offset += 4;
  }
  if (full.flags & 0x000020) {
    fields.defaultSampleFlags = cursor.uint32(offset);
    offset += 4;
  }
  fields.durationIsEmpty = Boolean(full.flags & 0x010000);
  fields.defaultBaseIsMoof = Boolean(full.flags & 0x020000);
  node.fields = fields;
}

function parseTfdt(cursor, node) {
  const full = readFullBoxHeader(cursor);
  node.fields = {
    version: full.version,
    flags: full.flags,
    baseMediaDecodeTime: full.version === 1 ? cursor.uint64(4).toString() : cursor.uint32(4).toString()
  };
}

function parseTrun(cursor, node) {
  const full = readFullBoxHeader(cursor);
  const sampleCount = cursor.uint32(4);
  let offset = 8;
  const fields = { version: full.version, flags: full.flags, sampleCount, samples: [] };
  if (full.flags & 0x000001) {
    fields.dataOffset = cursor.int32(offset);
    offset += 4;
  }
  if (full.flags & 0x000004) {
    fields.firstSampleFlags = cursor.uint32(offset);
    offset += 4;
  }
  for (let index = 0; index < sampleCount && offset <= cursor.length; index += 1) {
    const sample = {};
    if (full.flags & 0x000100) {
      if (offset + 4 > cursor.length) break;
      sample.duration = cursor.uint32(offset);
      offset += 4;
    }
    if (full.flags & 0x000200) {
      if (offset + 4 > cursor.length) break;
      sample.size = cursor.uint32(offset);
      offset += 4;
    }
    if (full.flags & 0x000400) {
      if (offset + 4 > cursor.length) break;
      sample.flags = cursor.uint32(offset);
      offset += 4;
    }
    if (full.flags & 0x000800) {
      if (offset + 4 > cursor.length) break;
      sample.compositionTimeOffset = full.version === 1 ? cursor.int32(offset) : cursor.uint32(offset);
      offset += 4;
    }
    fields.samples.push(sample);
  }
  node.fields = fields;
}

function findDescendants(node, type, results) {
  if (node.type === type) results.push(node);
  for (const child of node.children || []) findDescendants(child, type, results);
  return results;
}

function findFirst(node, type) {
  if (!node) return null;
  if (node.type === type) return node;
  for (const child of node.children || []) {
    const found = findFirst(child, type);
    if (found) return found;
  }
  return null;
}

function findChild(node, type) {
  return (node.children || []).find((child) => child.type === type) || null;
}

function flattenBoxes(nodes, result) {
  for (const node of nodes) {
    result.push(node);
    flattenBoxes(node.children || [], result);
  }
  return result;
}

function buildTrackModels(topBoxes, warnings) {
  const moov = topBoxes.find((box) => box.type === "moov");
  if (!moov) {
    warnings.push("No moov box found. Fragment-only streams without init segment are not supported.");
    return [];
  }
  const trexByTrack = new Map();
  for (const trex of findDescendants(moov, "trex", [])) trexByTrack.set(trex.fields.trackId, trex.fields);
  const tracks = [];
  for (const trak of (moov.children || []).filter((child) => child.type === "trak")) {
    const tkhd = findFirst(trak, "tkhd");
    const mdhd = findFirst(trak, "mdhd");
    const hdlr = findFirst(trak, "hdlr");
    const stsd = findFirst(trak, "stsd");
    const trackId = tkhd ? tkhd.fields.trackId : tracks.length + 1;
    const sampleEntry = stsd && stsd.fields.entries.length ? stsd.fields.entries[0] : null;
    const codec = sampleEntry ? sampleEntry.format : "unknown";
    const track = {
      trackId,
      handlerType: hdlr ? hdlr.fields.handlerType : "unknown",
      codec,
      timescale: mdhd ? mdhd.fields.timescale : 0,
      duration: mdhd ? mdhd.fields.duration : "0",
      width: sampleEntry && sampleEntry.width ? sampleEntry.width : (tkhd ? tkhd.fields.width : 0),
      height: sampleEntry && sampleEntry.height ? sampleEntry.height : (tkhd ? tkhd.fields.height : 0),
      channelCount: sampleEntry && sampleEntry.channelCount ? sampleEntry.channelCount : 0,
      sampleRate: sampleEntry && sampleEntry.sampleRate ? sampleEntry.sampleRate : 0,
      sampleCount: 0,
      avcConfig: sampleEntry && sampleEntry.avcConfig ? sampleEntry.avcConfig : null,
      hevcConfig: sampleEntry && sampleEntry.hevcConfig ? sampleEntry.hevcConfig : null,
      audioConfig: sampleEntry && sampleEntry.audioConfig ? sampleEntry.audioConfig : null,
      esds: sampleEntry && sampleEntry.esds ? sampleEntry.esds : null,
      sampleEntry,
      trex: trexByTrack.get(trackId) || null,
      stbl: findFirst(trak, "stbl"),
      warnings: []
    };
    if ((codec === "avc1" || codec === "avc3") && !track.avcConfig) {
      track.warnings.push("AVC sample entry has no avcC box.");
    }
    if ((codec === "hvc1" || codec === "hev1") && !track.hevcConfig) {
      track.warnings.push("HEVC sample entry has no hvcC box.");
    }
    if (codec === "mp4a" && !track.audioConfig) {
      track.warnings.push("AAC sample entry has no esds AudioSpecificConfig.");
    }
    tracks.push(track);
  }
  return tracks;
}

function buildNormalSamples(tracks, warnings) {
  const rows = [];
  for (const track of tracks) {
    if (!track.stbl) continue;
    const stsz = findFirst(track.stbl, "stsz");
    const stz2 = findFirst(track.stbl, "stz2");
    const stsc = findFirst(track.stbl, "stsc");
    const stco = findFirst(track.stbl, "stco") || findFirst(track.stbl, "co64");
    const stts = findFirst(track.stbl, "stts");
    if ((!stsz && !stz2) || !stsc || !stco || !stts) continue;
    const sampleCount = stsz ? stsz.fields.sampleCount : stz2.fields.sampleCount;
    if (!sampleCount) continue;
    const sizes = stsz ? (stsz.fields.sampleSize ? Array(sampleCount).fill(stsz.fields.sampleSize) : stsz.fields.sizes) : stz2.fields.sizes;
    const dtsDurations = expandTiming(stts.fields.entries, sampleCount);
    const ctts = findFirst(track.stbl, "ctts");
    const compositionOffsets = ctts ? expandCompositionOffsets(ctts.fields.entries, sampleCount) : Array(sampleCount).fill(0);
    const stss = findFirst(track.stbl, "stss");
    const syncSet = stss ? new Set(stss.fields.samples) : null;
    const offsets = computeSampleOffsets(stsc.fields.entries, stco.fields.offsets, sizes, sampleCount, track, warnings);
    for (let index = 0; index < sampleCount; index += 1) {
      const timing = dtsDurations[index] || { dts: 0, duration: 0 };
      const cts = compositionOffsets[index] || 0;
      rows.push({
        trackId: track.trackId,
        sampleIndex: index + 1,
        offset: offsets[index] ? offsets[index].offset.toString() : "",
        size: sizes[index] || 0,
        dts: timing.dts,
        pts: timing.dts + cts,
        duration: timing.duration,
        isSync: syncSet ? syncSet.has(index + 1) : true,
        frameType: getDefaultSampleFrameType(track),
        nalTypes: getDefaultSampleTags(track),
        chunkIndex: offsets[index] ? offsets[index].chunkIndex : "",
        fragmentIndex: "",
        warnings: offsets[index] ? [] : ["Sample offset missing."]
      });
    }
    track.sampleCount += sampleCount;
  }
  return rows;
}

function expandTiming(entries, sampleCount) {
  const result = new Array(sampleCount);
  let sampleIndex = 0;
  let dts = 0;
  for (const entry of entries) {
    for (let count = 0; count < entry.sampleCount && sampleIndex < sampleCount; count += 1) {
      result[sampleIndex] = { dts, duration: entry.sampleDelta };
      dts += entry.sampleDelta;
      sampleIndex += 1;
    }
  }
  return result;
}

function expandCompositionOffsets(entries, sampleCount) {
  const result = new Array(sampleCount).fill(0);
  let sampleIndex = 0;
  for (const entry of entries) {
    for (let count = 0; count < entry.sampleCount && sampleIndex < sampleCount; count += 1) {
      result[sampleIndex] = entry.sampleOffset;
      sampleIndex += 1;
    }
  }
  return result;
}

function computeSampleOffsets(stscEntries, chunkOffsets, sizes, sampleCount, track, warnings) {
  const result = new Array(sampleCount);
  let sampleIndex = 0;
  let stscIndex = 0;
  for (let chunkIndex = 1; chunkIndex <= chunkOffsets.length && sampleIndex < sampleCount; chunkIndex += 1) {
    while (stscIndex + 1 < stscEntries.length && chunkIndex >= stscEntries[stscIndex + 1].firstChunk) {
      stscIndex += 1;
    }
    const entry = stscEntries[stscIndex];
    let currentOffset;
    try {
      currentOffset = BigInt(chunkOffsets[chunkIndex - 1]);
    } catch (error) {
      warnings.push("Track " + track.trackId + " has an unsafe chunk offset.");
      break;
    }
    for (let sampleInChunk = 0; sampleInChunk < entry.samplesPerChunk && sampleIndex < sampleCount; sampleInChunk += 1) {
      result[sampleIndex] = { offset: currentOffset, chunkIndex };
      currentOffset += BigInt(sizes[sampleIndex] || 0);
      sampleIndex += 1;
    }
  }
  return result;
}

function buildFragmentSamples(topBoxes, tracks, warnings) {
  const rows = [];
  const sampleIndexByTrack = new Map(tracks.map((track) => [track.trackId, track.sampleCount]));
  const trackById = new Map(tracks.map((track) => [track.trackId, track]));
  const topLevel = topBoxes.slice().sort((a, b) => Number(a.offsetBig - b.offsetBig));
  let fragmentIndex = 0;
  for (const moof of topLevel.filter((box) => box.type === "moof")) {
    fragmentIndex += 1;
    const mdat = findFollowingMdat(topLevel, moof);
    const fallbackDataStart = mdat ? mdat.offsetBig + BigInt(mdat.headerSize) : moof.offsetBig + moof.sizeBig;
    let trafDataCursor = fallbackDataStart;
    for (const traf of (moof.children || []).filter((child) => child.type === "traf")) {
      const tfhd = findChild(traf, "tfhd");
      const tfdt = findChild(traf, "tfdt");
      if (!tfhd) {
        warnings.push("Fragment " + fragmentIndex + " has traf without tfhd.");
        continue;
      }
      const track = trackById.get(tfhd.fields.trackId);
      if (!track) {
        warnings.push("Fragment " + fragmentIndex + " references unknown track " + tfhd.fields.trackId + ".");
        continue;
      }
      const trex = track.trex || {};
      let decodeTime = tfdt ? Number(tfdt.fields.baseMediaDecodeTime) : 0;
      let baseDataOffset;
      if (tfhd.fields.baseDataOffset) baseDataOffset = BigInt(tfhd.fields.baseDataOffset);
      else if (tfhd.fields.defaultBaseIsMoof) baseDataOffset = moof.offsetBig;
      else baseDataOffset = trafDataCursor;
      let localDataCursor = trafDataCursor;
      for (const trun of (traf.children || []).filter((child) => child.type === "trun")) {
        const run = trun.fields;
        let dataCursor = run.dataOffset !== undefined ? baseDataOffset + BigInt(run.dataOffset) : localDataCursor;
        for (let index = 0; index < run.samples.length; index += 1) {
          const sample = run.samples[index];
          const duration = sample.duration || tfhd.fields.defaultSampleDuration || trex.defaultSampleDuration || 0;
          const size = sample.size || tfhd.fields.defaultSampleSize || trex.defaultSampleSize || 0;
          let flags = sample.flags;
          if (flags === undefined && index === 0 && run.firstSampleFlags !== undefined) flags = run.firstSampleFlags;
          if (flags === undefined) flags = tfhd.fields.defaultSampleFlags !== undefined ? tfhd.fields.defaultSampleFlags : trex.defaultSampleFlags;
          const ctsOffset = sample.compositionTimeOffset || 0;
          const nextIndex = (sampleIndexByTrack.get(track.trackId) || 0) + 1;
          sampleIndexByTrack.set(track.trackId, nextIndex);
          rows.push({
            trackId: track.trackId,
            sampleIndex: nextIndex,
            offset: dataCursor.toString(),
            size,
            dts: decodeTime,
            pts: decodeTime + ctsOffset,
            duration,
            isSync: sampleFlagsToSync(flags),
            frameType: getDefaultSampleFrameType(track),
            nalTypes: getDefaultSampleTags(track),
            chunkIndex: "",
            fragmentIndex,
            warnings: size ? [] : ["Fragment sample size is missing."]
          });
          dataCursor += BigInt(size || 0);
          decodeTime += duration;
        }
        localDataCursor = dataCursor;
        trafDataCursor = dataCursor;
      }
    }
  }
  for (const track of tracks) track.sampleCount = sampleIndexByTrack.get(track.trackId) || track.sampleCount;
  return rows;
}

function findFollowingMdat(topLevel, moof) {
  const moofEnd = moof.offsetBig + moof.sizeBig;
  return topLevel.find((box) => box.type === "mdat" && box.offsetBig >= moofEnd) || null;
}

function sampleFlagsToSync(flags) {
  if (flags === undefined || flags === null) return false;
  return (flags & 0x00010000) === 0;
}

function getDefaultSampleFrameType(track) {
  if (!track) return "";
  if (track.codec === "mp4a") return "AAC";
  if (track.handlerType === "soun") return "audio";
  return "";
}

function getDefaultSampleTags(track) {
  if (!track) return [];
  if (track.codec === "mp4a") return ["AAC"];
  if (track.handlerType === "soun") return [track.codec];
  return [];
}

function removeEmulationPreventionBytes(bytes) {
  const output = [];
  let zeroCount = 0;
  for (const byte of bytes) {
    if (zeroCount >= 2 && byte === 0x03) {
      zeroCount = 0;
      continue;
    }
    output.push(byte);
    if (byte === 0) zeroCount += 1;
    else zeroCount = 0;
  }
  return new Uint8Array(output);
}

class BitReader {
  constructor(bytes) {
    this.bytes = bytes;
    this.bitOffset = 0;
  }

  readBit() {
    if (this.bitOffset >= this.bytes.byteLength * 8) throw new Error("Unexpected end of bitstream.");
    const byte = this.bytes[this.bitOffset >> 3];
    const bit = (byte >> (7 - (this.bitOffset & 7))) & 1;
    this.bitOffset += 1;
    return bit;
  }

  readBits(count) {
    let value = 0;
    for (let index = 0; index < count; index += 1) value = (value << 1) | this.readBit();
    return value;
  }

  readUE() {
    let zeros = 0;
    while (this.readBit() === 0) {
      zeros += 1;
      if (zeros > 31) throw new Error("Exp-Golomb code is too large.");
    }
    const suffix = zeros ? this.readBits(zeros) : 0;
    return (1 << zeros) - 1 + suffix;
  }
}

function classifySliceType(sliceType) {
  const normalized = sliceType % 5;
  if (normalized === 0) return "P";
  if (normalized === 1) return "B";
  if (normalized === 2) return "I";
  if (normalized === 3) return "SP";
  if (normalized === 4) return "SI";
  return "unknown";
}

function nalTypeName(type) {
  const names = {
    1: "non-IDR",
    5: "IDR",
    6: "SEI",
    7: "SPS",
    8: "PPS",
    9: "AUD"
  };
  return names[type] || String(type);
}

function hevcNalTypeName(type) {
  const names = {
    0: "TRAIL_N",
    1: "TRAIL_R",
    2: "TSA_N",
    3: "TSA_R",
    4: "STSA_N",
    5: "STSA_R",
    6: "RADL_N",
    7: "RADL_R",
    8: "RASL_N",
    9: "RASL_R",
    16: "BLA_W_LP",
    17: "BLA_W_RADL",
    18: "BLA_N_LP",
    19: "IDR_W_RADL",
    20: "IDR_N_LP",
    21: "CRA_NUT",
    32: "VPS",
    33: "SPS",
    34: "PPS",
    35: "AUD",
    39: "PREFIX_SEI",
    40: "SUFFIX_SEI"
  };
  return names[type] || "NAL " + type;
}

function parseAvcSample(bytes, nalLengthSize) {
  const nalTypes = [];
  const frameTypes = [];
  let hasIdr = false;
  let offset = 0;
  while (offset + nalLengthSize <= bytes.byteLength) {
    let nalLength = 0;
    for (let index = 0; index < nalLengthSize; index += 1) {
      nalLength = (nalLength << 8) | bytes[offset + index];
    }
    offset += nalLengthSize;
    if (!nalLength || offset + nalLength > bytes.byteLength) break;
    const nalHeader = bytes[offset];
    const nalType = nalHeader & 0x1f;
    nalTypes.push(nalTypeName(nalType));
    if (nalType === 5) hasIdr = true;
    if (nalType === 1 || nalType === 5) {
      try {
        const rbsp = removeEmulationPreventionBytes(bytes.subarray(offset + 1, offset + nalLength));
        const bitReader = new BitReader(rbsp);
        bitReader.readUE();
        const sliceType = bitReader.readUE();
        frameTypes.push(classifySliceType(sliceType));
      } catch (error) {
        if (nalType === 5) frameTypes.push("IDR");
      }
    }
    offset += nalLength;
  }
  const uniqueTypes = Array.from(new Set(frameTypes.filter(Boolean)));
  let frameType = "unknown";
  if (uniqueTypes.length === 1) frameType = uniqueTypes[0];
  else if (uniqueTypes.length > 1) frameType = "mixed(" + uniqueTypes.join("/") + ")";
  else if (hasIdr) frameType = "IDR";
  return { frameType, nalTypes };
}

function parseHevcSample(bytes, nalLengthSize) {
  const nalTypes = [];
  const frameTypes = [];
  let hasIrap = false;
  let offset = 0;
  while (offset + nalLengthSize <= bytes.byteLength) {
    let nalLength = 0;
    for (let index = 0; index < nalLengthSize; index += 1) {
      nalLength = (nalLength << 8) | bytes[offset + index];
    }
    offset += nalLengthSize;
    if (!nalLength || offset + nalLength > bytes.byteLength || nalLength < 2) break;
    const nalUnitType = (bytes[offset] >> 1) & 0x3f;
    nalTypes.push(hevcNalTypeName(nalUnitType));
    if (HEVC_IRAP_NAL_TYPES.has(nalUnitType)) hasIrap = true;
    if (nalUnitType <= 31) {
      try {
        const rbsp = removeEmulationPreventionBytes(bytes.subarray(offset + 2, offset + nalLength));
        const bitReader = new BitReader(rbsp);
        bitReader.readBit();
        if (HEVC_IRAP_NAL_TYPES.has(nalUnitType)) bitReader.readBit();
        bitReader.readUE();
        const sliceType = bitReader.readUE();
        frameTypes.push(classifyHevcSliceType(sliceType));
      } catch (error) {
        if (HEVC_IRAP_NAL_TYPES.has(nalUnitType)) frameTypes.push("I");
      }
    }
    offset += nalLength;
  }
  const uniqueTypes = Array.from(new Set(frameTypes.filter(Boolean)));
  let frameType = "unknown";
  if (uniqueTypes.length === 1) frameType = uniqueTypes[0];
  else if (uniqueTypes.length > 1) frameType = "mixed(" + uniqueTypes.join("/") + ")";
  else if (hasIrap) frameType = "I";
  return { frameType, nalTypes };
}

function classifyHevcSliceType(sliceType) {
  if (sliceType === 0) return "B";
  if (sliceType === 1) return "P";
  if (sliceType === 2) return "I";
  return "unknown";
}

function getFrameTypeScanner(track) {
  if ((track.codec === "avc1" || track.codec === "avc3") && track.avcConfig && track.avcConfig.nalLengthSize) {
    return {
      codec: "AVC",
      parse: (bytes) => parseAvcSample(bytes, track.avcConfig.nalLengthSize)
    };
  }
  if ((track.codec === "hvc1" || track.codec === "hev1") && track.hevcConfig && track.hevcConfig.nalLengthSize) {
    return {
      codec: "HEVC",
      parse: (bytes) => parseHevcSample(bytes, track.hevcConfig.nalLengthSize)
    };
  }
  return null;
}

async function scanFrameTypes(analysis, options) {
  const onProgress = options && options.onProgress ? options.onProgress : function () {};
  const reader = analysis.reader;
  const scannableTracks = new Map();
  for (const track of analysis.tracks) {
    const scanner = getFrameTypeScanner(track);
    if (scanner) scannableTracks.set(track.trackId, { track, scanner });
  }
  const rows = analysis.sampleRows.filter((row) => scannableTracks.has(row.trackId) && row.offset !== "" && row.size > 0);
  for (let index = 0; index < rows.length; index += 1) {
    if (reader.cancelled) throw new Error("Analysis cancelled.");
    const row = rows[index];
    const item = scannableTracks.get(row.trackId);
    try {
      const bytes = await reader.readRange(BigInt(row.offset), BigInt(row.size));
      const result = item.scanner.parse(bytes);
      row.frameType = result.frameType;
      row.nalTypes = result.nalTypes;
    } catch (error) {
      row.frameType = "unknown";
      row.warnings.push(item.scanner.codec + " scan failed: " + error.message);
    }
    if (index % 25 === 0 || index === rows.length - 1) {
      onProgress("Scanning video samples", rows.length ? Math.round((index + 1) * 100 / rows.length) : 100);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
}

async function scanAvcFrameTypes(analysis, options) {
  return scanFrameTypes(analysis, options);
}

async function analyzeFile(file, options) {
  const onProgress = options && options.onProgress ? options.onProgress : function () {};
  const warnings = [];
  const reader = new BlobRangeReader(file);
  const fileSizeBig = BigInt(file.size);
  const topBoxes = await parseBoxes(reader, 0n, fileSizeBig, "", 0, warnings, onProgress);
  onProgress("Building track model", 66);
  const tracks = buildTrackModels(topBoxes, warnings);
  const normalRows = buildNormalSamples(tracks, warnings);
  const fragmentRows = buildFragmentSamples(topBoxes, tracks, warnings);
  const sampleRows = normalRows.concat(fragmentRows).sort((a, b) => {
    if (a.trackId !== b.trackId) return a.trackId - b.trackId;
    return a.sampleIndex - b.sampleIndex;
  });
  for (const track of tracks) {
    for (const warning of track.warnings) warnings.push("Track " + track.trackId + ": " + warning);
  }
  const allBoxes = flattenBoxes(topBoxes, []);
  const analysis = {
    file: { name: file.name || "unnamed", size: file.size, type: file.type || "" },
    reader,
    topBoxes,
    allBoxes,
    tracks,
    sampleRows,
    warnings
  };
  onProgress("Structure parsed", 100);
  return analysis;
}

function shouldAutoScan(analysis) {
  const videoRows = analysis.sampleRows.filter((row) => {
    const track = analysis.tracks.find((candidate) => candidate.trackId === row.trackId);
    return track && getFrameTypeScanner(track);
  });
  const totalBytes = videoRows.reduce((sum, row) => sum + (row.size || 0), 0);
  return videoRows.length > 0 && (videoRows.length <= 10000 || totalBytes <= 512 * 1024 * 1024);
}

function runParserSelfTests() {
  const results = [];
  const audioConfig = parseAudioSpecificConfig(new Uint8Array([0x12, 0x10]));
  assertSelfTest(audioConfig.audioObjectType === 2, "AAC LC object type", results);
  assertSelfTest(audioConfig.samplingFrequency === 44100, "AAC 44.1kHz sample rate", results);
  assertSelfTest(audioConfig.channelConfiguration === 2, "AAC stereo channel config", results);

  const esds = parseEsds(new Uint8Array([
    0x00, 0x00, 0x00, 0x00,
    0x03, 0x16, 0x00, 0x01, 0x00,
    0x04, 0x11, 0x40, 0x15, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0x05, 0x02, 0x12, 0x10
  ]));
  assertSelfTest(esds.audioConfig && esds.audioConfig.codecString === "mp4a.40.2", "esds mp4a.40.2", results);

  const avcSample = new Uint8Array([0x00, 0x00, 0x00, 0x02, 0x65, 0xb0]);
  assertSelfTest(parseAvcSample(avcSample, 4).frameType === "I", "AVC synthetic I frame", results);

  const hevcConfigBytes = new Uint8Array(23);
  hevcConfigBytes[0] = 1;
  hevcConfigBytes[1] = 1;
  hevcConfigBytes[12] = 93;
  hevcConfigBytes[21] = 3;
  const hevcConfig = parseHevcC(hevcConfigBytes);
  assertSelfTest(hevcConfig.nalLengthSize === 4, "HEVC hvcC NAL length size", results);

  const hevcSample = new Uint8Array([0x00, 0x00, 0x00, 0x03, 0x26, 0x01, 0xac]);
  assertSelfTest(parseHevcSample(hevcSample, 4).frameType === "I", "HEVC synthetic I frame", results);

  return { passed: true, results };
}

function assertSelfTest(condition, name, results) {
  if (!condition) throw new Error("Self-test failed: " + name);
  results.push({ name, passed: true });
}

export const Core = {
  analyzeFile,
  scanFrameTypes,
  scanAvcFrameTypes,
  parseAvcSample,
  parseHevcSample,
  parseAudioSpecificConfig,
  parseEsds,
  parseHevcC,
  runParserSelfTests,
  shouldAutoScan,
  formatBytes
};

export {
  ROW_HEIGHT,
  GRAPH_ROW_HEIGHT,
  METRIC_CHART_WIDTH,
  METRIC_CHART_HEIGHT,
  METRIC_CHART_PADDING,
  BOX_TYPE_INFO,
  clamp,
  formatBytes,
  formatBitsPerSecond,
  formatPreviewBitrate,
  formatMetricNumber,
  formatTime,
  safeJsonReplacer,
  findDescendants
};
