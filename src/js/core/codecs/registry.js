import { parseAvcSample } from "./video/avc.js";
import { parseHevcSample } from "./video/hevc.js";

export const VIDEO_SAMPLE_ENTRIES = new Set([
  "avc1", "avc2", "avc3", "avc4", "hvc1", "hev1", "av01", "encv", "mp4v",
  "ap4h", "ap4x", "apch", "apcn", "apcs", "apco", "aprn", "aprh"
]);

export const AUDIO_SAMPLE_ENTRIES = new Set(["mp4a", "enca", "ac-3", "ec-3", "Opus", "alac"]);

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

export {
  getFrameTypeScanner
};
