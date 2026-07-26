/**
 * Physarum Oracle
 *
 * Particle sensing, steering, deposition and diffusion are adapted directly
 * from Amanda Ghassaei's MIT-licensed gpu-io Physarum example:
 * https://github.com/amandaghassaei/gpu-io/tree/main/examples/physarum
 */
import {
  GPUComposer,
  GPUProgram,
  GPULayer,
  FLOAT,
  INT,
  BOOL,
  REPEAT,
  LINEAR,
  addValueProgram,
} from 'gpu-io'
import './style.css'

const app = document.querySelector('#app')
const canvas = document.querySelector('#field')
const linksEl = document.querySelector('#links')
const lawEl = document.querySelector('#law')
const demoEl = document.querySelector('#demo')
const resultEl = document.querySelector('#result')
const scoreEl = document.querySelector('#score')
const efficiencyEl = document.querySelector('#efficiency')
const resetButton = document.querySelector('#reset')
const againButton = document.querySelector('#again')
const retryButton = document.querySelector('#retry')
const errorEl = document.querySelector('#error')

const zh = navigator.language.toLowerCase().startsWith('zh')
if (!zh) {
  canvas.setAttribute('aria-label', 'Interactive slime-mold transport network')
  document.querySelector('.po__gesture').textContent = 'Two-finger tap · change growth law'
  againButton.textContent = 'Grow again'
  errorEl.querySelector('p').textContent = 'This device cannot grow the network yet'
  retryButton.textContent = 'Retry'
}

const PRESETS = [
  { name: 'Fibers', sensorDistance: 18, sensorAngle: 5.5, stepSize: 2, rotationAngle: 45 },
  { name: 'Fingerprint', sensorDistance: 14, sensorAngle: 70, stepSize: 1.5, rotationAngle: -25 },
  { name: 'Honeycomb', sensorDistance: 7.5, sensorAngle: 90, stepSize: 2, rotationAngle: -45 },
]
const params = { decayFactor: 0.9, depositAmount: 4, particleDensity: innerWidth <= 430 ? 0.22 : 0.16, renderAmplitude: 0.03, ...PRESETS[0] }
const COMPONENTS = 4
const activePointers = new Map()
const BEACONS = [
  [0.24, 0.38],
  [0.76, 0.33],
  [0.68, 0.68],
  [0.28, 0.73],
]
const beaconEls = [...document.querySelectorAll('.po__beacons i')]
const linkedBeacons = new Set([0])

let composer
let particlePositions
let particleHeading
let trail
let updateParticles
let deposit
let diffuse
let render
let frameId = 0
let resizeTimer = 0
let isVisible = false
let phase = 'idle'
let presetIndex = 0
let pathDistance = 0
let inputBursts = 0
let demoProgress = 0
let lastToneAt = 0
let audioContext
let completionTimer = 0

function tone(freq, duration = 0.07, delay = 0, volume = 0.012) {
  try {
    audioContext ??= new AudioContext()
    if (audioContext.state === 'suspended') void audioContext.resume()
    const oscillator = audioContext.createOscillator()
    const gain = audioContext.createGain()
    const time = audioContext.currentTime + delay
    oscillator.type = 'sine'
    oscillator.frequency.setValueAtTime(freq, time)
    oscillator.frequency.exponentialRampToValueAtTime(freq * 1.18, time + duration)
    gain.gain.setValueAtTime(0.0001, time)
    gain.gain.exponentialRampToValueAtTime(volume, time + 0.014)
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration)
    oscillator.connect(gain).connect(audioContext.destination)
    oscillator.start(time)
    oscillator.stop(time + duration + 0.02)
  } catch {}
}

function getSize() {
  const rect = app.getBoundingClientRect()
  return { width: Math.max(2, Math.round(rect.width)), height: Math.max(2, Math.round(rect.height)) }
}

function particleArrays() {
  const count = Math.max(1024, Math.round(canvas.width * canvas.height * params.particleDensity))
  const positions = new Float32Array(count * COMPONENTS)
  const heading = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    positions[i * COMPONENTS] = Math.random() * canvas.width
    positions[i * COMPONENTS + 1] = Math.random() * canvas.height
    heading[i] = Math.random() * Math.PI * 2
  }
  return { count, positions, heading }
}

function createSimulation() {
  composer = new GPUComposer({ canvas })
  composer.resize([getSize().width, getSize().height])
  const initial = particleArrays()
  particlePositions = new GPULayer(composer, {
    name: 'particlesPositions',
    dimensions: initial.count,
    numComponents: COMPONENTS,
    type: FLOAT,
    numBuffers: 2,
    array: initial.positions,
  })
  particleHeading = new GPULayer(composer, {
    name: 'particlesHeading',
    dimensions: initial.count,
    numComponents: 1,
    type: FLOAT,
    numBuffers: 2,
    array: initial.heading,
  })

  updateParticles = new GPUProgram(composer, {
    name: 'updateParticles',
    fragmentShader: `
      in vec2 v_uv;
      #define TWO_PI 6.28318530718
      uniform sampler2D u_particlesHeading;
      uniform sampler2D u_particlesPositions;
      uniform sampler2D u_trail;
      uniform vec2 u_dimensions;
      uniform float u_sensorAngle;
      uniform float u_sensorDistance;
      uniform float u_rotationAngle;
      uniform bool u_randomDir;
      uniform float u_stepSize;
      layout (location = 0) out float out_heading;
      layout (location = 1) out vec4 out_position;
      float sense(vec2 position, float angle) {
        vec2 p = position + u_sensorDistance * vec2(cos(angle), sin(angle));
        return texture(u_trail, p / u_dimensions).x;
      }
      void main() {
        float heading = texture(u_particlesHeading, v_uv).r;
        vec4 info = texture(u_particlesPositions, v_uv);
        vec2 absolute = info.xy;
        vec2 displacement = info.zw;
        vec2 position = absolute + displacement;
        float middleState = sense(position, heading);
        float leftState = sense(position, heading + u_sensorAngle);
        float rightState = sense(position, heading - u_sensorAngle);
        float rightWeight = step(middleState, rightState);
        float leftWeight = step(middleState, leftState);
        heading += mix(
          rightWeight * mix(u_rotationAngle, -u_rotationAngle, float(u_randomDir)),
          mix(u_rotationAngle, -u_rotationAngle, rightWeight),
          abs(leftWeight - rightWeight)
        );
        heading = mod(heading + TWO_PI, TWO_PI);
        out_heading = heading;
        vec2 nextDisplacement = displacement + u_stepSize * vec2(cos(heading), sin(heading));
        float shouldMerge = step(30.0, dot(nextDisplacement, nextDisplacement));
        absolute = mod(absolute + shouldMerge * nextDisplacement + u_dimensions, u_dimensions);
        nextDisplacement *= 1.0 - shouldMerge;
        out_position = vec4(absolute, nextDisplacement);
      }`,
    uniforms: [
      { name: 'u_particlesHeading', value: 0, type: INT },
      { name: 'u_particlesPositions', value: 1, type: INT },
      { name: 'u_trail', value: 2, type: INT },
      { name: 'u_dimensions', value: [canvas.width, canvas.height], type: FLOAT },
      { name: 'u_sensorAngle', value: params.sensorAngle * Math.PI / 180, type: FLOAT },
      { name: 'u_sensorDistance', value: params.sensorDistance, type: FLOAT },
      { name: 'u_rotationAngle', value: params.rotationAngle * Math.PI / 180, type: FLOAT },
      { name: 'u_randomDir', value: false, type: BOOL },
      { name: 'u_stepSize', value: params.stepSize, type: FLOAT },
    ],
  })

  trail = new GPULayer(composer, {
    name: 'trail',
    dimensions: [canvas.width, canvas.height],
    numComponents: 1,
    type: FLOAT,
    filter: LINEAR,
    numBuffers: 2,
    wrapX: REPEAT,
    wrapY: REPEAT,
  })
  deposit = addValueProgram(composer, { name: 'deposit', type: trail.type, value: params.depositAmount })
  diffuse = new GPUProgram(composer, {
    name: 'diffuseAndDecay',
    fragmentShader: `
      in vec2 v_uv;
      uniform sampler2D u_trail;
      uniform float u_decayFactor;
      uniform vec2 u_pxSize;
      out float out_state;
      void main() {
        vec2 halfPx = u_pxSize / 2.0;
        float ne = texture(u_trail, v_uv + halfPx).x;
        float nw = texture(u_trail, v_uv + vec2(-halfPx.x, halfPx.y)).x;
        float se = texture(u_trail, v_uv + vec2(halfPx.x, -halfPx.y)).x;
        float sw = texture(u_trail, v_uv - halfPx).x;
        out_state = u_decayFactor * (ne + nw + se + sw) / 4.0;
      }`,
    uniforms: [
      { name: 'u_trail', value: 0, type: INT },
      { name: 'u_decayFactor', value: params.decayFactor, type: FLOAT },
      { name: 'u_pxSize', value: [1 / canvas.width, 1 / canvas.height], type: FLOAT },
    ],
  })
  render = new GPUProgram(composer, {
    name: 'renderTrail',
    fragmentShader: `
      in vec2 v_uv;
      uniform sampler2D u_trail;
      out vec4 out_color;
      void main() {
        float x = clamp(texture(u_trail, v_uv).x * 0.03, 0.0, 1.0);
        vec3 dark = vec3(0.008, 0.018, 0.011);
        vec3 glow = vec3(0.45, 0.92, 0.38);
        vec3 hot = vec3(0.94, 1.0, 0.91);
        vec3 color = mix(dark, glow, smoothstep(0.015, 0.42, x));
        color = mix(color, hot, smoothstep(0.42, 0.95, x));
        out_color = vec4(color, 1.0);
      }`,
    uniforms: [{ name: 'u_trail', value: 0, type: INT }],
  })
}

function resizeSimulation() {
  const { width, height } = getSize()
  composer.resize([width, height])
  const arrays = particleArrays()
  particlePositions.resize(arrays.count, arrays.positions)
  particleHeading.resize(arrays.count, arrays.heading)
  trail.resize([width, height])
  diffuse.setUniform('u_pxSize', [1 / width, 1 / height])
  updateParticles.setUniform('u_dimensions', [width, height])
}

function resetRound() {
  clearTimeout(completionTimer)
  phase = 'idle'
  pathDistance = 0
  inputBursts = 0
  demoProgress = 0
  linkedBeacons.clear()
  linkedBeacons.add(0)
  linksEl.textContent = '1/4'
  lawEl.textContent = PRESETS[presetIndex].name.toUpperCase()
  beaconEls.forEach((element, index) => {
    element.classList.toggle('po__beacon--linked', index === 0)
    element.classList.remove('po__beacon--pulse')
  })
  resultEl.hidden = true
  demoEl.hidden = false
  trail.clear()
  resizeSimulation()
}

function applyPreset() {
  Object.assign(params, PRESETS[presetIndex])
  updateParticles.setUniform('u_sensorAngle', params.sensorAngle * Math.PI / 180)
  updateParticles.setUniform('u_sensorDistance', params.sensorDistance)
  updateParticles.setUniform('u_rotationAngle', params.rotationAngle * Math.PI / 180)
  updateParticles.setUniform('u_stepSize', params.stepSize)
  resetRound()
  tone(330, 0.12)
  tone(495, 0.12, 0.08)
}

function beginRound() {
  if (phase !== 'idle') return
  phase = 'running'
  demoEl.hidden = true
  tone(180, 0.12)
}

function finishRound() {
  if (phase !== 'settling') return
  phase = 'result'
  const efficiency = Math.min(100, Math.round((520 / Math.max(520, pathDistance)) * 100))
  scoreEl.textContent = '100'
  efficiencyEl.textContent = `PATH ${String(efficiency).padStart(2, '0')}% EFFICIENT`
  resultEl.hidden = false
  tone(220, 0.14)
  tone(330, 0.14, 0.1)
  tone(440, 0.18, 0.2)
}

function injectPoint(point, diameter = 28) {
  composer.stepCircle({ program: deposit, input: trail, output: trail, position: point, diameter })
}

function injectSegment(from, to) {
  composer.stepSegment({ program: deposit, input: trail, output: trail, position1: to, position2: from, thickness: 28, endCaps: true })
}

function eventPoint(event) {
  const rect = canvas.getBoundingClientRect()
  return [event.clientX - rect.left, rect.height - (event.clientY - rect.top)]
}

function beaconPoint(index) {
  return [BEACONS[index][0] * canvas.width, (1 - BEACONS[index][1]) * canvas.height]
}

function distanceToSegment(point, from, to) {
  const dx = to[0] - from[0]
  const dy = to[1] - from[1]
  const lengthSquared = dx * dx + dy * dy
  if (!lengthSquared) return Math.hypot(point[0] - from[0], point[1] - from[1])
  const amount = Math.max(0, Math.min(1, ((point[0] - from[0]) * dx + (point[1] - from[1]) * dy) / lengthSquared))
  return Math.hypot(point[0] - (from[0] + amount * dx), point[1] - (from[1] + amount * dy))
}

function activateBeacon(index) {
  if (linkedBeacons.has(index) || phase === 'result') return
  linkedBeacons.add(index)
  linksEl.textContent = `${linkedBeacons.size}/4`
  const element = beaconEls[index]
  element.classList.add('po__beacon--linked', 'po__beacon--pulse')
  setTimeout(() => element.classList.remove('po__beacon--pulse'), 480)
  tone(280 + index * 80, 0.12, 0, 0.012)
  if (linkedBeacons.size === BEACONS.length) {
    phase = 'settling'
    completionTimer = setTimeout(finishRound, 1200)
  }
}

function checkBeacons(from, to = from) {
  BEACONS.forEach((_, index) => {
    if (!linkedBeacons.has(index) && distanceToSegment(beaconPoint(index), from, to) <= 42) activateBeacon(index)
  })
}

canvas.addEventListener('pointerdown', (event) => {
  canvas.setPointerCapture(event.pointerId)
  activePointers.set(event.pointerId, eventPoint(event))
  if (activePointers.size >= 2) {
    presetIndex = (presetIndex + 1) % PRESETS.length
    activePointers.clear()
    applyPreset()
    return
  }
  beginRound()
  const point = eventPoint(event)
  injectPoint(point)
  checkBeacons(point)
  inputBursts++
})
canvas.addEventListener('pointermove', (event) => {
  const previous = activePointers.get(event.pointerId)
  if (!previous || activePointers.size !== 1 || phase === 'result') return
  const point = eventPoint(event)
  injectSegment(previous, point)
  pathDistance += Math.hypot(point[0] - previous[0], point[1] - previous[1])
  checkBeacons(previous, point)
  activePointers.set(event.pointerId, point)
  if (performance.now() - lastToneAt > 130) {
    lastToneAt = performance.now()
    tone(220 + Math.min(160, pathDistance % 160), 0.05, 0, 0.006)
  }
})
for (const type of ['pointerup', 'pointercancel', 'pointerout']) {
  canvas.addEventListener(type, (event) => activePointers.delete(event.pointerId))
}

function demoSeed(now) {
  if (phase !== 'idle' || demoProgress > 2.2) return
  demoProgress += 0.016
  const rect = canvas.getBoundingClientRect()
  const t = Math.min(1, demoProgress / 1.8)
  injectPoint([rect.width * (0.3 + 0.42 * t), rect.height * (0.52 + 0.12 * Math.sin(t * Math.PI))], 24)
}

function simulationStep(now) {
  updateParticles.setUniform('u_randomDir', Math.random() < 0.5)
  composer.step({ program: updateParticles, input: [particleHeading, particlePositions, trail], output: [particleHeading, particlePositions] })
  composer.drawLayerAsPoints({
    layer: particlePositions,
    program: deposit,
    input: trail,
    output: trail,
    pointSize: 1,
    wrapX: true,
    wrapY: true,
  })
  composer.step({ program: diffuse, input: trail, output: trail })
  composer.step({ program: render, input: trail })
  demoSeed(now)
}

function loop(now) {
  if (isVisible && phase !== 'result') simulationStep(now)
  frameId = requestAnimationFrame(loop)
}

resetButton.addEventListener('pointerdown', (event) => {
  event.stopPropagation()
  resetRound()
})
againButton.addEventListener('pointerdown', resetRound)
retryButton.addEventListener('pointerdown', () => location.reload())
window.addEventListener('keydown', (event) => {
  if (event.key.toLowerCase() === 'r') resetRound()
})
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer)
  resizeTimer = setTimeout(() => resizeSimulation(), 180)
})
new IntersectionObserver(([entry]) => {
  const next = entry.isIntersecting && entry.intersectionRatio >= 0.35
  isVisible = next
}, { threshold: [0, 0.35, 0.7] }).observe(app)

try {
  createSimulation()
  resetRound()
  frameId = requestAnimationFrame(loop)
} catch (error) {
  console.error(error)
  errorEl.hidden = false
}

window.addEventListener('beforeunload', () => {
  cancelAnimationFrame(frameId)
  composer?.dispose()
})
