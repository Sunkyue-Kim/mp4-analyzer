// VP9 uses a Boolean arithmetic decoder. This implementation follows the VP9
// bitstream state transitions directly and was cross-checked against libvpx's
// BSD-licensed reference decoder; it does not import or call libvpx at runtime.
// BigInt keeps the required 64-bit unsigned shifts exact in JavaScript.

const RANGE_VALUE_BITS = 64;
const RANGE_VALUE_MASK = (1n << BigInt(RANGE_VALUE_BITS)) - 1n;
const RANGE_VALUE_TOP_SHIFT = BigInt(RANGE_VALUE_BITS - 8);
const END_OF_BUFFER_SENTINEL = 0x40000000;

function isUint8Array(value) {
  return ArrayBuffer.isView(value) && Object.prototype.toString.call(value) === "[object Uint8Array]";
}

function normalizationShiftFor(range) {
  let normalizedRange = range;
  let shift = 0;
  while (normalizedRange < 128) {
    normalizedRange <<= 1;
    shift += 1;
  }
  return shift;
}

class Vp9RangeDecoder {
  constructor(bytes, options = {}) {
    if (!isUint8Array(bytes)) {
      throw new TypeError("VP9 range decoder input must be a Uint8Array.");
    }
    this.bytes = bytes;
    this.label = options.label || "VP9 entropy partition";
    this.byteOffset = 0;
    this.value = 0n;
    this.range = 255;
    this.count = -8;
    this.symbolCount = 0;
    this.normalizationBits = 0;
    this.informationBits = 0;
    this.fill();
    this.markerBit = this.readBit();
    if (this.markerBit !== 0) {
      throw new Error(this.label + " has a non-zero boolean decoder marker bit.");
    }
  }

  fill() {
    const bytesRemaining = this.bytes.byteLength - this.byteOffset;
    const bitsRemaining = bytesRemaining * 8;
    let shift = RANGE_VALUE_BITS - 8 - (this.count + 8);
    const bitsOver = shift + 8 - bitsRemaining;
    const loopEnd = bitsOver >= 0 ? bitsOver : 0;

    if (bitsOver >= 0) this.count += END_OF_BUFFER_SENTINEL;

    while (shift >= loopEnd && this.byteOffset < this.bytes.byteLength) {
      this.count += 8;
      this.value |= BigInt(this.bytes[this.byteOffset]) << BigInt(shift);
      this.byteOffset += 1;
      shift -= 8;
    }
    this.value &= RANGE_VALUE_MASK;
  }

  read(probability) {
    if (!Number.isInteger(probability) || probability < 1 || probability > 255) {
      throw new RangeError("VP9 boolean probability must be an integer from 1 through 255.");
    }
    if (this.count < 0) this.fill();

    const split = (this.range * probability + (256 - probability)) >> 8;
    const bigSplit = BigInt(split) << RANGE_VALUE_TOP_SHIFT;
    let bit = 0;
    let nextRange = split;
    if (this.value >= bigSplit) {
      bit = 1;
      nextRange = this.range - split;
      this.value -= bigSplit;
    }

    const shift = normalizationShiftFor(nextRange);
    this.range = nextRange << shift;
    this.value = (this.value << BigInt(shift)) & RANGE_VALUE_MASK;
    this.count -= shift;
    this.symbolCount += 1;
    this.normalizationBits += shift;
    const branchProbability = bit ? 256 - probability : probability;
    this.informationBits += -Math.log2(branchProbability / 256);
    return bit;
  }

  readBit() {
    return this.read(128);
  }

  readLiteral(bitCount) {
    if (!Number.isInteger(bitCount) || bitCount < 0 || bitCount > 31) {
      throw new RangeError("VP9 boolean literal width must be from 0 through 31 bits.");
    }
    let value = 0;
    for (let bitIndex = bitCount - 1; bitIndex >= 0; bitIndex -= 1) {
      value = value * 2 + this.readBit();
    }
    return value;
  }

  readTree(tree, probabilities) {
    let treeIndex = 0;
    while (true) {
      const probabilityIndex = treeIndex >> 1;
      const bit = this.read(probabilities[probabilityIndex]);
      const nextIndex = tree[treeIndex + bit];
      if (nextIndex <= 0) return -nextIndex;
      treeIndex = nextIndex;
    }
  }

  snapshot() {
    return {
      informationBits: this.informationBits,
      normalizationBits: this.normalizationBits,
      symbolCount: this.symbolCount
    };
  }

  measureFrom(snapshot) {
    return {
      entropyBits: this.informationBits - snapshot.informationBits,
      normalizationBits: this.normalizationBits - snapshot.normalizationBits,
      symbolCount: this.symbolCount - snapshot.symbolCount
    };
  }

  hasError() {
    return this.count > RANGE_VALUE_BITS && this.count < END_OF_BUFFER_SENTINEL;
  }
}

export { Vp9RangeDecoder };
