// The block matrix: one fullscreen WebGL2 shader, one draw call per frame.
// It draws the tile grid, the rising lit band, cursor glow, section waves, the LED ticker
// and every card mid-build (tiles flipping from grid to card fill), clipped to the card's exact rect.
// ponytail: raw WebGL2 instead of three.js. It's one shader, so three would add ~135 KB for ~40 lines of setup.
// Switch to three's WebGPURenderer only if we need meshes or WebGPU-specific speed.

const MAX_CARDS = 32

const VERT = `#version 300 es
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`

const FRAG = `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform float uDpr, uTile, uTime, uScroll, uOffX, uRise, uWave, uGlow, uLite;
uniform vec2 uMouse;
uniform int uCount;
uniform vec4 uRect[${MAX_CARDS}];
uniform float uProg[${MAX_CARDS}];
uniform vec4 uTicker;      // center x, center y, width, height (css px); width 0 = none
uniform float uTickOff, uTickAngle;
uniform sampler2D uText;
uniform vec2 uTextSize;
out vec4 o;

const vec3 BASE  = vec3(11., 11., 13.) / 255.;
const vec3 TILE  = vec3(20., 20., 24.) / 255.;
const vec3 CARD  = vec3(23., 23., 28.) / 255.;
const vec3 LINE  = vec3(42., 42., 49.) / 255.;
const vec3 RED   = vec3(255., 61., 139.) / 255.;   // Beans pink
const vec3 AMBER = vec3(255., 181., 71.) / 255.;
const float PI = 3.14159265;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

void main() {
  vec2 px = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uDpr;   // css px, y down
  vec2 vp = uRes / uDpr;

  // LED ticker band, drawn in its own rotated frame.
  if (uTicker.z > 0.0) {
    vec2 rp = px - uTicker.xy;
    float ca = cos(uTickAngle), sa = sin(uTickAngle);
    rp = vec2(ca * rp.x + sa * rp.y, -sa * rp.x + ca * rp.y);
    if (abs(rp.y) < uTicker.w * 0.5 && abs(rp.x) < uTicker.z * 0.5 + 64.0) {
      float led = uTicker.w / (uTextSize.y + 4.0);
      vec2 lp = (rp + uTicker.zw * 0.5) / led;
      vec2 lc = floor(lp);
      float row = lc.y - 2.0;
      float on = 0.0;
      if (row >= 0.0 && row < uTextSize.y)
        on = texture(uText, vec2((lc.x + floor(uTickOff) + 0.5) / uTextSize.x, (row + 0.5) / uTextSize.y)).r;
      float d = smoothstep(0.44, 0.30, length(fract(lp) - 0.5));
      vec3 lit = mix(vec3(0.17, 0.03, 0.09), mix(AMBER, RED, 0.2 + 0.2 * hash(lc)), on);
      o = vec4(mix(vec3(0.05, 0.03, 0.045), lit, d) + on * d * 0.12, 1.0);
      return;
    }
  }

  vec2 g = vec2(px.x - uOffX, px.y + uScroll) / uTile;   // page-space grid: tiles scroll with content
  vec2 cell = floor(g), f = fract(g);
  float gap = 1.0 / uTile;
  bool inGap = f.x < gap || f.y < gap;
  float h = hash(cell);
  vec3 col = inGap ? BASE : TILE * (0.9 + 0.2 * h);
  float lit = 0.0;
  vec3 litCol = RED;

  // Lit band climbing from the bottom of the screen.
  float sy = 1.0 - ((cell.y + 0.5) * uTile - uScroll) / vp.y;
  float edge = uRise + (hash(vec2(cell.x, 7.0)) - 0.5) * 0.1;
  if (sy < edge) {
    float depth = clamp((edge - sy) / max(edge, 0.001), 0.0, 1.0);
    float rate = uLite > 0.5 ? 0.6 : 1.2 + 2.0 * h;
    float flick = hash(cell + floor(uTime * rate + h * 9.0));
    float on = step(0.8 - 0.4 * depth * depth, flick);                   // sparse near the edge, denser at the bottom
    lit = on * (0.12 + 0.4 * flick) * smoothstep(0.0, 0.35, depth) * (0.55 + 0.45 * (1.0 - sy));
    litCol = mix(RED, AMBER, hash(cell + 3.1) * 0.7);
  }

  // Diagonal wave as a new section comes in.
  if (uWave > 0.0 && uWave < 1.0) {
    vec2 sc = vec2((cell.x * uTile + uOffX) / vp.x, (cell.y * uTile - uScroll) / vp.y);
    float w = exp(-pow(((sc.x + sc.y) * 0.5 - (uWave * 1.5 - 0.25)) * 12.0, 2.0)) * (0.35 + 0.65 * h);
    if (w > lit) { lit = w * 0.8; litCol = mix(RED, AMBER, h); }
  }

  // Cursor: nearby tiles brighten, then settle.
  if (uGlow > 0.01) {
    float md = length(cell + 0.5 - vec2(uMouse.x - uOffX, uMouse.y + uScroll) / uTile);
    float c = uGlow * max(0.0, 1.0 - md / 3.5) * (0.55 + 0.45 * h);
    if (c > lit) { lit = c; litCol = AMBER; }
  }

  // Cards being built or broken.
  for (int i = 0; i < ${MAX_CARDS}; i++) {
    if (i >= uCount) break;
    vec4 r = uRect[i];
    float p = uProg[i];
    vec2 q = px - r.xy;
    if (q.x < 0.0 || q.y < 0.0 || q.x > r.z || q.y > r.w) {   // outside: pulse whole tiles around the card once
      vec2 cc = vec2((cell.x + 0.5) * uTile + uOffX, (cell.y + 0.5) * uTile - uScroll) - r.xy;
      float dist = length(max(max(-cc, cc - r.zw), 0.0)) / uTile;
      float ring = sin(p * PI) * max(0.0, 1.0 - dist / 3.0) * (0.4 + 0.6 * h);
      if (ring > lit) { lit = ring * 0.7; litCol = RED; }
      continue;
    }
    vec2 c0 = floor(vec2(r.x - uOffX, r.y + uScroll) / uTile);
    vec2 lc = cell - c0;
    vec2 nt = ceil(r.zw / uTile) + 1.0;
    float order = (lc.x + lc.y) / (nt.x + nt.y) * 0.8 + h * 0.2;   // sweep from the top-left corner
    float t = clamp((p * 1.2 - order) / 0.2, 0.0, 1.0);
    if (t <= 0.0) continue;
    if (t >= 1.0) {
      bool border = q.x < 1.0 || q.y < 1.0 || q.x > r.z - 1.0 || q.y > r.w - 1.0;
      o = vec4(border ? LINE : CARD, 1.0);
      return;
    }
    float s = abs(cos(t * PI));                 // tile flips: full, edge-on, full
    if (!inGap && abs(f.y - 0.5) * 2.0 < s) {
      col = t < 0.5 ? TILE * 1.4 : mix(AMBER, CARD, smoothstep(0.5, 1.0, t));
      lit = 0.0;
    } else col = BASE;
  }

  if (!inGap) col = mix(col, litCol, clamp(lit, 0.0, 1.0) * 0.75);
  col += (hash(px + fract(uTime) * 91.0) - 0.5) * 0.018;                // faint grain
  o = vec4(col, 1.0);
}`

export function createMatrix(canvas) {
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'low-power' })
  if (!gl) return null
  const sh = (type, src) => {
    const s = gl.createShader(type)
    gl.shaderSource(s, src); gl.compileShader(s)
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s))
    return s
  }
  const prog = gl.createProgram()
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT))
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG))
  gl.linkProgram(prog)
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog))
  gl.useProgram(prog)
  gl.bindVertexArray(gl.createVertexArray())
  const U = new Proxy({}, { get: (c, k) => c[k] ?? (c[k] = gl.getUniformLocation(prog, k)) })

  const coarse = matchMedia('(pointer: coarse)').matches
  const state = { rise: 0.18, wave: 0, glow: 0, mouse: [-999, -999], cards: [], ticker: null, tickOff: 0, tickSpeed: 0 }
  let tile = 24, offX = 0, dpr = 1, textW = 1, textH = 1
  const rects = new Float32Array(MAX_CARDS * 4), progs = new Float32Array(MAX_CARDS)

  const tex = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_2D, tex)
  for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST],
    [gl.TEXTURE_WRAP_S, gl.REPEAT], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 1, 1, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array([0]))

  // Rasterise ticker text to 1 texel per LED with the pixel font, then threshold it.
  function setTickerText(text) {
    const c = document.createElement('canvas'), x = c.getContext('2d')
    x.font = '8px Silkscreen'
    textW = Math.ceil(x.measureText(text).width); textH = 9
    c.width = textW; c.height = textH
    x.font = '8px Silkscreen'; x.textBaseline = 'top'; x.fillStyle = '#fff'
    x.fillText(text, 0, 1)
    const src = x.getImageData(0, 0, textW, textH).data, bits = new Uint8Array(textW * textH)
    for (let i = 0; i < bits.length; i++) bits[i] = src[i * 4 + 3] > 110 ? 255 : 0
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, textW, textH, 0, gl.RED, gl.UNSIGNED_BYTE, bits)
  }

  function resize() {
    dpr = Math.min(devicePixelRatio || 1, coarse ? 1 : 1.5)   // cap fill-rate on phones
    canvas.width = Math.round(innerWidth * dpr)
    canvas.height = Math.round(innerHeight * dpr)
    gl.viewport(0, 0, canvas.width, canvas.height)
    tile = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--t')) || 24
    const wrap = document.querySelector('.wrap')
    offX = wrap ? wrap.getBoundingClientRect().left % tile : 0   // line the grid up with the content column
  }

  function render(time, dt, scroll) {
    let n = 0
    for (const c of state.cards) {
      if (n === MAX_CARDS) break
      if (c.p <= 0 || c.p >= 1 && c.el.classList.contains('built') || !c.el.isConnected) continue
      const r = c.el.getBoundingClientRect()
      if (r.bottom < 0 || r.top > innerHeight) continue
      rects.set([r.left, r.top, r.width, r.height], n * 4); progs[n++] = c.p
    }
    state.glow *= Math.pow(0.05, dt)                    // settles in about a second
    state.tickOff += dt * (8 + state.tickSpeed)
    const t = state.ticker
    gl.uniform2f(U.uRes, canvas.width, canvas.height)
    gl.uniform1f(U.uDpr, dpr); gl.uniform1f(U.uTile, tile); gl.uniform1f(U.uTime, time)
    gl.uniform1f(U.uScroll, scroll); gl.uniform1f(U.uOffX, offX); gl.uniform1f(U.uRise, state.rise)
    gl.uniform1f(U.uWave, state.wave); gl.uniform1f(U.uGlow, state.glow); gl.uniform1f(U.uLite, coarse ? 1 : 0)
    gl.uniform2f(U.uMouse, state.mouse[0], state.mouse[1])
    gl.uniform1i(U.uCount, n); gl.uniform4fv(U.uRect, rects); gl.uniform1fv(U.uProg, progs)
    if (t) {
      const r = t.getBoundingClientRect()
      gl.uniform4f(U.uTicker, r.left + r.width / 2, r.top + r.height / 2, t.offsetWidth, t.offsetHeight)
    } else gl.uniform4f(U.uTicker, 0, 0, 0, 0)
    gl.uniform1f(U.uTickOff, state.tickOff % textW); gl.uniform1f(U.uTickAngle, -2 * Math.PI / 180)
    gl.uniform2f(U.uTextSize, textW, textH); gl.uniform1i(U.uText, 0)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  resize()
  return { state, render, resize, setTickerText, gl }
}
