import { test } from 'vitest'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import asar from '@electron/asar'
import packaging from './package.cjs'

const { rebuildArchive } = packaging

test('the installed archive and unpacked workers use the same personal build', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orca-package-'))
  try {
    const bundle = path.join(tmp, 'baseline')
    const source = path.join(tmp, 'checkout')
    const resources = path.join(tmp, 'resources')
    const write = (dir, name, value) => {
      fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true })
      fs.writeFileSync(path.join(dir, name), value)
    }
    for (const dir of [bundle, source]) {
      for (const file of [
        'main/index.js',
        'packages/process-host/index.js',
        'preload/index.js',
        'renderer/index.html',
        'cli/index.js',
        'mobile-web/index.html',
        'shared/module.js'
      ]) {
        write(dir, `out/${file}`, dir === source ? 'personal' : 'upstream')
      }
      write(dir, 'out/package.json', '{"version":"1.0.0"}')
    }
    write(bundle, 'package.json', '{"version":"1.0.0"}')
    write(bundle, 'resources/native-helper', 'official')
    fs.mkdirSync(resources)
    const file = path.join(resources, 'app.asar')
    await asar.createPackageWithOptions(bundle, file, { unpackDir: 'resources' })
    await rebuildArchive(
      source,
      resources,
      path.join(tmp, 'work'),
      '1.0.0-personal.gabc1234',
      'abc1234'
    )
    for (const name of ['package.json', 'out/package.json']) {
      assert.equal(JSON.parse(asar.extractFile(file, name)).version, '1.0.0-personal.gabc1234')
    }
    assert.equal(asar.extractFile(file, 'out/preload/index.js').toString(), 'personal')
    assert.equal(fs.readFileSync(`${file}.unpacked/out/main/index.js`, 'utf8'), 'personal')
    assert.equal(fs.readFileSync(`${file}.unpacked/resources/native-helper`, 'utf8'), 'official')
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})
