import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'home-built-packages-'))
  try {
    mkdirSync(join(root, 'frontend/scripts'), { recursive: true })
    copyFileSync(new URL('./check-local-packages.mjs', import.meta.url), join(root, 'frontend/scripts/check-local-packages.mjs'))
    for (const name of ['ui', 'chat']) {
      const dir = join(root, 'frontend/node_modules/@shizuha', name)
      mkdirSync(join(dir, 'dist'), { recursive: true })
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: `@shizuha/${name}`, main: 'dist/index.js', module: 'dist/index.mjs', types: 'dist/index.d.ts' }))
      for (const entry of ['index.js', 'index.mjs', 'index.d.ts']) writeFileSync(join(dir, 'dist', entry), '')
    }
    const invoke = () => spawnSync(process.execPath, ['frontend/scripts/check-local-packages.mjs'], { cwd: root, env: { ...process.env, SHIZUHA_PACKAGES_DIR: join(root, 'absent') }, encoding: 'utf8' })
    run(root, invoke)
  } finally { rmSync(root, { recursive: true, force: true }) }
}

test('standalone Home accepts installed built UI/chat without private source checkout', () => fixture((_root, invoke) => {
  const result = invoke()
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /installed Shizuha package builds/)
}))

test('partial built package refuses rather than claiming a portable build', () => fixture((root, invoke) => {
  rmSync(join(root, 'frontend/node_modules/@shizuha/chat/dist/index.mjs'))
  assert.notEqual(invoke().status, 0)
}))
