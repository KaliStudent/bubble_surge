const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')

require.extensions['.ts'] = (module, filename) => {
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 },
  })
  module._compile(outputText, filename)
}

const { Grid } = require('../src/core/Grid.ts')
const { CAMPAIGN_LEVELS, generateLevel } = require('../src/game/LevelManager.ts')
const { recordWin } = require('../src/game/ProgressStore.ts')
const config = { canvasWidth: 720, canvasHeight: 1080, bubbleRadius: 32,
  gridCols: 10, gridRows: 14, shootSpeed: 1850 }

test('thirty seeded stages are stable, dense, distinct, and attached', () => {
  assert.equal(CAMPAIGN_LEVELS, 30)
  const signatures = new Set()
  for (let id = 1; id <= CAMPAIGN_LEVELS; id++) {
    const level = generateLevel(id, 10)
    const grid = new Grid(config)
    grid.loadLevel(level.layers[0], level.cores)
    assert.equal(level.layers.length, 1)
    assert.equal(grid.findFloatingClusters().length, 0, `level ${id} has floating bubbles`)
    assert.equal(grid.getActiveColors().length, 5)
    assert.ok(grid.getAllBubbles().length >= 38, `level ${id} is too sparse`)
    assert.equal(grid.getAllBubbles().filter(b => b.core).length, level.cores.length)
    if (level.goal === 'cores') assert.ok(level.cores.length > 0)
    signatures.add(level.layers[0].map(row => row.map(Boolean).join('')).join('|'))
    assert.deepEqual(generateLevel(id, 10).layers, level.layers)
  }
  assert.ok(signatures.size >= 8, 'most level silhouettes should be distinct')
})

test('queue colors stay useful and shots find a legal cell when a local pocket is full', () => {
  const grid = new Grid(config)
  grid.loadLevel(generateLevel(1, 10).layers[0])
  assert.equal(grid.getUsefulColors().length, 5)
  const target = grid.cellToPixel(0, 5)
  const landing = grid.findNearestEmptyCell(target.x, target.y)
  assert.ok(landing)
  assert.equal(grid.getCell(landing.row, landing.col), null)
  assert.ok(landing.row === 0 || grid.getNeighbors(landing.row, landing.col).some(n => grid.getCell(n.row, n.col)))
})

test('the dense bridge still offers a cascade cut', () => {
  const level = generateLevel(2, 10)
  let found = false
  for (let row = 0; row < level.layers[0].length && !found; row++) {
    for (let col = 0; col < 10 && !found; col++) {
      const grid = new Grid(config)
      grid.loadLevel(level.layers[0], level.cores)
      if (!grid.getCell(row, col)) continue
      const burst = grid.resolveBurst(grid.findColorCluster(row, col))
      found = burst.dropped.length >= 2
    }
  }
  assert.ok(found)
})

test('a freed signal core pulses through two hex rings', () => {
  const grid = new Grid(config)
  grid.loadLevel([
    Array.from({ length: 10 }, () => 'red'),
    Array.from({ length: 10 }, () => 'blue'),
    Array.from({ length: 10 }, () => 'green'),
  ], [{ row: 1, col: 4 }])
  const burst = grid.resolveBurst([{ row: 1, col: 4 }])
  assert.equal(burst.cores, 1)
  assert.ok(burst.popped.length >= 7)
  assert.equal(grid.getCell(1, 4), null)
  assert.equal(grid.getCell(1, 6), null)
})

test('signal cores move with the grid during row descent', () => {
  const grid = new Grid(config)
  const level = generateLevel(2, 10)
  grid.loadLevel(level.layers[0], level.cores)
  assert.equal(grid.addRowFromTop(['red', 'blue']), true)
  for (const core of level.cores) assert.equal(grid.getCell(core.row + 1, core.col)?.core, true)
})

test('row descent refuses to discard existing bottom-row bubbles', () => {
  const grid = new Grid(config)
  grid.loadLevel(generateLevel(1, 10).layers[0])
  const bottom = grid.cellToPixel(13, 2)
  grid.setCell(13, 2, { color: 'red', position: bottom, gridCell: { row: 13, col: 2 }, active: true })
  const count = grid.getAllBubbles().length
  assert.equal(grid.addRowFromTop(['red']), false)
  assert.equal(grid.getAllBubbles().length, count)
})

test('winning unlocks the next stage and keeps better prior results', () => {
  global.localStorage = { setItem() {} }
  const initial = { unlockedLevel: 1, levels: {}, endlessBest: 0 }
  const first = recordWin(initial, 1, 3, 1000, 12)
  const replay = recordWin(first, 1, 1, 500, 20)
  assert.equal(replay.unlockedLevel, 2)
  assert.deepEqual(replay.levels[1], { stars: 3, bestScore: 1000, bestShots: 12 })
})
