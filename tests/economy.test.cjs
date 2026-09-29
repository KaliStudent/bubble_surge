const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 },
}).outputText, filename)
const { freshProfile, normalizeProfile, rewardRun, buyCosmetic, claimMission } = require('../src/game/PlayerProfile.ts')
const { generateDaily, seededRandom, seedFromText } = require('../src/game/LevelManager.ts')
const { Grid } = require('../src/core/Grid.ts')
const day = '2026-09-28'
const run = { mode: 'campaign', level: 1, won: true, stars: 3, score: 5000, shots: 10, drops: 30, banks: 5, cores: 1, seconds: 50 }

test('first clears pay star bonuses once; replays and improvements pay the intended amount', () => {
  let first = rewardRun(freshProfile(day), { ...run, stars: 1 }, day)
  assert.equal(first.coins, 85)
  let improve = rewardRun(first.profile, run, day)
  assert.equal(improve.coins, 85)
  let replay = rewardRun(improve.profile, run, day)
  assert.equal(replay.coins, 35)
  assert.equal(replay.profile.total.wins, 3)
})
test('missions cannot be claimed early or twice and reset on UTC rollover', () => {
  const fresh = freshProfile(day)
  assert.equal(claimMission(fresh, 'wins', day).coins, 0)
  const earned = rewardRun(rewardRun(fresh, run, day).profile, run, day).profile
  const claimed = claimMission(earned, 'wins', day)
  assert.equal(claimed.coins, earned.coins + 60)
  assert.equal(claimMission(claimed, 'wins', day).coins, claimed.coins)
  const next = normalizeProfile(claimed, '2026-09-29')
  assert.equal(next.daily.wins, 0)
  assert.equal(next.coins, claimed.coins)
  assert.equal(next.total.wins, 2)
})
test('cosmetics reject insufficient coins, debit once and retain ownership on equip', () => {
  let p = freshProfile(); p.coins = 349
  assert.equal(buyCosmetic(p, 'retro').theme, 'neon')
  p.coins++
  p = buyCosmetic(p, 'retro')
  assert.equal(p.coins, 0); assert.equal(p.theme, 'retro')
  p = buyCosmetic(p, 'neon'); p = buyCosmetic(p, 'retro')
  assert.equal(p.coins, 0); assert.equal(p.theme, 'retro')
  assert.equal(buyCosmetic(p, 'unknown').coins, 0)
})
test('daily first-clear bonus is awarded once and corrupt saves recover safely', () => {
  const first = rewardRun(freshProfile(day), { ...run, mode: 'daily' }, day)
  const second = rewardRun(first.profile, { ...run, mode: 'daily' }, day)
  assert.equal(first.coins, 135); assert.equal(second.coins, 35)
  assert.equal(second.profile.daily.best, 5000)
  const corrupt = normalizeProfile({ coins: -20, xp: Infinity, owned: ['bad'], theme: 'retro', daily: null }, day)
  assert.equal(corrupt.coins, 0); assert.equal(corrupt.xp, 0); assert.equal(corrupt.theme, 'neon')
})
test('daily boards and ammunition are repeatable, attached, varied and contain visible cores', () => {
  const layouts = new Set()
  for (let i = 1; i <= 60; i++) {
    const date = new Date(Date.UTC(2026, 8, i)).toISOString().slice(0, 10)
    const level = generateDaily(date)
    assert.deepEqual(level, generateDaily(date))
    layouts.add(JSON.stringify(level.layers))
    const grid = new Grid({ canvasWidth: 720, canvasHeight: 1080, gridRows: 14, gridCols: 10, bubbleRadius: 32 })
    grid.loadLevel(level.layers[0], level.cores)
    assert.equal(grid.findFloatingClusters().length, 0)
    assert.equal(grid.getAllBubbles().filter(b => b.core).length, level.cores.length)
    const a = seededRandom(seedFromText(date)), b = seededRandom(seedFromText(date))
    assert.deepEqual(Array.from({ length: 32 }, a), Array.from({ length: 32 }, b))
  }
  assert.equal(layouts.size, 60)
})
