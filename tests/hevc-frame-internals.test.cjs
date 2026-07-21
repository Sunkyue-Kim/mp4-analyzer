const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { createSourceModuleLoader } = require("./helpers/source-module-loader.cjs");

function appendLengthPrefixedNalUnit(sampleBytes, nalUnitBytes, nalLengthSize = 4) {
  const lengthPrefix = new Uint8Array(nalLengthSize);
  let remainingLength = nalUnitBytes.byteLength;
  for (let byteIndex = nalLengthSize - 1; byteIndex >= 0; byteIndex -= 1) {
    lengthPrefix[byteIndex] = remainingLength & 0xff;
    remainingLength = Math.floor(remainingLength / 256);
  }
  const result = new Uint8Array(sampleBytes.byteLength + lengthPrefix.byteLength + nalUnitBytes.byteLength);
  result.set(sampleBytes, 0);
  result.set(lengthPrefix, sampleBytes.byteLength);
  result.set(nalUnitBytes, sampleBytes.byteLength + lengthPrefix.byteLength);
  return result;
}

test("hvcC parsing retains exact parameter-set bytes for native HEVC inspection", async () => {
  const loader = await createSourceModuleLoader();
  const { parseHevcC } = await loader.import("src/js/core/codecs/video/hevc.js");
  const configurationBytes = new Uint8Array(31);
  configurationBytes[0] = 1;
  configurationBytes[1] = 1;
  configurationBytes[12] = 120;
  configurationBytes[21] = 3;
  configurationBytes[22] = 1;
  configurationBytes[23] = 0x80 | 33;
  configurationBytes[25] = 1;
  configurationBytes[27] = 3;
  configurationBytes.set([0xaa, 0xbb, 0xcc], 28);

  const configuration = parseHevcC(configurationBytes);

  assert.deepEqual(Array.from(configuration.arrays[0].nalUnits[0].bytes), [0xaa, 0xbb, 0xcc]);
});

test("bundled HEVC reports only the exact SPS CTU grid when CABAC traversal is unverified", async () => {
  const loader = await createSourceModuleLoader();
  const { Core } = await loader.import("src/js/core/analyzer-core.js");
  const fileName = "hevc_4k_5s.mp4";
  const fileBytes = fs.readFileSync(path.join(__dirname, "..", "validation", "generated", fileName));
  const file = new Blob([fileBytes], { type: "video/mp4" });
  Object.defineProperty(file, "name", { value: fileName });
  const analysis = await Core.analyzeFile(file, {});
  const videoTrack = analysis.tracks.find((track) => track.handlerType === "vide");
  const sampleRow = analysis.sampleRows.find(
    (row) => String(row.trackId) === String(videoTrack.trackId)
  );

  const result = await Core.analyzeFrameInternals(analysis, sampleRow);

  assert.equal(result.kind, "hevc-frame-internals");
  assert.equal(result.complete, true);
  assert.equal(result.exact, false);
  assert.equal(result.treeComplete, false);
  assert.equal(result.granularity, "root-units");
  assert.equal(result.sampleBits, sampleRow.size * 8);
  assert.equal(result.attributedBits, null);
  assert.equal(result.overheadBits, null);
  assert.equal(result.unattributedBits, result.sampleBits);
  assert.equal(result.unitName, "CTU");
  assert.equal(result.unitWidth, 64);
  assert.equal(result.unitHeight, 64);
  assert.equal(result.columns, 60);
  assert.equal(result.rows, 34);
  assert.equal(result.roots.length, 2040);
  assert.equal(result.blocks.length, 2040);
  assert.deepEqual(JSON.parse(JSON.stringify(result.roots[0])), {
    id: "ctu:0:0",
    left: 0,
    top: 0,
    width: 64,
    height: 64,
    depth: 0,
    type: "CTU",
    syntaxBits: null,
    children: [],
    metadata: {
      row: 0,
      column: 0,
      visibleWidth: 64,
      visibleHeight: 64
    }
  });
  assert.deepEqual(JSON.parse(JSON.stringify(result.roots.at(-1).metadata)), {
    row: 33,
    column: 59,
    visibleWidth: 64,
    visibleHeight: 48
  });
  assert.ok(result.roots.every((root) => (
    root.type === "CTU" && root.syntaxBits === null && root.children.length === 0
  )));
  assert.ok(result.warnings.some((warning) => warning.includes("no inferred block bits")));

  const model = Core.buildFrameInternalsModel(sampleRow, videoTrack, {
    parsedFrameInternals: result
  });
  assert.equal(model.intrinsicWidth, 3840);
  assert.equal(model.intrinsicHeight, 2176);
  assert.equal(model.mediaWidth, 3840);
  assert.equal(model.mediaHeight, 2160);
  assert.equal(model.cells.at(-1).blockWidth, 64);
  assert.equal(model.cells.at(-1).blockHeight, 64);
  assert.equal(model.cells.at(-1).pixelBottom, 2160);
  assert.equal(model.cells.at(-1).subtreeBits, null);
});

test("HEVC internals fail closed when retained SPS and PPS bytes are unavailable", async () => {
  const loader = await createSourceModuleLoader();
  const { parseHevcFrameInternals } = await loader.import("src/js/core/codecs/video/hevc.js");
  const result = parseHevcFrameInternals(
    Uint8Array.from([0, 0, 0, 2, 0x26, 0x01]),
    { nalLengthSize: 4, arrays: [] },
    { width: 64, height: 64 }
  );

  assert.equal(result.kind, "unavailable");
  assert.equal(result.complete, false);
  assert.equal(result.sampleBits, 48);
  assert.match(result.reason, /SPS bytes are unavailable/);
});

test("HEVC internals never guesses an SPS when the referenced PPS is unavailable", async () => {
  const loader = await createSourceModuleLoader();
  const { Core } = await loader.import("src/js/core/analyzer-core.js");
  const { parseHevcFrameInternals } = await loader.import("src/js/core/codecs/video/hevc.js");
  const fileName = "hevc_4k_5s.mp4";
  const fileBytes = fs.readFileSync(path.join(__dirname, "..", "validation", "generated", fileName));
  const file = new Blob([fileBytes], { type: "video/mp4" });
  Object.defineProperty(file, "name", { value: fileName });
  const analysis = await Core.analyzeFile(file, {});
  const videoTrack = analysis.tracks.find((track) => track.handlerType === "vide");
  const sampleRow = analysis.sampleRows.find(
    (row) => String(row.trackId) === String(videoTrack.trackId)
  );
  const sampleBytes = await analysis.reader.readExactRange(BigInt(sampleRow.offset), BigInt(sampleRow.size));
  const configurationWithoutPictureParameterSets = {
    ...videoTrack.codecConfig,
    arrays: videoTrack.codecConfig.arrays.filter((entry) => entry.nalUnitType !== 34)
  };

  const result = parseHevcFrameInternals(
    sampleBytes,
    configurationWithoutPictureParameterSets,
    videoTrack
  );

  assert.equal(result.kind, "unavailable");
  assert.equal(result.complete, false);
  assert.match(result.reason, /references unavailable PPS/);
});

test("HEVC internals never applies a PPS that appears after its coded slices", async () => {
  const loader = await createSourceModuleLoader();
  const { Core } = await loader.import("src/js/core/analyzer-core.js");
  const { parseHevcFrameInternals } = await loader.import("src/js/core/codecs/video/hevc.js");
  const fileName = "hevc_4k_5s.mp4";
  const fileBytes = fs.readFileSync(path.join(__dirname, "..", "validation", "generated", fileName));
  const file = new Blob([fileBytes], { type: "video/mp4" });
  Object.defineProperty(file, "name", { value: fileName });
  const analysis = await Core.analyzeFile(file, {});
  const videoTrack = analysis.tracks.find((track) => track.handlerType === "vide");
  const sampleRow = analysis.sampleRows.find((row) => String(row.trackId) === String(videoTrack.trackId));
  const sampleBytes = await analysis.reader.readExactRange(BigInt(sampleRow.offset), BigInt(sampleRow.size));
  const pictureParameterSetArray = videoTrack.codecConfig.arrays.find((entry) => entry.nalUnitType === 34);
  const pictureParameterSetBytes = pictureParameterSetArray.nalUnits[0].bytes;
  const configurationWithoutPictureParameterSets = {
    ...videoTrack.codecConfig,
    arrays: videoTrack.codecConfig.arrays.filter((entry) => entry.nalUnitType !== 34)
  };

  const result = parseHevcFrameInternals(
    appendLengthPrefixedNalUnit(sampleBytes, pictureParameterSetBytes, videoTrack.codecConfig.nalLengthSize),
    configurationWithoutPictureParameterSets,
    videoTrack
  );

  assert.equal(result.kind, "unavailable");
  assert.equal(result.complete, false);
  assert.match(result.reason, /cannot be applied retroactively/);
});

test("HEVC internals rejects a same-id parameter-set change after coded slices begin", async () => {
  const loader = await createSourceModuleLoader();
  const { Core } = await loader.import("src/js/core/analyzer-core.js");
  const { parseHevcFrameInternals } = await loader.import("src/js/core/codecs/video/hevc.js");
  const fileName = "hevc_4k_5s.mp4";
  const fileBytes = fs.readFileSync(path.join(__dirname, "..", "validation", "generated", fileName));
  const file = new Blob([fileBytes], { type: "video/mp4" });
  Object.defineProperty(file, "name", { value: fileName });
  const analysis = await Core.analyzeFile(file, {});
  const videoTrack = analysis.tracks.find((track) => track.handlerType === "vide");
  const sampleRow = analysis.sampleRows.find((row) => String(row.trackId) === String(videoTrack.trackId));
  const sampleBytes = await analysis.reader.readExactRange(BigInt(sampleRow.offset), BigInt(sampleRow.size));
  const pictureParameterSetArray = videoTrack.codecConfig.arrays.find((entry) => entry.nalUnitType === 34);
  const originalPictureParameterSetBytes = pictureParameterSetArray.nalUnits[0].bytes;
  const changedPictureParameterSetBytes = new Uint8Array(originalPictureParameterSetBytes.byteLength + 1);
  changedPictureParameterSetBytes.set(originalPictureParameterSetBytes);
  changedPictureParameterSetBytes[changedPictureParameterSetBytes.byteLength - 1] = 0x80;

  const result = parseHevcFrameInternals(
    appendLengthPrefixedNalUnit(sampleBytes, changedPictureParameterSetBytes, videoTrack.codecConfig.nalLengthSize),
    videoTrack.codecConfig,
    videoTrack
  );

  assert.equal(result.kind, "unavailable");
  assert.equal(result.complete, false);
  assert.match(result.reason, /changes after coded slices begin/);
});
