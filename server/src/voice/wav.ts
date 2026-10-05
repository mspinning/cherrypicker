export interface WavInfo {
  sampleRate: number;
  seconds: number;
  /** Loudest sample, 0–1 */
  peak: number;
}

/** Reads the header of a 16-bit PCM WAV file, the format the client records in; null for anything else. */
export function inspectWav(file: Buffer): WavInfo | null {
  if (file.length < 44 || file.toString('ascii', 0, 4) !== 'RIFF' || file.toString('ascii', 8, 12) !== 'WAVE') return null;

  let format: { channels: number; sampleRate: number } | null = null;
  for (let offset = 12; offset + 8 <= file.length; ) {
    const id = file.toString('ascii', offset, offset + 4);
    const size = file.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (id === 'fmt ' && start + 16 <= file.length) {
      const pcm = file.readUInt16LE(start) === 1 && file.readUInt16LE(start + 14) === 16;
      const channels = file.readUInt16LE(start + 2);
      const sampleRate = file.readUInt32LE(start + 4);
      if (!pcm || channels < 1 || channels > 2 || sampleRate < 8000 || sampleRate > 48_000) return null;
      format = { channels, sampleRate };
    } else if (id === 'data') {
      if (!format) return null;
      const end = Math.min(start + size, file.length);
      let peak = 0;
      for (let i = start; i + 2 <= end; i += 2) {
        const sample = Math.abs(file.readInt16LE(i));
        if (sample > peak) peak = sample;
      }
      return { sampleRate: format.sampleRate, seconds: (end - start) / 2 / format.channels / format.sampleRate, peak: peak / 32_768 };
    }
    // Chunks are padded to even sizes
    offset = start + size + (size % 2);
  }
  return null;
}
