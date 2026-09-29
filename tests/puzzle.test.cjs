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
const { createVelocity, updateBubblePosition, checkCollision } = require('../src/core/Physics.ts')
const { CAMPAIGN_LEVELS, generateLevel } = require('../src/game/LevelManager.ts')
const config = { canvasWidth: 720, canvasHeight: 1080, bubbleRadius: 32,
  gridCols: 10, gridRows: 14, shootSpeed: 1850 }

function tryShot(levelId, color, angle) {
  const level = generateLevel(levelId, 10)
  const grid = new Grid(config)
  grid.loadLevel(level.layers[0], level.cores)
  const shot = { color, position: { x: 360, y: 992 }, velocity: createVelocity(angle, 1850), active: true }
  let hit = null
  for (let step = 0; step < 200 && shot.active && !hit; step++) {
    updateBubblePosition(shot, 1 / 120, config)
    hit = grid.getAllBubbles().find(b => checkCollision(shot.position, b.position, 32))
  }
  const candidates = hit ? grid.getNeighbors(hit.gridCell.row, hit.gridCell.col) : []
  const landing = candidates.filter(c => !grid.getCell(c.row, c.col))
    .sort((a, b) => {
      const pa = grid.cellToPixel(a.row, a.col), pb = grid.cellToPixel(b.row, b.col)
      return (pa.x - shot.position.x) ** 2 + (pa.y - shot.position.y) ** 2
        - (pb.x - shot.position.x) ** 2 - (pb.y - shot.position.y) ** 2
    })[0] ?? grid.findNearestEmptyCell(shot.position.x, shot.position.y)
  if (!landing) return { matched: false, cores: 0 }
  grid.setCell(landing.row, landing.col, { color, gridCell: landing, position: grid.cellToPixel(landing.row, landing.col), active: true })
  const cluster = grid.findColorCluster(landing.row, landing.col)
  return cluster.length >= 3
    ? { matched: true, cores: grid.resolveBurst(cluster).cores }
    : { matched: false, cores: 0 }
}

test('every full stage has a physically reachable opening match', () => {
  for (let levelId = 1; levelId <= CAMPAIGN_LEVELS; levelId++) {
    let matches = 0
    let coreSolutions = 0
    for (const color of generateLevel(levelId, 10).colorsAvailable) {
      for (let angle = 0.18; angle < Math.PI - 0.18; angle += 0.035) {
        const shot = tryShot(levelId, color, angle)
        if (shot.matched) matches++
        if (shot.cores > 0) coreSolutions++
      }
    }
    assert.ok(matches > 0, `level ${levelId} has no physical opening match`)
    if (generateLevel(levelId, 10).goal === 'cores') {
      assert.ok(coreSolutions > 0, `level ${levelId} has no physical shot that frees a core`)
    }
  }
})
