const fs = require('node:fs')
const path = require('node:path')
const asar = require('@electron/asar')

async function rebuildArchive(source, resources, work, version, commit) {
  const archive = path.join(resources, 'app.asar')
  asar.extractAll(archive, work)
  asar.uncache(archive)
  for (const name of ['cli', 'main', 'packages', 'preload', 'renderer', 'shared', 'mobile-web']) {
    const target = path.join(work, 'out', name)
    fs.rmSync(target, { recursive: true, force: true })
    fs.cpSync(path.join(source, 'out', name), target, { recursive: true })
  }
  for (const name of ['package.json', 'out/package.json']) {
    const target = path.join(work, name)
    const manifest = JSON.parse(fs.readFileSync(target, 'utf8'))
    manifest.version = version
    if (name === 'out/package.json') {
      manifest.commit = commit
    }
    fs.writeFileSync(target, `${JSON.stringify(manifest)}\n`)
  }
  fs.rmSync(`${archive}.unpacked`, { recursive: true, force: true })
  await asar.createPackageWithOptions(work, archive, { unpackDir: '{out,resources}' })
}

module.exports = { rebuildArchive }
if (require.main === module) {
  rebuildArchive(...process.argv.slice(2)).catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
