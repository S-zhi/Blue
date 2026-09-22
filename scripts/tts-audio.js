import { execFile } from 'node:child_process';
import { mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);

export function pcmToWav(pcm, sampleRate) {
  if (!Buffer.isBuffer(pcm) || !pcm.length || pcm.length % 2) throw new Error('INVALID_PCM');
  if (![8000, 16000, 22050, 24000, 32000, 44100, 48000].includes(sampleRate)) throw new Error('INVALID_SAMPLE_RATE');
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8); header.write('fmt ', 12); header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // Linear PCM.
  header.writeUInt16LE(1, 22); // Mono.
  header.writeUInt32LE(sampleRate, 24); header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export async function playPcm(pcm, sampleRate) {
  if (process.platform !== 'darwin') throw new Error('PLAY_REQUIRES_MACOS');
  const wav = pcmToWav(pcm, sampleRate);
  const directory = await mkdtemp(path.join(tmpdir(), 'blue-tts-play-'));
  const file = path.join(directory, 'speech.wav');
  try {
    await writeFile(file, wav, { mode: 0o600 });
    // Play through macOS's current output device. No shell, volume changes,
    // browser autoplay policy, or extra package dependency is involved.
    await execute('/usr/bin/afplay', [file], { timeout: 150000, maxBuffer: 4096 });
  } finally {
    // Delete only the temporary file/directory created by this invocation.
    await unlink(file).catch(() => {});
    await rmdir(directory).catch(() => {});
  }
}
