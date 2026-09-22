// All motion happens in the materials; the indicator itself remains stationary.
export const surfaceVertex = /* glsl */ `
  varying vec3 vPosition;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vPosition = position;
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vView = -viewPosition.xyz;
    gl_Position = projectionMatrix * viewPosition;
  }
`;

// Broad internal illumination seen through the physical refractive shell.
export const lightChannelFragment = /* glsl */ `
  uniform float uFlowTime;
  uniform float uPulseTime;
  uniform float uMotion;
  uniform vec3 uDeepColor;
  uniform vec3 uLightColor;
  varying vec3 vPosition;
  void main() {
    float radius = length(vPosition.xy);
    float angle = atan(vPosition.y, vPosition.x);
    float phase = angle + uFlowTime;
    float current = pow(.5 + .5 * cos(phase), 6.0);
    float second = pow(.5 + .5 * cos(phase - 2.65), 11.0);
    float ribbon = .5 + .5 * sin(phase * 3.0 - radius * 42.0);
    float radial = smoothstep(1.465, 1.58, radius) * (1.0 - smoothstep(1.70, 1.825, radius));
    float pressure = .5 + .5 * sin(uPulseTime - (radius - 1.47) * 9.0);
    float pulse = mix(.94 + .06 * sin(uPulseTime), .42 + .58 * pressure, uMotion);
    vec3 color = mix(uDeepColor, uLightColor, .035 + .88 * current + .30 * second);
    color *= (.58 + radial * .9 + ribbon * .12) * pulse;
    color += uLightColor * .24 * current * current * radial;
    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export const backgroundVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, .999, 1.0);
  }
`;

// Curved field surfaces replace the grid and scan bars. Derivative-based
// strokes stay subpixel-smooth across viewports. Both the curve geometry
// and its highlights travel continuously at different speeds for layered depth.
export const backgroundFragment = /* glsl */ `
  uniform float uTime;
  uniform float uAspect;
  varying vec2 vUv;

  float contour(float field, float spacing) {
    float distance = abs(fract(field / spacing + .5) - .5) * spacing;
    float aa = max(fwidth(field), .00015);
    return 1.0 - smoothstep(aa * .15, aa * 1.15, distance);
  }
  float window(float value, float start, float end, float feather) {
    return smoothstep(start, start + feather, value)
      * (1.0 - smoothstep(end - feather, end, value));
  }
  float softLight(float distance, float width) {
    float normalized = distance / width;
    return exp(-normalized * normalized);
  }
  void main() {
    vec2 p = (vUv - .5) * vec2(uAspect, 1.0);
    float time = uTime * .28;
    vec3 color = vec3(.0009, .0016, .0033);

    // An atmospheric blue-silver wash gives the curves space to recede into.
    vec2 lightPosition = p - vec2(.24 + .035 * sin(time * .4), -.10 + .025 * cos(time * .55));
    float atmosphere = exp(-dot(lightPosition, lightPosition) * 3.6);
    float ambientDrift = .8 + .2 * sin(p.x * 2.0 + p.y * 3.0 + time);
    color += vec3(.0018, .0075, .014) * atmosphere * ambientDrift;

    // A broad flowing surface sweeps upward from the lower-left foreground.
    float warp = .032 * sin(p.x * 3.0 - time)
      + .018 * cos(p.x * 5.0 + time * .65);
    float bend = .17 + .025 * sin(time * .47);
    float lowerField = p.y + .33 + .028 * sin(time * .62)
      - bend * sin(p.x * 1.65 + .3 + .2 * sin(time * .51))
      - .16 * p.x * p.x + warp;
    float lowerWindow = window(lowerField, -.19, .16, .085);
    float lowerLines = contour(lowerField, .0145) * lowerWindow;
    float lowerTravel = pow(.5 + .5 * sin(p.x * 2.1 - time * 1.35 + lowerField * 12.0), 6.0);
    color += vec3(.006, .028, .052) * lowerLines * (.28 + lowerTravel * .8);
    // Soft ribbon reflection between the fine contours, without neon saturation.
    float lowerRibbon = softLight(lowerField - .025, .075) * (.25 + lowerTravel * .75);
    color += vec3(.002, .011, .021) * lowerRibbon;
    float crest = softLight(lowerField - .067, max(fwidth(lowerField), .0008));
    color += vec3(.012, .046, .076) * crest * (.3 + .7 * lowerTravel);

    // Elliptical contours wrap around the environment like a distant canopy.
    vec2 canopyCenter = vec2(-.57 + .052 * sin(time * .53), .62 + .040 * cos(time * .61));
    vec2 canopy = (p - canopyCenter) * vec2(.76 + .025 * sin(time * .4), 1.02);
    float upperField = length(canopy) + .018 * sin(p.x * 3.0 + time * .7);
    float upperWindow = window(upperField, .63, 1.10, .16);
    float upperLines = contour(upperField, .022) * upperWindow;
    float upperTravel = pow(.5 + .5 * cos(atan(canopy.y, canopy.x) * 3.0 + time), 8.0);
    float upperFade = smoothstep(-.30, .22, p.y);
    color += vec3(.008, .029, .049) * upperLines * (.32 + upperTravel) * upperFade;
    color += vec3(.001, .003, .006) * softLight(upperField - .86, .15) * upperFade;

    // Thin secondary arcs create depth on the far right, with a colder tint.
    vec2 sideCenter = vec2(.93 + .032 * cos(time * .67), -.42 + .028 * sin(time * .57));
    vec2 side = (p - sideCenter) * vec2(.87, 1.22);
    float sideField = length(side) + .014 * sin(p.y * 4.0 - time);
    float sideLines = contour(sideField, .026) * window(sideField, .47, .76, .12);
    color += vec3(.006, .028, .042) * sideLines * smoothstep(-.04, .6, p.x) * .4;

    // Leave calm negative space behind typography and retain a dark perimeter.
    float textZone = (1.0 - smoothstep(-.45, -.13, p.x)) * window(p.y, -.25, .32, .1);
    color *= 1.0 - .5 * textZone;
    float vignette = 1.0 - smoothstep(.26, .88, length((vUv - .5) * vec2(1.1, 1.0)));
    color *= .48 + .52 * vignette;
    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export const particleVertex = /* glsl */ `
  uniform float uTime;
  uniform float uPixelRatio;
  attribute float aSeed;
  varying float vBrightness;
  void main() {
    vec3 p = position;
    p.y = mod(p.y + 5.0 + uTime * (.018 + aSeed * .025), 10.0) - 5.0;
    p.x += sin(uTime * .055 + aSeed * 40.0 + p.y * .38) * .38;
    vec4 viewPosition = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * viewPosition;
    gl_PointSize = uPixelRatio * (1.1 + aSeed * 1.9);
    vBrightness = .07 + .23 * pow(.5 + .5 * sin(aSeed * 70.0 + uTime * .45), 2.0);
  }
`;
export const particleFragment = /* glsl */ `
  varying float vBrightness;
  void main() {
    float alpha = (1.0 - smoothstep(.08, .5, length(gl_PointCoord - .5))) * vBrightness;
    gl_FragColor = vec4(.18, .38, .58, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
