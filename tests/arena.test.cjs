const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')

// Exercise the source directly using the project's existing TypeScript dependency.
require.extensions['.ts'] = (module, filename) => {
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 },
  })
  module._compile(outputText, filename)
}
const { Grid } = require('../src/core/Grid.ts')
const { getArenaBounds } = require('../src/core/Arena.ts')
const { createVelocity, updateBubblePosition, getAimLinePoints } = require('../src/core/Physics.ts')
const { SpawnSequence } = require('../src/game/SpawnSequence.ts')
const config = { canvasWidth: 720, canvasHeight: 1080, bubbleRadius: 32,
  gridCols: 10, gridRows: 14, shootSpeed: 1850 }

test('every hex cell fits inside the rails and round-trips to its exact cell', () => {
  const grid = new Grid(config)
  const bounds = getArenaBounds(config)
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      const pos = grid.cellToPixel(row, col)
      assert.ok(pos.x - 32 >= bounds.left && pos.x + 32 <= bounds.right)
      assert.ok(pos.y - 32 >= bounds.top)
      assert.deepEqual(grid.pixelToCell(pos.x, pos.y), { row, col })
    }
  }
  assert.equal(grid.cellToPixel(0, 0).x - 32, bounds.left)
  assert.equal(grid.cellToPixel(1, 9).x + 32, bounds.right)
})

test('both side walls reflect shots and preserve travel beyond the collision point', () => {
  const { left, right } = getArenaBounds(config)
  for (const direction of [-1, 1]) {
    const edge = direction < 0 ? left + 32 : right - 32
    const shot = { position: { x: edge, y: 700 }, velocity: { x: direction * 100, y: -50 }, active: true }
    updateBubblePosition(shot, 0.05, config)
    assert.equal(shot.velocity.x, -direction * 100)
    assert.equal(shot.position.x, edge - direction * 5)
  }
})

test('ceiling stops shots at row zero rather than above the visible arena', () => {
  const grid = new Grid(config)
  const shot = { position: { x: 360, y: 153 }, velocity: { x: 0, y: -1850 }, active: true }
  updateBubblePosition(shot, 1 / 120, config)
  assert.equal(shot.active, false)
  assert.equal(shot.position.y, getArenaBounds(config).top + 32)
  assert.equal(grid.pixelToCell(shot.position.x, shot.position.y).row, 0)
})

test('aim preview agrees with simulated bank shots through to the ceiling', () => {
  for (const angle of [0.22, 0.55, 1, Math.PI / 2, 2.2, 2.7, 2.9]) {
    const start = { x: 360, y: 992 }
    const points = getAimLinePoints(start, angle, config, [], 20)
    const shot = { position: { ...start }, velocity: createVelocity(angle, 1850), active: true }
    for (let i = 0; i < 2000 && shot.active; i++) updateBubblePosition(shot, 1 / 240, config)
    const last = points.at(-1)
    assert.equal(last.y, 152)
    assert.ok(Math.abs(last.x - shot.position.x) < 10, `angle ${angle}: preview ${last.x}, shot ${shot.position.x}`)
  }
})

test('stagger grows from zero to full size and fires exactly one cue per bubble', () => {
  const sequence = new SpawnSequence()
  const cues = []
  assert.equal(sequence.scale(0), 0)
  sequence.update(0.014, 50, index => cues.push(index))
  assert.ok(sequence.scale(0) > 0 && sequence.scale(0) < 1)
  assert.equal(sequence.scale(1), 0)
  let done = false
  for (let frame = 0; frame < 100 && !done; frame++) {
    done = sequence.update(0.05, 50, index => cues.push(index))
  }
  assert.ok(done)
  assert.deepEqual(cues, Array.from({ length: 50 }, (_, i) => i))
  for (let i = 0; i < 50; i++) assert.equal(sequence.scale(i), 1)
  sequence.update(1, 50, index => cues.push(index))
  assert.equal(cues.length, 50)
  sequence.reset()
  assert.equal(sequence.scale(0), 0)
  const nextLayer = []
  sequence.update(0.05, 10, index => nextLayer.push(index))
  assert.deepEqual(nextLayer, [0, 1])
})
