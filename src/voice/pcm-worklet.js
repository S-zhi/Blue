import { PcmFramer } from './audio-core.js';

class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.stopped = false;
    this.framer = new PcmFramer(sampleRate, frame => this.port.postMessage({ type: 'frame', ...frame }, [frame.pcm]));
    this.port.onmessage = event => {
      if (event.data.type === 'flush' && !this.stopped) {
        this.stopped = true;
        this.framer.flush();
        this.port.postMessage({ type: 'flushed' });
      }
    };
  }
  process(inputs, outputs) {
    for (const channel of outputs[0] || []) channel.fill(0); // Never play captured speech through speakers.
    if (!this.stopped && inputs[0]?.[0]) this.framer.push(inputs[0][0]);
    return true;
  }
}
registerProcessor('pcm-capture', PcmCapture);
