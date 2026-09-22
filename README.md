# Blue / Glass Interface

A Three.js big-screen display built around a stationary ice-blue glass ring, the large THE BLUE RING title, and a floating information HUD.

The ring combines a transmissive shell, beveled highlights, and an internal light channel. Layered curved light-field surfaces, sweeping foreground contours, distant elliptical arcs, and sparse drifting particles provide depth without rotating the ring. The curves themselves continuously bend, rise, and drift at different speeds, while blue-silver highlights travel along them; no straight grid or scanning bars remain. The right-hand HUD shows sampled rendering FPS, frame-rate history, session duration, and optical material information; the footer shows local time. FPS is measured from rendered frames rather than simulated. There are no state-selection or motion-preview controls on the default screen.

## Retained interaction support

`src/preview.js` exports `PRESETS`, `ACTIONS`, `HUD_OPTIONS`, and `createHudOptions`. The triangle/square/circle/cross choice style remains available as an opt-in component and is not mounted by default. Pass a container, an options list, and an `onSelect` callback when a future business feature needs choices. The returned controller supports `setSelected(id)` and `destroy()`. Selection also emits a bubbling `ring:option-select` event containing the selected id. No global numeric shortcuts are registered.

The existing normal/risk/critical colors and flow/pulse modes remain available through the exported `setRingState(state, motion)` function in `src/main.js`, or a `ring:set-state` window event with `{ state, motion }` in its detail. Invalid preset names are rejected. The default is the normal blue ring with flowing light. Reduced-motion preferences freeze scene animation.

## Development

```bash
npm install
npm run dev
npm run build
```

- `src/main.js`: scene, glass materials, state transitions, and live display metrics.
- `src/shaders.js`: internal light channel and animated background.
- `src/preview.js`: reusable state presets and opt-in interaction choices.
- `src/style.css`: big-screen composition and reusable floating HUD styles.

## Streaming voice recognition

The screen now includes an explicit microphone button, live transcription, and per-utterance acoustic estimates (age, voice-gender label, emotion, speaker). Local voice activity switches the ring between flow and pulse. A same-origin BFF reads `DOUBAO_API_KEY` from `.env`; credentials never enter the browser.

See [docs/voice-asr.md](docs/voice-asr.md) for architecture, configuration, VAD thresholds, lifecycle, dependencies, and validation limits. `npm run dev` starts both the page and BFF; `npm run build && npm start` serves the built application with the BFF. The previous display and reusable HUD options remain available.

## Streaming voice synthesis

The BFF also includes the bidirectional Doubao TTS protocol adapter and streams 24 kHz PCM to the browser. Configure `DOUBAO_TTS_SPEAKER`, then call `window.blueTts.speak(text)` from a user gesture. The TTS capability is intentionally standalone for now and is not automatically connected to the ASR loop. See [docs/voice-tts.md](docs/voice-tts.md).
