const assert = require("node:assert/strict");
const test = require("node:test");
const { createSourceModuleLoader } = require("./helpers/source-module-loader.cjs");

test("AAC esds and AudioSpecificConfig parsing exposes codec metadata", async () => {
  const loader = await createSourceModuleLoader();
  const { parseAudioSpecificConfig, parseEsds } = await loader.import("src/js/core/codecs/audio/aac.js");

  const audioConfig = parseAudioSpecificConfig(new Uint8Array([0x12, 0x10]));
  assert.equal(audioConfig.audioObjectType, 2);
  assert.equal(audioConfig.audioObjectTypeName, "AAC LC");
  assert.equal(audioConfig.samplingFrequency, 44100);
  assert.equal(audioConfig.channelDescription, "stereo");

  const esds = parseEsds(new Uint8Array([
    0x00, 0x00, 0x00, 0x00,
    0x03, 0x16, 0x00, 0x01, 0x00,
    0x04, 0x11, 0x40, 0x15, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0x05, 0x02, 0x12, 0x10
  ]));
  assert.equal(esds.audioConfig.codecString, "mp4a.40.2");
  assert.equal(parseEsds(new Uint8Array([0, 0])).error, "esds too short");
});

test("AAC AudioSpecificConfig covers explicit rates, extension object types, and descriptor edges", async () => {
  const loader = await createSourceModuleLoader();
  const { parseAudioSpecificConfig, parseEsds } = await loader.import("src/js/core/codecs/audio/aac.js");

  const escapedObjectType = parseAudioSpecificConfig(packBits(
    "11111" +
    "000010" +
    "1111" +
    "000000001011101110000000" +
    "1000"
  ));
  assert.equal(escapedObjectType.audioObjectType, 34);
  assert.equal(escapedObjectType.audioObjectTypeName, "Audio object type 34");
  assert.equal(escapedObjectType.samplingFrequency, 48000);
  assert.equal(escapedObjectType.channelDescription, "8 channels");

  const sbrConfig = parseAudioSpecificConfig(packBits(
    "00101" +
    "0100" +
    "0010" +
    "0011" +
    "00010"
  ));
  assert.equal(sbrConfig.audioObjectType, 2);
  assert.equal(sbrConfig.extensionAudioObjectType, 5);
  assert.equal(sbrConfig.extensionSamplingFrequency, 48000);

  const esdsWithoutDecoderSpecificInfo = parseEsds(new Uint8Array([
    0x00, 0x00, 0x00, 0x00,
    0x03, 0x0f, 0x00, 0x01, 0xe0, 0x00, 0x00, 0x00,
    0x04, 0x02, 0x40, 0x15
  ]));
  assert.equal(esdsWithoutDecoderSpecificInfo.objectTypeIndication, null);
  assert.equal(esdsWithoutDecoderSpecificInfo.audioConfig, null);
});

test("MP3 and Opus parsers reject invalid bytes and describe valid packets", async () => {
  const loader = await createSourceModuleLoader();
  const mp3 = await loader.import("src/js/core/codecs/audio/mp3.js");
  const opus = await loader.import("src/js/core/codecs/audio/opus.js");

  const header = mp3.parseMp3FrameHeader(new Uint8Array([0xff, 0xfb, 0x90, 0x64]), 0);
  assert.equal(header.version, "MPEG-1");
  assert.equal(header.layer, "Layer III");
  assert.equal(header.samplingRate, 44100);
  assert.equal(header.frameLength, 417);
  assert.equal(mp3.parseMp3FrameHeader(new Uint8Array([0x00, 0x00, 0x00, 0x00]), 0), null);

  const id3 = mp3.readId3v2Header(new Uint8Array([0x49, 0x44, 0x33, 0x04, 0x00, 0x10, 0x00, 0x00, 0x00, 0x05]));
  assert.equal(id3.version, "2.4.0");
  assert.equal(id3.size, 25);
  assert.equal(id3.footerPresent, true);

  const opusHead = opus.parseOpusHead(new Uint8Array([
    0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64,
    0x01, 0x02, 0x38, 0x01, 0x80, 0xbb, 0x00, 0x00, 0x00, 0x00, 0x00
  ]));
  assert.equal(opusHead.channelCount, 2);
  assert.equal(opusHead.inputSampleRate, 48000);
  assert.equal(opus.parseOpusHead(new Uint8Array([1, 2, 3])), null);
  assert.equal(opus.parseOpusPacket(new Uint8Array([0x78])).durationSamples, 960);
});

test("MP3 and Opus parsers cover layer, channel, lacing-count, and invalid-header branches", async () => {
  const loader = await createSourceModuleLoader();
  const mp3 = await loader.import("src/js/core/codecs/audio/mp3.js");
  const opus = await loader.import("src/js/core/codecs/audio/opus.js");

  assert.equal(mp3.parseMp3FrameHeader(new Uint8Array([0xff, 0xfb, 0x90]), 0), null);
  assert.equal(mp3.parseMp3FrameHeader(makeMp3HeaderBytes({ versionBits: 1, layerBits: 1 }), 0), null);
  const layerOneHeader = mp3.parseMp3FrameHeader(makeMp3HeaderBytes({
    versionBits: 3,
    layerBits: 3,
    bitrateIndex: 1,
    samplingRateIndex: 0,
    padding: 1,
    channelMode: 3
  }), 0);
  assert.equal(layerOneHeader.layer, "Layer I");
  assert.equal(layerOneHeader.samplesPerFrame, 384);
  assert.equal(layerOneHeader.channelCount, 1);
  assert.equal(layerOneHeader.padding, true);

  const mpegTwoLayerThreeHeader = mp3.parseMp3FrameHeader(makeMp3HeaderBytes({
    versionBits: 2,
    layerBits: 1,
    bitrateIndex: 1,
    samplingRateIndex: 0
  }), 0);
  assert.equal(mpegTwoLayerThreeHeader.version, "MPEG-2");
  assert.equal(mpegTwoLayerThreeHeader.layer, "Layer III");
  assert.equal(mpegTwoLayerThreeHeader.samplesPerFrame, 576);

  assert.deepEqual(JSON.parse(JSON.stringify(opus.parseOpusPacket(new Uint8Array([])))), {
    codecString: "opus",
    frameType: "Opus",
    frameCount: 0,
    durationSamples: 0,
    durationMs: 0
  });
  assert.equal(opus.parseOpusPacket(new Uint8Array([0x03])).frameCount, 0);
  const multiFramePacket = opus.parseOpusPacket(new Uint8Array([0xff, 0x83]));
  assert.equal(multiFramePacket.mode, "CELT");
  assert.equal(multiFramePacket.bandwidth, "FB");
  assert.equal(multiFramePacket.frameCount, 3);
  assert.equal(multiFramePacket.stereo, true);
});

test("AVC and HEVC parsers expose config and classify synthetic sample payloads", async () => {
  const loader = await createSourceModuleLoader();
  const avc = await loader.import("src/js/core/codecs/video/avc.js");
  const hevc = await loader.import("src/js/core/codecs/video/hevc.js");

  const avcConfig = avc.parseAvcC(new Uint8Array([
    0x01, 0x64, 0x00, 0x1f, 0xff, 0xe1, 0x00, 0x04,
    0x67, 0x64, 0x00, 0x1f, 0x01, 0x00, 0x02, 0x68, 0xee
  ]));
  assert.equal(avcConfig.codecString, "avc1.64001f");
  assert.equal(avcConfig.nalLengthSize, 4);
  assert.equal(avcConfig.spsCount, 1);
  assert.equal(avc.parseAvcC(new Uint8Array([1, 2, 3])).error, "avcC too short");
  assert.equal(avc.parseAvcSample(new Uint8Array([0x00, 0x00, 0x00, 0x02, 0x65, 0xb0]), 4).frameType, "I");
  assert.equal(avc.parseAvcSample(new Uint8Array([0x00, 0x00, 0x00, 0x02, 0x41, 0xc0]), 4).frameType, "P");
  assert.equal(avc.parseAvcSample(new Uint8Array([0x00, 0x00, 0x00, 0x02, 0x41, 0xa0]), 4).frameType, "B");
  assert.equal(avc.nalTypeName(7), "SPS");

  const hevcConfigBytes = new Uint8Array(23);
  hevcConfigBytes[0] = 1;
  hevcConfigBytes[1] = 1;
  hevcConfigBytes[12] = 93;
  hevcConfigBytes[21] = 3;
  const hevcConfig = hevc.parseHevcC(hevcConfigBytes);
  assert.equal(hevcConfig.nalLengthSize, 4);
  assert.equal(hevcConfig.generalLevelIdc, 93);
  assert.equal(hevc.parseHevcC(new Uint8Array([1, 2])).error, "hvcC too short");
  assert.equal(hevc.parseHevcSample(new Uint8Array([0x00, 0x00, 0x00, 0x03, 0x26, 0x01, 0xac]), 4).frameType, "I");
  assert.equal(hevc.hevcNalTypeName(33), "SPS");
});

test("codec registry provides interchangeable descriptors and scanners", async () => {
  const loader = await createSourceModuleLoader();
  const registry = await loader.import("src/js/core/codecs/registry.js");

  assert.equal(registry.getCodecBySampleEntryType("avc1").id, "avc");
  assert.equal(registry.getCodecByConfigurationBoxType("hvcC").id, "hevc");
  assert.equal(registry.getCodecBySampleEntryType("mp3").kind, "audio");
  assert.equal(registry.getCodecBySampleEntryType("missing"), null);

  const scanner = registry.getFrameTypeScanner({
    codec: "avc1",
    codecConfig: { nalLengthSize: 4 }
  });
  assert.equal(scanner.codec, "AVC / H.264");
  assert.equal((await scanner.parse(new Uint8Array([0x00, 0x00, 0x00, 0x02, 0x65, 0xb0]))).frameType, "I");
});

function packBits(bits) {
  const bytes = new Uint8Array(Math.ceil(bits.length / 8));
  for (let bitIndex = 0; bitIndex < bits.length; bitIndex += 1) {
    if (bits[bitIndex] === "1") bytes[Math.floor(bitIndex / 8)] |= 1 << (7 - (bitIndex % 8));
  }
  return bytes;
}

function makeMp3HeaderBytes(options = {}) {
  const versionBits = options.versionBits === undefined ? 3 : options.versionBits;
  const layerBits = options.layerBits === undefined ? 1 : options.layerBits;
  const bitrateIndex = options.bitrateIndex === undefined ? 9 : options.bitrateIndex;
  const samplingRateIndex = options.samplingRateIndex === undefined ? 0 : options.samplingRateIndex;
  const padding = options.padding || 0;
  const channelMode = options.channelMode === undefined ? 0 : options.channelMode;
  const header = (
    0xffe00000 |
    (versionBits << 19) |
    (layerBits << 17) |
    (1 << 16) |
    (bitrateIndex << 12) |
    (samplingRateIndex << 10) |
    (padding << 9) |
    (channelMode << 6)
  ) >>> 0;
  return new Uint8Array([
    (header >>> 24) & 0xff,
    (header >>> 16) & 0xff,
    (header >>> 8) & 0xff,
    header & 0xff
  ]);
}
