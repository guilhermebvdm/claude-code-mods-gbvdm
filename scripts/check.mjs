// The gate before a change goes into main: validates the marketplace and each plugin, runs each plugin's tests,
// and checks that every Portuguese text of painel-sessao has an English version. Exits with 1 on any failure.
//
//   node scripts/check.mjs
import { spawnSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')
// The Claude Code a session of the Desktop app runs, or the one on the PATH
const claude = process.env.CLAUDE_CODE_EXECPATH || 'claude'

let failed = 0
function step(name, ok, detail = '') {
  console.log((ok ? 'ok    ' : 'FAIL  ') + name + (detail === '' ? '' : '\n' + detail))
  if (!ok) failed += 1
}

function run(args) {
  const out = spawnSync(claude, args, { cwd: root, encoding: 'utf8', shell: claude === 'claude' })
  return { ok: out.status === 0, text: (out.stdout ?? '') + (out.stderr ?? '') }
}

const marketplace = run(['plugin', 'validate', '.'])
step('marketplace: claude plugin validate', marketplace.ok, marketplace.ok ? '' : marketplace.text)

for (const name of readdirSync(join(root, 'plugins'))) {
  const dir = join('plugins', name)
  const valid = run(['plugin', 'validate', dir])
  step(name + ': claude plugin validate', valid.ok, valid.ok ? '' : valid.text)
  const tests = run(['plugin', 'test', dir])
  const summary = /(\d+) pass[\s\S]*?(\d+) fail/.exec(tests.text)
  step(
    name + ': claude plugin test' + (summary ? ' (' + summary[1] + ' pass, ' + summary[2] + ' fail)' : ''),
    tests.ok && summary !== null && summary[2] === '0',
    tests.ok ? '' : tests.text.split('\n').filter(line => !line.startsWith('(pass)')).join('\n'),
  )
}

// painel-sessao: every text passed to t() in register.tsx has an English version in texts.ts, and each English
// version is used
const hooks = join(root, 'plugins', 'painel-sessao', 'hooks')
const texts = readFileSync(join(hooks, 'texts.ts'), 'utf8').replace(/\r\n/g, '\n')
const source = readFileSync(join(hooks, 'register.tsx'), 'utf8').replace(/\r\n/g, '\n')
const start = texts.indexOf('const EN: Record<string, string> = {')
const table = texts.slice(start, texts.indexOf('\n}\n', start))
const keys = new Set()
for (const m of table.matchAll(/^\s{2}'((?:[^'\\]|\\.)*)':/gm)) keys.add(m[1])
for (const m of table.matchAll(/^\s{2}"((?:[^"\\]|\\.)*)":/gm)) keys.add(m[1])
for (const m of table.matchAll(/^\s{2}([A-Za-zÀ-ú]+):/gm)) keys.add(m[1])
const used = new Set()
for (let at = source.indexOf('t('); at >= 0; at = source.indexOf('t(', at + 2)) {
  if (/[A-Za-z0-9_$.]/.test(source[at - 1] ?? '')) continue
  // The literals of the call's first argument, up to its first comma or closing parenthesis at the top level
  let depth = 0
  for (let end = at + 2; end < source.length; end += 1) {
    const c = source[end]
    if (c === "'") {
      const close = source.indexOf("'", end + 1)
      used.add(source.slice(end + 1, close))
      end = close
    } else if ('({['.includes(c)) depth += 1
    else if (')}]'.includes(c)) {
      if (depth === 0) break
      depth -= 1
    } else if (c === ',' && depth === 0) break
  }
}
const missing = [...used].filter(key => !keys.has(key))
const unused = [...keys].filter(key => !used.has(key))
step(
  'painel-sessao: every Portuguese text has an English version (' + used.size + ' texts)',
  missing.length === 0 && unused.length === 0,
  [...missing.map(key => '  no English version: ' + JSON.stringify(key)), ...unused.map(key => '  English version no t() uses: ' + JSON.stringify(key))].join('\n'),
)

console.log(failed === 0 ? '\nAll checks passed.' : '\n' + failed + ' check(s) failed.')
process.exit(failed === 0 ? 0 : 1)
