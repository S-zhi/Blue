// Provider word timestamps are seconds from the start of the complete PCM stream.
export class AudioCaptions {
  constructor(text) { this.text = text; this.words = []; this.sentences = []; this.keys = new Set(); this.end = 0; }
  add(payload) {
    const subtitle = payload?.sentence || payload;
    if (!Array.isArray(subtitle?.words)) return;
    for (const item of subtitle.words) {
      const start = item.startTime, end = item.endTime, word = item.word;
      if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || typeof word !== 'string' || !word) continue;
      const key = JSON.stringify([start, end, word]);
      if (this.keys.has(key)) continue;
      this.keys.add(key); this.words.push({ start, end, word }); this.end = Math.max(this.end, end);
    }
    this.words.sort((a, b) => a.start - b.start);
  }
  sentence(message, sampleRate) {
    if (!Number.isSafeInteger(message.audioBytes) || message.audioBytes < 0 || message.audioBytes % 2) return;
    const time = message.audioBytes / (sampleRate * 2);
    if (message.boundary === 'start') {
      this.currentSentence = { start: time, text: typeof message.text === 'string' ? message.text : '' };
    } else if (message.boundary === 'end' && this.currentSentence) {
      const sentence = this.currentSentence;
      sentence.end = time;
      if (!sentence.text && typeof message.text === 'string') sentence.text = message.text;
      if (sentence.end >= sentence.start) { this.sentences.push(sentence); this.end = Math.max(this.end, time); }
      this.currentSentence = null;
    }
  }
  complete(duration) { this.duration = duration; }
  reveal(text, progress) {
    const characters = [...text];
    return characters.slice(0, Math.min(characters.length, Math.floor(Math.max(0, progress) * characters.length) + 1)).join('');
  }
  at(seconds) {
    if (seconds === null) return '';
    // Voices without timestamp support retain sentence-level playback captions.
    if (!this.words.length) {
      if (!this.sentences.some(sentence => sentence.text)) return this.duration > 0 ? this.reveal(this.text, seconds / this.duration) : '';
      let offset = 0;
      for (const sentence of this.sentences) {
        if (sentence.start > seconds) break;
        const found = this.text.indexOf(sentence.text, offset);
        if (sentence.text && found >= 0) {
          if (seconds < sentence.end) return this.text.slice(0, found) + this.reveal(sentence.text, (seconds - sentence.start) / (sentence.end - sentence.start));
          offset = found + sentence.text.length;
        }
      }
      return this.text.slice(0, offset);
    }
    let offset = 0, spoken = '';
    for (const { start, word } of this.words) {
      if (start > seconds) break;
      const found = this.text.indexOf(word, offset);
      if (found >= 0) { offset = found + word.length; spoken = this.text.slice(0, offset); }
      else spoken += word;
    }
    return spoken;
  }
}
