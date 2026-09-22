import { attachAsrServer } from './asr.js';
import { attachTtsServer } from './tts.js';

export function attachVoiceServer(httpServer, config) {
  const asr = attachAsrServer(httpServer, config);
  const tts = attachTtsServer(httpServer, config);
  return {
    middleware(request, response, next) {
      tts.middleware(request, response, () => asr.middleware(request, response, next));
    },
    close() { tts.close(); asr.close(); },
  };
}
