// Turns what main holds into a new version of painel-sessao, ready to push: runs the checks, raises the version
// in plugin.json, dates the "Unreleased" section of CHANGELOG.md, commits and tags. It does not push: the push
// is the step that publishes, and the person who publishes runs it.
//
//   node scripts/release.mjs patch    0.2.0 -> 0.2.1   corrections
//   node scripts/release.mjs minor    0.2.0 -> 0.3.0   something new
//   node scripts/release.mjs major    0.2.0 -> 1.0.0   a change that asks something of the people who use it
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')
const manifest = join(root, 'plugins', 'painel-sessao', '.claude-plugin', 'plugin.json')
const changelog = join(root, 'CHANGELOG.md')
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()

function stop(text) {
  console.error('Nothing was changed. ' + text)
  process.exit(1)
}

const level = process.argv[2]
if (!['patch', 'minor', 'major'].includes(level)) stop('Say which part of the version goes up: patch, minor or major.')
if (git('branch', '--show-current') !== 'main') stop('A version is made from main. This folder is on ' + git('branch', '--show-current') + '.')
if (git('status', '--porcelain') !== '') stop('main has changes not committed. Commit or discard them first.')

// The changes of this version are the ones under "Unreleased", written as each change went into main
const notes = readFileSync(changelog, 'utf8').replace(/\r\n/g, '\n')
const unreleased = /## Unreleased\n([\s\S]*?)(?=\n## |$)/.exec(notes)
if (unreleased === null || unreleased[1].trim() === '') stop('CHANGELOG.md has nothing under "## Unreleased" to release.')

const checks = spawnSync(process.execPath, [join(root, 'scripts', 'check.mjs')], { cwd: root, stdio: 'inherit' })
if (checks.status !== 0) stop('The checks failed.')

const plugin = JSON.parse(readFileSync(manifest, 'utf8'))
const [major, minor, patch] = String(plugin.version).split('.').map(Number)
const version =
  level === 'major' ? major + 1 + '.0.0' : level === 'minor' ? major + '.' + (minor + 1) + '.0' : major + '.' + minor + '.' + (patch + 1)
plugin.version = version
writeFileSync(manifest, JSON.stringify(plugin, null, 2) + '\n')

const today = new Date().toISOString().slice(0, 10)
writeFileSync(changelog, notes.replace('## Unreleased\n', '## Unreleased\n\n## ' + version + ' (' + today + ')\n'))

git('add', manifest, changelog)
git('commit', '-q', '-m', 'release: painel-sessao ' + version)
// The tag name follows the convention Claude Code resolves plugin versions against
const tag = 'painel-sessao--v' + version
git('tag', '-a', tag, '-m', 'painel-sessao ' + version)

console.log('\npainel-sessao ' + version + ' is committed and tagged ' + tag + ' on main.')
console.log('To publish it:')
console.log('  git push origin main --follow-tags')
console.log('To undo it before the push:')
console.log('  git tag -d ' + tag + ' && git reset --hard HEAD~1')
