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

export {
  removeEmulationPreventionBytes,
  BitReader
};
