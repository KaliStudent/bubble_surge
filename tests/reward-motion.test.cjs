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

const { advanceFalling } = require('../src/game/RewardMotion.ts')

test('detached bubbles hit the visible floor, bounce once, then pop', () => {
  const bubble = { x: 60, y: 320, vx: -75, vy: 60, bounces: 0 }
  const limits = { minX: 56, maxX: 664, floor: 1004 }
  let sawBounce = false
  let popped = false
  for (let frame = 0; frame < 240; frame++) {
    popped = advanceFalling(bubble, 1 / 120, limits)
    assert.ok(bubble.x >= limits.minX && bubble.x <= limits.maxX)
    assert.ok(bubble.y <= limits.floor)
    if (bubble.bounces === 1) sawBounce = true
    if (popped) break
  }
  assert.ok(sawBounce)
  assert.ok(popped)
  assert.equal(bubble.bounces, 1)
  assert.equal(bubble.y, limits.floor)
})
