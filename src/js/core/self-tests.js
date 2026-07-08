import { parseAudioSpecificConfig, parseEsds } from "./codecs/audio/aac.js";
import { parseAvcSample } from "./codecs/video/avc.js";
import { parseHevcC, parseHevcSample } from "./codecs/video/hevc.js";

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

export {
  runParserSelfTests
};
