function asObject(value) {
  if (typeof value === 'string') { try { value = JSON.parse(value); } catch { return {}; } }
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}
function numeric(value) {
  if (value === null || value === '' || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
export function normalizeResult(frame) {
  const wrapper = asObject(frame.payload);
  const payload = asObject(wrapper.payload_msg || wrapper);
  const results = Array.isArray(payload.result) ? payload.result : [payload.result];
  const final = frame.final || wrapper.is_last_package === true;
  const utterances = results.flatMap(result => Array.isArray(result?.utterances) ? result.utterances : []).map(utterance => {
    const additions = asObject(utterance.additions);
    const age = numeric(additions.age);
    return {
      text: typeof utterance.text === 'string' ? utterance.text : '',
      definite: final || utterance.definite === true,
      start: numeric(utterance.start_time), end: numeric(utterance.end_time),
      attributes: {
        age: age !== null && age >= 0 && age <= 130 ? age : null,
        gender: ['male', 'female'].includes(additions.gender) ? additions.gender : null,
        emotion: ['angry', 'happy', 'neutral', 'sad', 'surprise'].includes(additions.emotion) ? additions.emotion : null,
        speaker: additions.speaker_id === undefined ? null : String(additions.speaker_id),
        speechRate: numeric(additions.speech_rate), volume: numeric(additions.volume),
      },
    };
  });
  const text = results.map(result => typeof result?.text === 'string' ? result.text : '').join('');
  const latest = utterances.at(-1);
  return {
    type: 'result', text: text || utterances.map(utterance => utterance.text).join(''),
    utterances, final, duration: numeric(payload.audio_info?.duration),
    attributes: latest?.attributes || { age: null, gender: null, emotion: null, speaker: null, speechRate: null, volume: null },
  };
}
