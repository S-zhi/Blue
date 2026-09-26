import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { surfaceVertex, lightChannelFragment, backgroundVertex, backgroundFragment, particleVertex, particleFragment } from './shaders.js';
import { PRESETS, ACTIONS } from './preview.js';
import { mountVoice } from './voice/index.js';
import { mountTts } from './tts/index.js';
import './style.css';

const canvas = document.querySelector('#scene');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x02050b);
const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.1, 100);
camera.position.set(0, 0, 7.8);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1;

// Studio reflections on the dark titanium bezel surrounding the plasma core.
const environment = new RoomEnvironment();
const pmrem = new THREE.PMREMGenerator(renderer);
const environmentMap = pmrem.fromScene(environment, .025);
scene.environment = environmentMap.texture;
environment.dispose();
pmrem.dispose();
scene.add(new THREE.HemisphereLight(0x95cfff, 0x030814, 1.5));
const key = new THREE.DirectionalLight(0xb9e8ff, 3);
key.position.set(-3, 4, 5);
scene.add(key);
const fill = new THREE.DirectionalLight(0x247cff, 2);
fill.position.set(4, -2, 3);
scene.add(fill);

const ring = new THREE.Group();
scene.add(ring);

// Closed annuli: both outlines stay smooth and uninterrupted.
function annulus(outer, inner, depth, bevel) {
  const shape = new THREE.Shape();
  shape.absarc(0, 0, outer, 0, Math.PI * 2, false);
  const hole = new THREE.Path();
  hole.absarc(0, 0, inner, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  return new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel,
    bevelSegments: 4, steps: 1, curveSegments: 180,
  });
}

const housing = new THREE.Mesh(annulus(1.905, 1.375, .13, .025),
  new THREE.MeshPhysicalMaterial({
    color: 0x030915, metalness: .9, roughness: .24,
    clearcoat: .6, envMapIntensity: .3,
  }));
housing.position.z = -.18;
ring.add(housing);

const flowUniforms = {
  uTime: { value: 0 }, uFlowTime: { value: 0 }, uPulseTime: { value: 0 },
  uMotion: { value: 0 },
  uDeepColor: { value: new THREE.Vector3(...PRESETS.normal.deep) },
  uMidColor: { value: new THREE.Vector3(...PRESETS.normal.mid) },
  uLightColor: { value: new THREE.Vector3(...PRESETS.normal.light) },
  uEdgeColor: { value: new THREE.Vector3(...PRESETS.normal.edge) },
};
let targetPreset = PRESETS.normal, targetMotion = 0;
let currentSpeed = PRESETS.normal.speed, currentPulseHz = PRESETS.normal.pulseHz;
const colorTargets = {};
const glassColorTarget = new THREE.Color(PRESETS.normal.glass);
const absorptionTarget = new THREE.Color(PRESETS.normal.absorption);
const colorFields = { uDeepColor: 'deep', uMidColor: 'mid', uLightColor: 'light', uEdgeColor: 'edge' };
const COLOR_TRANSITION_SECONDS = 7;
const colorTransition = {
  elapsed: COLOR_TRANSITION_SECONDS,
  starts: {},
  glassStart: new THREE.Color(PRESETS.normal.glass),
  absorptionStart: new THREE.Color(PRESETS.normal.absorption),
};
let glassMaterial;
// State transitions remain available for future business data, without demo UI.
export function setRingState(state = 'normal', motion = 'flow') {
  if (!Object.hasOwn(PRESETS, state) || !Object.hasOwn(ACTIONS, motion)) return false;
  const preset = PRESETS[state];
  targetPreset = preset;
  targetMotion = ACTIONS[motion].value;
  for (const uniform of Object.keys(colorFields)) {
    colorTransition.starts[uniform] = flowUniforms[uniform].value.clone();
  }
  colorTransition.glassStart.set(glassMaterial ? glassMaterial.color : PRESETS.normal.glass);
  colorTransition.absorptionStart.set(glassMaterial ? glassMaterial.attenuationColor : PRESETS.normal.absorption);
  colorTransition.elapsed = 0;
  glassColorTarget.set(preset.glass);
  absorptionTarget.set(preset.absorption);
  document.documentElement.style.setProperty('--state-accent', preset.accent);
  canvas.setAttribute('aria-label', `${preset.name}状态的透光玻璃圆环`);
  for (const [uniform, field] of Object.entries(colorFields)) {
    colorTargets[uniform] = new THREE.Vector3(...preset[field]);
  }
  return true;
}
setRingState();
function handleStateChange(event) {
  if (!event.detail || typeof event.detail !== 'object') return;
  setRingState(event.detail.state, event.detail.motion);
}
window.addEventListener('ring:set-state', handleStateChange);

const energyMaterial = new THREE.ShaderMaterial({
  uniforms: flowUniforms, vertexShader: surfaceVertex, fragmentShader: lightChannelFragment,
});
// Restore the transmissive shell over a separate luminous channel.
const energyCore = new THREE.Mesh(annulus(1.81, 1.47, .04, .012), energyMaterial);
energyCore.position.z = -.005;
ring.add(energyCore);
glassMaterial = new THREE.MeshPhysicalMaterial({
  color: PRESETS.normal.glass, metalness: 0, roughness: .028,
  transmission: 1, thickness: .12, ior: 1.46,
  attenuationColor: new THREE.Color(PRESETS.normal.absorption), attenuationDistance: 1.6,
  clearcoat: 1, clearcoatRoughness: .025, envMapIntensity: .38,
});
const glassShell = new THREE.Mesh(annulus(1.85, 1.43, .115, .025), glassMaterial);
glassShell.position.z = .065;
ring.add(glassShell);

const trimMaterial = new THREE.MeshPhysicalMaterial({
  color: 0x164778, metalness: .8, roughness: .21, envMapIntensity: .35,
});
for (const radius of [1.873, 1.407]) {
  const edge = new THREE.Mesh(new THREE.TorusGeometry(radius, .007, 8, 320), trimMaterial);
  edge.position.z = .17;
  ring.add(edge);
}

const backgroundUniforms = { uTime: flowUniforms.uTime, uAspect: { value: camera.aspect } };
const background = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
  uniforms: backgroundUniforms, vertexShader: backgroundVertex, fragmentShader: backgroundFragment,
  depthWrite: false, depthTest: false,
}));
background.frustumCulled = false;
background.renderOrder = -10;
scene.add(background);

const starGeometry = new THREE.BufferGeometry();
const particleCount = 80;
const positions = new Float32Array(particleCount * 3);
const seeds = new Float32Array(particleCount);
for (let i = 0; i < particleCount; i++) {
  positions[i * 3] = (Math.random() - .5) * 16;
  positions[i * 3 + 1] = (Math.random() - .5) * 10;
  positions[i * 3 + 2] = -1.5 - Math.random() * 5;
  seeds[i] = Math.random();
}
starGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
starGeometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
const particleUniforms = { uTime: flowUniforms.uTime, uPixelRatio: { value: renderer.getPixelRatio() } };
scene.add(new THREE.Points(starGeometry, new THREE.ShaderMaterial({
  uniforms: particleUniforms, vertexShader: particleVertex, fragmentShader: particleFragment,
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
})));

function resize() {
  const { clientWidth: width, clientHeight: height } = document.querySelector('#app');
  camera.aspect = width / height;
  // Keep the complete ring in frame, including portrait layouts.
  camera.position.z = Math.max(9.5, 2.35 / (Math.tan(THREE.MathUtils.degToRad(19)) * camera.aspect));
  ring.position.set(width <= 760 ? 0 : .34, width <= 760 ? 1.95 : 0, 0);
  const chatting = document.querySelector('#app').classList.contains('has-conversation');
  ring.scale.setScalar(chatting ? .42 : 1);
  if (chatting) {
    const halfHeight = camera.position.z * Math.tan(THREE.MathUtils.degToRad(19));
    ring.position.y = halfHeight * (width <= 760 ? .64 : .56);
  }
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  const center = ring.position.clone().project(camera);
  const edge = ring.position.clone().add(new THREE.Vector3(1.3 * ring.scale.x, 0, 0)).project(camera);
  const control = document.querySelector('#voice-toggle');
  control.style.left = `${(center.x + 1) * width / 2}px`;
  control.style.top = `${(1 - center.y) * height / 2}px`;
  control.style.width = control.style.height = `${(edge.x - center.x) * width}px`;
  backgroundUniforms.uAspect.value = camera.aspect;
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  particleUniforms.uPixelRatio.value = renderer.getPixelRatio();
  renderer.setSize(width, height);
}
addEventListener('resize', resize);
addEventListener('conversation:layout', resize);
resize();
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const clock = new THREE.Clock();
const sessionStart = performance.now();
let sampleStart = sessionStart, sampleFrames = 0;
const fpsLabel = document.querySelector('#render-fps');
const sessionLabel = document.querySelector('#session-time');
const localTime = document.querySelector('#local-time');
const frameHistory = document.querySelector('#frame-history');
const historyBars = Array.from({ length: 18 }, () => {
  const bar = document.createElement('span');
  frameHistory.append(bar);
  return bar;
});
const fpsHistory = [];
const timeFormat = new Intl.DateTimeFormat('zh-CN', {
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
});
function updateTelemetry(now) {
  sampleFrames++;
  const elapsed = now - sampleStart;
  if (elapsed < 1000) return;
  const fps = Math.round(sampleFrames * 1000 / elapsed);
  fpsLabel.textContent = String(fps);
  fpsHistory.push(fps);
  if (fpsHistory.length > historyBars.length) fpsHistory.shift();
  historyBars.forEach((bar, index) => {
    const sample = fpsHistory[index - (historyBars.length - fpsHistory.length)];
    bar.style.height = `${sample === undefined ? 2 : Math.max(3, Math.min(30, sample / 120 * 30))}px`;
    bar.style.opacity = sample === undefined ? '.18' : String(.3 + index / historyBars.length * .7);
  });
  const totalSeconds = Math.floor((now - sessionStart) / 1000);
  sessionLabel.textContent = [Math.floor(totalSeconds / 3600), Math.floor(totalSeconds / 60) % 60, totalSeconds % 60]
    .map(value => String(value).padStart(2, '0')).join(':');
  const date = new Date();
  localTime.textContent = timeFormat.format(date);
  localTime.dateTime = date.toISOString();
  sampleFrames = 0;
  sampleStart = now;
}
function resetFrameSample() {
  sampleStart = performance.now();
  sampleFrames = 0;
}
document.addEventListener('visibilitychange', resetFrameSample);
let frame;
function animate() {
  frame = requestAnimationFrame(animate);
  const delta = Math.min(clock.getDelta(), .05);
  const motionBlend = reducedMotion.matches ? 1 : 1 - Math.exp(-delta * 5);
  currentSpeed = THREE.MathUtils.lerp(currentSpeed, targetPreset.speed, motionBlend);
  currentPulseHz = THREE.MathUtils.lerp(currentPulseHz, targetPreset.pulseHz, motionBlend);
  flowUniforms.uMotion.value = THREE.MathUtils.lerp(flowUniforms.uMotion.value, targetMotion, motionBlend);
  colorTransition.elapsed = Math.min(COLOR_TRANSITION_SECONDS, colorTransition.elapsed + delta);
  const colorProgress = reducedMotion.matches ? 1 : colorTransition.elapsed / COLOR_TRANSITION_SECONDS;
  const colorBlend = colorProgress * colorProgress * (3 - 2 * colorProgress);
  for (const uniform of Object.keys(colorFields)) {
    flowUniforms[uniform].value.copy(colorTransition.starts[uniform]).lerp(colorTargets[uniform], colorBlend);
  }
  glassMaterial.color.copy(colorTransition.glassStart).lerp(glassColorTarget, colorBlend);
  glassMaterial.attenuationColor.copy(colorTransition.absorptionStart).lerp(absorptionTarget, colorBlend);
  if (!reducedMotion.matches) {
    flowUniforms.uTime.value += delta;
    // Integrating the speed preserves phase when changing states rapidly.
    flowUniforms.uFlowTime.value += delta * currentSpeed;
    flowUniforms.uPulseTime.value += delta * currentPulseHz * Math.PI * 2;
  }
  renderer.render(scene, camera);
  updateTelemetry(performance.now());
}
animate();
const unmountVoice = mountVoice();
const unmountTts = mountTts();
// Vite reloads must not leave old WebGL render loops or GPU resources alive.
if (import.meta.hot) import.meta.hot.dispose(() => {
  cancelAnimationFrame(frame);
  unmountVoice();
  unmountTts();
  document.removeEventListener('visibilitychange', resetFrameSample);
  frameHistory.replaceChildren();
  window.removeEventListener('ring:set-state', handleStateChange);
  removeEventListener('resize', resize);
  removeEventListener('conversation:layout', resize);
  scene.traverse(object => {
    object.geometry?.dispose();
    if (Array.isArray(object.material)) object.material.forEach(material => material.dispose());
    else object.material?.dispose();
  });
  environmentMap.dispose();
  renderer.dispose();
});
