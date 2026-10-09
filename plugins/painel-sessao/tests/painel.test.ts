import { expect, mock, test as engineTest } from 'claude-code/testing'
import type { On } from 'claude-code'

const PLUGIN = 'painel-sessao'
const TOOL = 'mcp__painel-sessao__atualizar'
// 02/10/2026 11:44 in GMT-3
const START = Date.UTC(2026, 9, 2, 14, 44)

// Every test runs with the panel's times in the zone of São Paulo, whatever the zone of the machine: the
// plugin's own default is the system's zone. A test that names other options gives them to `engineTest`.
const SAO_PAULO = { timeZone: 'America/Sao_Paulo' }
type Body = Parameters<typeof engineTest>[1]
const test = (name: string, body: Body): void => engineTest(name, { options: SAO_PAULO }, body as never)
const PANE = {
  plugin: PLUGIN,
  component: 'Pane',
  requestId: 'painel-sessao',
  props: { title: 'Painel da sessão', isFocused: false, bodyColumns: 60, placement: 'dock' },
} as const
const BAND = {
  plugin: PLUGIN,
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100 },
} as const

type Sent = { text: string; origin: unknown }

// The key of the panel's text box, and the acts of a mounted pane the text box tests use
const AREA = 'area-prompt'
type Area = {
  find: (query: { type?: string; key?: string; text?: string | RegExp; in?: string }) => Promise<unknown>
  key: (event: { key: string; ctrl?: true; shift?: true; in: string }) => Promise<void>
  pointer: (event: { type: 'down'; x: number; y: number; button: 'left'; in: string }) => Promise<void>
  press: (target: { key: string }) => Promise<unknown>
}

// The acts of a mounted pane the tests of the app's own field use
type Found = { props: Record<string, unknown> } | undefined
type Field = {
  find: (query: { type?: string; key?: string; text?: string | RegExp }) => Promise<Found>
  input: (target: { key: string; text: string; kind?: 'change' | 'submit' }) => Promise<unknown>
  press: (target: { key: string }) => Promise<unknown>
  redraw: () => Promise<void>
  findAll?: (query: { type?: string; key?: string; text?: string | RegExp }) => Promise<unknown[]>
}

// Types the text into the panel's text box, one key for each character
async function write(pane: Area, text: string): Promise<void> {
  for (const char of text) await pane.key({ key: char === ' ' ? 'space' : char, in: AREA })
}

// The sections of the panel, by id
const SECTIONS = ['decisoes', 'passos', 'prompts', 'mensagens', 'notas', 'contexto']

// Mounts the pane and opens every section, so a test reads what a section holds without opening it first.
// The panel itself starts with four of them closed, each showing its summary in one line.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function mounted(engine: any, target: never): Promise<any> {
  const pane = await engine.ui.mount(target)
  for (const id of SECTIONS) {
    const title = await pane.find({ key: 'secao-' + id })
    if (title !== undefined && String(title.props.label).startsWith('▸')) await pane.press({ key: 'secao-' + id })
  }

  return pane
}

// Stands for the engine beneath the mod: a clock and a store in memory, and an answer for each call the mod makes
function world(on: On, stored: Record<string, unknown> = {}) {
  const clock = mock.clock(on, { now: START })
  // The store in memory, written here in place of `mock.store` so a test can read which keys the mod deleted
  const kept = new Map<string, unknown>(Object.entries(stored))
  const deleted: string[] = []
  on('store.get', (_$, e) => ({ value: kept.get((e as { key: string }).key) ?? null }) as never)
  on('store.set', (_$, e) => {
    const entry = e as { key: string; value: unknown }
    kept.set(entry.key, JSON.parse(JSON.stringify(entry.value)))
    return { value: undefined } as never
  })
  on('store.delete', (_$, e) => {
    deleted.push((e as { key: string }).key)
    kept.delete((e as { key: string }).key)
    return { value: undefined } as never
  })
  on('store.keys', () => ({ value: [...kept.keys()] }) as never)
  on('classic.UserPromptSubmit', () => ({}) as never)
  const sent: Sent[] = []
  const toasts: string[] = []
  const filled: string[] = []
  const copied: string[] = []
  const moves = { count: 0 }
  // The names of the commands the mod registered, the description of its tool, and the titles it opened panes with
  const commands: string[] = []
  const described: string[] = []
  const titles: string[] = []
  // Set by a test to hold every submitted prompt, as a running answer does
  const gate: { wait: Promise<void> | null } = { wait: null }
  // What the session's prompt box holds
  const box = { text: '' }
  // Set by a test: the conversation as `$.session.messages()` answers it, and the model's answer to a question
  // asked over it
  // `isBroken` makes the reading of the conversation fail
  const past: { rows: { role: string; text: string; toolUses: unknown[] }[]; fork: unknown; isBroken: boolean } = {
    rows: [],
    fork: { isAnswered: false, reason: 'nothing-to-fork' },
    isBroken: false,
  }
  // Set by a test: the engine's permission decision for a tool call, and a reason to drop every prompt
  // and the agents of the session, as `$.agent.list()` answers them
  const rules: { check: 'allow' | 'ask' | 'deny'; drop: string | null; agents: { id: string; status: string }[] } = {
    check: 'ask',
    drop: null,
    agents: [],
  }

  on('session.start', (_$, e) => ({ cwd: e.cwd }) as never)
  on('session.id', () => ({ value: 'test-session' }) as never)
  on('session.cwd', () => ({ value: '/work/loja-web' }) as never)
  on('command.register', (_$, e) => {
    commands.push((e as { name: string }).name)
    return { value: {} } as never
  })
  on('tool.register', (_$, e) => {
    described.push((e as { description: string }).description)
    return { value: { tool: TOOL } } as never
  })
  on('ui.open', (_$, e) => {
    titles.push((e as { title: string }).title)
    return { value: { isPlaced: true } } as never
  })
  on('ui.toast', (_$, e) => {
    toasts.push((e as { text: string }).text)
    return { value: undefined } as never
  })
  on('ui.copy', (_$, e) => {
    copied.push((e as { text: string }).text)
    return { value: { isCopied: true } } as never
  })
  // How many moves of focus in the pane reached the engine: one the mod answers by itself does not
  on('ui.focus', () => {
    moves.count += 1
    return {} as never
  })
  on('ui.fault', () => ({}) as never)
  on('session.usage', () => ({ value: { startedAt: START, context: { window: 0 }, rateLimits: [] } }) as never)
  on('session.measure', (_$, e) => ({ changed: e.changed }) as never)
  on('session.compact', () => ({ messages: [{ role: 'user', text: 'resumo', toolUses: [] }], tokensBefore: 800_000, tokensAfter: 120_000 }) as never)
  on('prompt.fill', (_$, e) => {
    box.text = (e as { text: string }).text
    filled.push((e as { text: string }).text)
    return { isFilled: true } as never
  })
  on('turn.start', (_$, e) => ({ turnId: e.turnId }) as never)
  on('prompt.submit', async (_$, e) => {
    // A prompt submitted while an answer runs enters when the answer ends
    if (gate.wait !== null) await gate.wait
    if (rules.drop !== null) return { drop: rules.drop } as never
    sent.push({ text: e.text, origin: e.origin })
    return { text: e.text, context: e.context } as never
  })
  on('agent.list', () => ({ value: rules.agents }) as never)
  on('session.messages', () => (past.isBroken ? { deny: 'a conversa não pôde ser lida' } : { value: past.rows }) as never)
  on('model.fork', () => ({ value: past.fork }) as never)
  on('ui.message', () => ({}) as never)
  on('turn.complete', (_$, e) => ({ text: e.answer }) as never)
  on('tool.check', () => ({ decision: rules.check }) as never)
  on('ui.render', () => ({ type: 'engine', ref: 0 }) as never)

  return { clock, sent, toasts, filled, copied, moves, commands, described, titles, deleted, box, gate, rules, past }
}

test('a prompt the user typed is listed with its time, and the model reads how to update the panel', async ($, on) => {
  world(on)

  const entered = await $.prompt.submit({
    text: 'Qual é o próximo passo?',
    wait: false,
    origin: { kind: 'composer' },
  })
  expect(entered.context?.[0]).toContain(TOOL)

  // The panel did not change, so the next prompt carries no copy of its state
  const again = await $.prompt.submit({ text: 'E depois?', wait: false, origin: { kind: 'composer' } })
  expect(again.context).toBe(undefined)
  await $.tool.call({ tool: TOOL, tool_use_id: 'call-1', points: ['Um ponto novo'] } as never)
  const changed = await $.prompt.submit({ text: 'E agora?', wait: false, origin: { kind: 'composer' } })
  expect(changed.context?.[0]).toContain('Um ponto novo')

  const pane = await mounted($, { ...PANE, surface: 'desktop' } as never)
  expect(await pane.find({ type: 'Button', text: '11:44 ↗' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: 'Qual é o próximo passo?' })).toBeDefined()
})

test('a background task notification is not listed as a message of the user', async ($, on) => {
  world(on)

  const entered = await $.prompt.submit({
    text: 'task finished',
    wait: false,
    origin: { kind: 'task-notification' },
  })
  expect(entered.context).toBe(undefined)

  const pane = await mounted($, { ...PANE, surface: 'desktop' } as never)
  expect(await pane.find({ type: 'Text', text: 'task finished' })).toBe(undefined)
})

test('the steps the model sends show the last two done, the current one marked and the next ones', async ($, on) => {
  world(on)

  const answer = await $.tool.call({
    tool: TOOL,
    tool_use_id: 'call-1',
    steps: [
      { title: 'Ler a documentação', status: 'done' },
      { title: 'Conferir a versão', status: 'done' },
      { title: 'Escrever o mod', status: 'done' },
      { title: 'Validar o mod', status: 'current' },
      { title: 'Testar no aplicativo', status: 'next' },
    ],
    terms: [{ term: 'Mod', meaning: 'Plugin que desenha na interface do Claude Code' }],
    points: ['Mods exigem Claude Code 2.1.287 pela documentação'],
  } as never)
  expect((answer as { result?: unknown }).result).toBe('Painel atualizado: 5 passos, 1 termos, 1 pontos.')

  for (const surface of ['desktop', 'terminal'] as const) {
    const pane = await mounted($, { ...PANE, surface } as never)
    expect(await pane.find({ type: 'Text', text: '3 de 5 concluídos' })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: '1 passo concluído antes' })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: '1. Ler a documentação' })).toBe(undefined)
    expect((await pane.find({ type: 'Text', text: '3. Escrever o mod' }))?.props.dimColor).toBe(true)
    expect((await pane.find({ type: 'Text', text: '4. Validar o mod' }))?.props.bold).toBe(true)
    expect(await pane.findAll({ type: 'Text', text: 'AGORA' })).toHaveLength(1)
    expect(await pane.find({ type: 'Text', text: '5. Testar no aplicativo' })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /^Mod$/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: 'Plugin que desenha na interface' })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: 'Mods exigem Claude Code 2.1.287' })).toBeDefined()
    // The progress bar: 3 of 5 steps done over 56 cells (60 columns less the frame and the padding)
    if (surface === 'terminal') {
      expect((await pane.find({ type: 'Text', text: /^━+$/ }))?.text).toHaveLength(34)
    } else {
      // Where the surface draws pictures the bar is one drawing, 60% filled, and no row of characters
      const bar = await pane.find({ type: 'Svg' })
      expect(bar?.props.alt).toBe('3 de 5 passos concluídos')
      expect(String(bar?.props.source)).toContain('<rect width="600" height="6" rx="3" fill="#D97757"/>')
      expect(await pane.find({ type: 'Text', text: /^━+$/ })).toBe(undefined)
    }
    await pane.unmount()
  }

  const band = await $.ui.mount({ ...BAND, surface: 'desktop' } as never)
  expect(await band.find({ type: 'Text', text: '● Passo 4 de 5' })).toBeDefined()
  expect(await band.find({ type: 'Text', text: 'Validar o mod' })).toBeDefined()
})

test('the button "Concluir passo atual" marks the current step done and the next one current', async ($, on) => {
  world(on)
  await $.tool.call({
    tool: TOOL,
    tool_use_id: 'call-1',
    steps: [
      { title: 'Validar o mod', status: 'current' },
      { title: 'Testar no aplicativo', status: 'next' },
    ],
  } as never)

  const pane = await mounted($, { ...PANE, surface: 'desktop' } as never)
  await pane.press({ key: 'concluir-passo' })
  expect((await pane.find({ type: 'Text', text: '1. Validar o mod' }))?.props.dimColor).toBe(true)
  expect((await pane.find({ type: 'Text', text: '2. Testar no aplicativo' }))?.props.bold).toBe(true)
})

test('a prompt typed in the panel is queued, and "Enviar" submits it as the user and removes it', async ($, on) => {
  const { sent } = world(on)

  // VS Code draws no Client, so the panel keeps the one-line field there
  const pane = await mounted($, { ...PANE, surface: 'vscode' } as never)
  await pane.input({ key: 'novo-prompt', text: 'Rode os testes de novo' })
  expect(await pane.find({ type: 'Text', text: 'Rode os testes de novo' })).toBeDefined()
  expect(await pane.find({ key: 'enviar-1' })).toBeDefined()

  await pane.press({ key: 'enviar-1' })
  expect(sent).toHaveLength(1)
  expect(sent[0]).toEqual({
    text: 'Rode os testes de novo',
    origin: { kind: 'plugin', name: PLUGIN, asUser: true },
  })
  expect(await pane.find({ key: 'enviar-1' })).toBe(undefined)
})

test('desktop: "Nova linha" keeps the typed line, and Enter notes every line as one prompt and empties the field', async ($, on) => {
  const { sent } = world(on)
  const pane = (await mounted($, { ...PANE, surface: 'desktop' } as never)) as unknown as Field

  // The desktop app draws no text box of its own keys: the field of the app is the one drawn
  expect(await pane.find({ key: AREA })).toBe(undefined)
  expect(await pane.find({ key: 'limpar-rascunho' })).toBe(undefined)

  await pane.input({ key: 'novo-prompt', text: 'Rode os testes', kind: 'change' })
  await pane.press({ key: 'nova-linha' })
  expect(await pane.find({ type: 'Text', text: 'Rode os testes' })).toBeDefined()
  expect((await pane.find({ key: 'novo-prompt' }))?.props.value).toBe('')
  expect(await pane.find({ key: 'enviar-1' })).toBe(undefined)

  await pane.input({ key: 'novo-prompt', text: 'de novo' })
  expect((await pane.find({ key: 'novo-prompt' }))?.props.value).toBe('')
  await pane.press({ key: 'enviar-1' })
  expect(sent.map(one => one.text)).toEqual(['Rode os testes\nde novo'])
})

test('desktop: "Anotar" notes what is typed, "Limpar" drops the kept lines, and an empty field notes nothing', async ($, on) => {
  const { sent } = world(on)
  const pane = (await mounted($, { ...PANE, surface: 'desktop' } as never)) as unknown as Field

  await pane.input({ key: 'novo-prompt', text: '   ' })
  expect(await pane.find({ key: 'enviar-1' })).toBe(undefined)

  await pane.input({ key: 'novo-prompt', text: 'descartar', kind: 'change' })
  await pane.press({ key: 'nova-linha' })
  await pane.press({ key: 'limpar-rascunho' })
  expect(await pane.find({ type: 'Text', text: 'descartar' })).toBe(undefined)

  await pane.input({ key: 'novo-prompt', text: 'manter', kind: 'change' })
  // Once the user types, the mod draws no value for the field: the desktop app keeps what is typed by itself
  // as long as the value drawn does not change, and a value that followed the typing emptied the field
  expect((await pane.find({ key: 'novo-prompt' }))?.props.value).toBe(undefined)
  await pane.redraw()
  expect((await pane.find({ key: 'novo-prompt' }))?.props.value).toBe(undefined)
  await pane.input({ key: 'novo-prompt', text: 'manter' })
  // Enter empties the field: the value drawn changes from none to an empty text
  expect((await pane.find({ key: 'novo-prompt' }))?.props.value).toBe('')
  await pane.press({ key: 'enviar-1' })
  expect(sent.map(one => one.text)).toEqual(['manter'])
})

// The test kit has no conversation to scroll, so these two tests check which row the mod found, not the scroll:
// with a row, the mod asks for the scroll and reports the kit's refusal; without one, it says it found none
test('the time of a message asks for a scroll once the conversation has drawn the row of that message', async ($, on) => {
  const env = world(on)
  await $.prompt.submit({ text: 'Qual é o próximo passo?', wait: false, origin: { kind: 'composer' } })
  const pane = (await mounted($, { ...PANE, surface: 'desktop' } as never)) as unknown as Field

  // The conversation has not drawn the row yet
  await pane.press({ key: 'ir-' + START })
  expect(env.toasts).toEqual(['Não achei essa mensagem na conversa. Ela ainda não apareceu na tela com o painel ligado.'])

  await $.ui.render({
    component: 'UserMessage',
    surface: 'desktop',
    requestId: 'row-7',
    props: { text: 'Qual é o próximo passo?', origin: { kind: 'composer' }, isExpanded: true },
  } as never)
  await pane.press({ key: 'ir-' + START })
  expect(env.toasts).toHaveLength(2)
  expect(env.toasts[1]).toContain('A conversa não rolou até a mensagem: ')
})

// Not covered: the row a message gets when it enters the conversation (the `session.append` hook). The kit of
// Claude Code 2.1.286 has no implementation of that event and refuses a test's own answer to it.

test('the panel lists 5 messages, and "Carregar mais" lists 5 more each time', async ($, on) => {
  const { clock } = world(on)
  for (let i = 1; i <= 12; i += 1) {
    await $.prompt.submit({ text: 'mensagem ' + i + '.', wait: false, origin: { kind: 'composer' } })
    await clock.advance(60_000)
  }
  const pane = (await mounted($, { ...PANE, surface: 'desktop' } as never)) as unknown as Field

  expect(await pane.find({ type: 'Text', text: '5 de 12' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: 'mensagem 8.' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: 'mensagem 7.' })).toBe(undefined)
  expect(await pane.find({ key: 'menos-mensagens' })).toBe(undefined)
  expect((await pane.find({ key: 'mais-mensagens' }))?.props.label).toBe('▾ Carregar mais 5')

  await pane.press({ key: 'mais-mensagens' })
  expect(await pane.find({ type: 'Text', text: 'mensagem 3.' })).toBeDefined()
  expect((await pane.find({ key: 'mais-mensagens' }))?.props.label).toBe('▾ Carregar mais 2')

  await pane.press({ key: 'mais-mensagens' })
  expect(await pane.find({ type: 'Text', text: 'mensagem 1.' })).toBeDefined()
  expect(await pane.find({ key: 'mais-mensagens' })).toBe(undefined)

  await pane.press({ key: 'menos-mensagens' })
  expect(await pane.find({ type: 'Text', text: '5 de 12' })).toBeDefined()
})

test('the first section shows the context window, the limits of the plan, the last turn and the compactions', async ($, on) => {
  world(on)
  const pane = (await mounted($, { ...PANE, surface: 'desktop' } as never)) as unknown as Field
  expect(await pane.find({ type: 'Text', text: 'Sem medição ainda.' })).toBeDefined()

  await $.session.measure({
    context: { tokens: 441_200, window: 1_000_000, percent: 44 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 12.5, resetsAt: '2026-10-02T17:00:00Z' },
      { kind: 'seven_day', percentUsed: 35, resetsAt: '2026-10-03T20:00:00Z' },
    ],
    changed: ['context', 'rateLimits'],
  } as never)
  await pane.redraw()
  expect(await pane.find({ type: 'Text', text: '441,2k / 1M · 44%' })).toBeDefined()
  expect((await pane.find({ type: 'Text', text: /^558,8k$/ }))?.props.bold).toBe(true)
  // 44% of 56 cells
  const meter = (await pane.find({ type: 'Svg' })) as { props: Record<string, unknown> } | undefined
  expect(meter?.props.alt).toBe('44% da janela de contexto em uso')
  expect(meter?.props.height).toBe(6)
  // 44% of the drawing's 1000 units, in green because less than half the window is in use
  expect(String(meter?.props.source)).toContain('<rect width="440" height="6" rx="3" fill="#3FA66B"/>')
  expect(await pane.find({ type: 'Text', text: /^12,5%$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: 'reinicia 14:00' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^35%$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: 'reinicia sáb. 17:00' })).toBeDefined()

  await $.turn.complete({
    answer: 'Pronto.',
    durationMs: 1000,
    isAborted: false,
    turnId: 'turn-1',
    reason: 'answer',
    usage: { input_tokens: 2100, output_tokens: 3400, cache_read_input_tokens: 430_000, cache_creation_input_tokens: 5000 },
  } as never)
  await $.session.compact({ trigger: 'auto', messages: [{ role: 'user', text: 'conversa', toolUses: [] }] } as never)
  await pane.redraw()
  expect(
    await pane.find({ type: 'Text', text: 'entrada 2,1k · saída 3,4k · cache lido 430k · cache gravado 5k' }),
  ).toBeDefined()
  expect(await pane.find({ type: 'Text', text: 'última 11:44: 800k → 120k' })).toBeDefined()

  // A compaction computed ahead, or one of a subagent, is not counted
  await $.session.compact({ trigger: 'precompute', messages: [{ role: 'user', text: 'conversa', toolUses: [] }] } as never)
  await $.session.compact({ trigger: 'auto', agentId: 'agent-1', messages: [{ role: 'user', text: 'conversa', toolUses: [] }] } as never)
  await pane.redraw()
  expect((await pane.findAll?.({ type: 'Text', text: /^1$/ }))?.length).toBe(1)
})

// The pane of these tests is 60 cells wide: a row of a noted prompt holds 64 characters on the desktop app
test('desktop: a noted prompt shows the 4 rows that fit until "Ver tudo", and one that fits has no such button', async ($, on) => {
  world(on)
  await $.command.run({ command: 'anotar', args: 'um\ndois\ntrês\nquatro\ncinco\nseis' } as never)
  await $.command.run({ command: 'anotar', args: 'curto' } as never)
  await $.command.run({ command: 'anotar', args: 'a\nb\nc\nd' } as never)
  const pane = (await mounted($, { ...PANE, surface: 'desktop' } as never)) as unknown as Field

  expect(await pane.find({ type: 'Text', text: /^um$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^quatro$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^cinco$/ })).toBe(undefined)
  expect(await pane.find({ type: 'Text', text: 'mais 2 linhas' })).toBeDefined()
  // One row and four rows both fit
  expect(await pane.find({ key: 'ver-2' })).toBe(undefined)
  expect(await pane.find({ key: 'ver-3' })).toBe(undefined)

  await pane.press({ key: 'ver-1' })
  expect(await pane.find({ type: 'Text', text: /^seis$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: 'mais 2 linhas' })).toBe(undefined)

  await pane.press({ key: 'ver-1' })
  expect(await pane.find({ type: 'Text', text: /^seis$/ })).toBe(undefined)
})

test('desktop: one long paragraph is cut where the 4th row ends, by the width of the pane and not by a fixed count', async ($, on) => {
  world(on)
  const paragraph = 'palavra '.repeat(50).trim()
  await $.command.run({ command: 'anotar', args: paragraph } as never)

  const narrow = (await mounted($, { ...PANE, surface: 'desktop' } as never)) as unknown as Field
  const cut = (await narrow.find({ type: 'Text', text: /^palavra .*…$/ })) as unknown as { text: string } | undefined
  // 4 rows of 64 characters, the ellipsis being the last one
  expect(cut?.text.length).toBe(256)
  expect(await narrow.find({ type: 'Text', text: /mais \d+ linha/ })).toBe(undefined)
  expect(await narrow.find({ key: 'ver-1' })).toBeDefined()
  await (narrow as unknown as { unmount: () => Promise<void> }).unmount()

  // A pane twice as wide holds the whole paragraph in 4 rows: nothing is cut and there is no button
  const wide = (await mounted($, {
    ...PANE,
    surface: 'desktop',
    props: { ...PANE.props, bodyColumns: 120 },
  } as never)) as unknown as Field
  expect(await wide.find({ type: 'Text', text: paragraph })).toBeDefined()
  expect(await wide.find({ key: 'ver-1' })).toBe(undefined)
})

test('the title of a section closes and opens it, and the count stays', async ($, on) => {
  world(on)
  await $.tool.call({
    tool: TOOL,
    tool_use_id: 'call-1',
    steps: [
      { title: 'Validar o mod', status: 'current' },
      { title: 'Testar no aplicativo', status: 'next' },
    ],
  } as never)

  for (const surface of ['desktop', 'terminal'] as const) {
    const pane = (await mounted($, { ...PANE, surface } as never)) as unknown as Field
    // The title is in capitals, with the arrow inside the button
    expect((await pane.find({ key: 'secao-passos' }))?.props.label).toBe('▾ PASSOS')

    await pane.press({ key: 'secao-passos' })
    expect((await pane.find({ key: 'secao-passos' }))?.props.label).toBe('▸ PASSOS')
    expect(await pane.find({ type: 'Text', text: '1. Validar o mod' })).toBe(undefined)
    expect(await pane.find({ type: 'Text', text: '0 de 2 · a seguir: Testar no aplicativo' })).toBeDefined()
    // The other sections stay open
    expect(await pane.find({ type: 'Text', text: 'Nenhum termo registrado.' })).toBeDefined()

    await pane.press({ key: 'secao-passos' })
    expect(await pane.find({ type: 'Text', text: '1. Validar o mod' })).toBeDefined()
  }
})

for (const surface of ['terminal'] as const) {
  test(surface + ': the text box breaks the line on Ctrl+Shift+Enter and notes the text on Enter', async ($, on) => {
    const { sent } = world(on)
    const pane = (await mounted($, { ...PANE, surface } as never)) as unknown as Area

    expect(await pane.find({ type: 'Text', text: 'Clique aqui e escreva um prompt', in: AREA })).toBeDefined()
    await pane.pointer({ type: 'down', x: 1, y: 1, button: 'left', in: AREA })
    await write(pane, 'Rode os testes')
    await pane.key({ key: 'return', ctrl: true, shift: true, in: AREA })
    await write(pane, 'de novo')
    expect(await pane.find({ key: 'enviar-1' })).toBe(undefined)

    await pane.key({ key: 'return', in: AREA })
    expect(await pane.find({ key: 'enviar-1' })).toBeDefined()
    // The box is empty again after the text was noted
    expect(await pane.find({ type: 'Text', text: 'Rode os testes', in: AREA })).toBe(undefined)

    await pane.press({ key: 'enviar-1' })
    expect(sent.map(one => one.text)).toEqual(['Rode os testes\nde novo'])
  })

  test(surface + ': the text box edits with Backspace, the arrows and Shift+Enter, and Enter on an empty box notes nothing', async ($, on) => {
    const { sent } = world(on)
    const pane = (await mounted($, { ...PANE, surface } as never)) as unknown as Area

    await pane.key({ key: 'return', in: AREA })
    expect(await pane.find({ key: 'enviar-1' })).toBe(undefined)

    await write(pane, 'abd')
    await pane.key({ key: 'left', in: AREA })
    await pane.key({ key: 'c', in: AREA })
    await pane.key({ key: 'end', in: AREA })
    await pane.key({ key: 'x', in: AREA })
    await pane.key({ key: 'backspace', in: AREA })
    await pane.key({ key: 'return', shift: true, in: AREA })
    await pane.key({ key: 'v', ctrl: true, in: AREA })
    await write(pane, 'fim')
    await pane.key({ key: 'return', in: AREA })

    await pane.press({ key: 'enviar-1' })
    expect(sent.map(one => one.text)).toEqual(['abcd\nfim'])
  })
}

test('"Pôr na caixa" fills the prompt box and removes the prompt, "Excluir" removes it without sending', async ($, on) => {
  const { sent, filled } = world(on)

  const pane = (await mounted($, { ...PANE, surface: 'desktop' } as never)) as unknown as Field
  await pane.input({ key: 'novo-prompt', text: 'primeiro' })
  await pane.input({ key: 'novo-prompt', text: 'segundo' })

  await pane.press({ key: 'mais-1' })
  await pane.press({ key: 'caixa-1' })
  expect(filled).toEqual(['primeiro'])
  expect(await pane.find({ key: 'caixa-1' })).toBe(undefined)

  await pane.press({ key: 'mais-2' })
  await pane.press({ key: 'excluir-2' })
  expect(await pane.find({ key: 'excluir-2' })).toBe(undefined)
  expect(sent).toHaveLength(0)
})

test('/anotar queues its text without starting a turn', async ($, on) => {
  const { sent, toasts } = world(on)

  await $.command.run({ command: 'anotar', args: 'Atualize a timeline' } as never)
  expect(toasts).toEqual(['Prompt anotado: Atualize a timeline'])
  expect(sent).toHaveLength(0)

  const band = await $.ui.mount({ ...BAND, surface: 'desktop' } as never)
  expect(await band.find({ type: 'Text', text: '1 prompt anotado' })).toBeDefined()
})

test('the line under an answer says when the turn started, when it ended and how long it took', async ($, on) => {
  const { clock } = world(on)
  await clock.advance(8 * 60 * 1000)

  const ended = await $.turn.complete({
    answer: 'Pronto.',
    durationMs: 8 * 60 * 1000,
    isAborted: false,
    turnId: 'turn-1',
    reason: 'answer',
  } as never)
  expect(ended.text).toBe('⏱ 02/10/2026 · pergunta 11:44 · resposta 11:52 · 8 min 00 s (GMT-3)')
})

test('a subagent turn keeps its own answer', async ($, on) => {
  world(on)

  const ended = await $.turn.complete({
    answer: 'child answer',
    durationMs: 1000,
    isAborted: false,
    turnId: 'turn-2',
    agentId: 'agent-1',
    reason: 'answer',
  } as never)
  expect(ended.text).toBe('child answer')
})

test('the panel tool runs without a permission prompt, and no other tool is allowed by the mod', async ($, on) => {
  world(on)

  expect((await $.tool.check({ tool: TOOL, input: {} } as never)).decision).toBe('allow')
  expect((await $.tool.check({ tool: 'Bash', input: { command: 'ls' } } as never)).decision).toBe('ask')
  // A call that turns the automatic sending on has the user's prompts sent as the user: the user is asked
  expect((await $.tool.check({ tool: TOOL, input: { envio_automatico: true } } as never)).decision).toBe('ask')
  expect((await $.tool.check({ tool: TOOL, input: { envio_automatico: false, points: ['x'] } } as never)).decision).toBe('allow')
})

test('the board a session saved is loaded again when the mod starts with empty state', async ($, on) => {
  mock.clock(on, { now: START })
  mock.store(on, {
    'board:test-session': {
      asks: [],
      steps: [{ title: 'Passo salvo', status: 'current' }],
      terms: [],
      points: [],
      queue: [{ id: 1, text: 'prompt salvo' }],
      savedAt: START,
    },
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }) as never)
  on('session.usage', () => ({ value: { startedAt: START, context: { window: 0 }, rateLimits: [] } }) as never)
  on('session.id', () => ({ value: 'test-session' }) as never)
  on('session.cwd', () => ({ value: '/work/loja-web' }) as never)
  on('command.register', () => ({ value: {} }) as never)
  on('tool.register', () => ({ value: { tool: TOOL } }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('ui.render', () => ({ type: 'engine', ref: 0 }) as never)

  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  const pane = await mounted($, { ...PANE, surface: 'desktop' } as never)
  expect((await pane.find({ type: 'Text', text: '1. Passo salvo' }))?.props.bold).toBe(true)
  expect(await pane.find({ type: 'Text', text: 'prompt salvo' })).toBeDefined()

  // Until the app gives the session a title, the list of sessions names it by the folder it runs in
  await pane.press({ key: 'aba-sessoes' })
  expect(await pane.find({ type: 'Text', text: /^loja-web · esta sessão$/ })).toBeDefined()
})

test('a prompt sent while an answer runs says so until its turn starts, and leaves the list then', async ($, on) => {
  const env = world(on)
  await $.command.run({ command: 'anotar', args: 'Atualize a timeline' } as never)
  const pane = (await mounted($, { ...PANE, surface: 'desktop' } as never)) as unknown as Field

  let release = (): void => {}
  env.gate.wait = new Promise<void>(resolve => {
    release = resolve
  })
  const pressing = pane.press({ key: 'enviar-1' })
  await env.clock.settle()
  await pane.redraw()
  expect(await pane.find({ type: 'Text', text: 'Enviado. Entra na conversa quando a resposta atual terminar.' })).toBeDefined()
  expect(await pane.find({ key: 'enviar-1' })).toBe(undefined)
  expect(await pane.find({ key: 'excluir-1' })).toBe(undefined)
  expect(env.sent).toHaveLength(0)
  // The prompt sent from the panel is listed among the messages of the user, with its time
  expect(await pane.find({ type: 'Button', text: '11:44 ↗' })).toBeDefined()

  release()
  await pressing
  await pane.redraw()
  expect(env.sent.map(one => one.text)).toEqual(['Atualize a timeline'])
  // The noted prompt left "Próximos prompts": none of its buttons is drawn
  expect(await pane.find({ key: 'mais-1' })).toBe(undefined)
  expect(await pane.find({ type: 'Text', text: 'Nenhum prompt anotado.' })).toBeDefined()
})

test('a prompt the engine drops stays noted, with the reason in a notice', async ($, on) => {
  const env = world(on)
  await $.command.run({ command: 'anotar', args: 'Atualize a timeline' } as never)
  const pane = (await mounted($, { ...PANE, surface: 'desktop' } as never)) as unknown as Field

  env.rules.drop = 'bloqueado por uma regra'
  await pane.press({ key: 'enviar-1' })
  await pane.redraw()
  expect(env.sent).toHaveLength(0)
  expect(env.toasts.at(-1)).toBe('O prompt não foi enviado e continua em Próximos prompts: bloqueado por uma regra')
  expect(await pane.find({ key: 'enviar-1' })).toBeDefined()
})

test('the panel keeps 30 noted prompts and refuses the next one instead of dropping the oldest', async ($, on) => {
  const env = world(on)
  for (let i = 1; i <= 30; i += 1) await $.command.run({ command: 'anotar', args: 'prompt ' + i } as never)
  await $.command.run({ command: 'anotar', args: 'prompt 31' } as never)

  expect(env.toasts.at(-1)).toBe('Próximos prompts já tem 30 prompts anotados, que é o limite. Envie ou exclua um.')
  const pane = (await mounted($, { ...PANE, surface: 'desktop' } as never)) as unknown as Field
  expect(await pane.findAll?.({ type: 'Button', text: '➤ Enviar' })).toHaveLength(30)
  expect(await pane.find({ type: 'Text', text: /^prompt 1$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^prompt 31$/ })).toBe(undefined)
})

test('a call of a subagent, or one with no valid step, leaves the steps of the panel as they are', async ($, on) => {
  world(on)
  await $.tool.call({ tool: TOOL, tool_use_id: 'call-1', steps: [{ title: 'Validar o mod', status: 'current' }] } as never)

  const child = await $.tool.call({
    tool: TOOL,
    tool_use_id: 'call-2',
    agentId: 'agent-1',
    steps: [{ title: 'Plano do subagente', status: 'current' }],
  } as never)
  expect((child as { deny?: string }).deny).toBe('painel-sessao: só a conversa principal atualiza o painel da sessão.')

  await $.tool.call({ tool: TOOL, tool_use_id: 'call-3', steps: [{ status: 'current' }, 'texto solto'] } as never)
  const pane = (await mounted($, { ...PANE, surface: 'desktop' } as never)) as unknown as Field
  expect(await pane.find({ type: 'Text', text: '1. Validar o mod' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: 'Plano do subagente' })).toBe(undefined)
})

test('a rule that denies the panel tool stays in force', async ($, on) => {
  const env = world(on)
  env.rules.check = 'deny'

  expect((await $.tool.check({ tool: TOOL, input: {} } as never)).decision).toBe('deny')
})

test('a prompt marked as sent leaves the list when a turn starts with its text', async ($, on) => {
  const env = world(on)
  await $.command.run({ command: 'anotar', args: 'Atualize a timeline' } as never)
  const pane = (await mounted($, { ...PANE, surface: 'desktop' } as never)) as unknown as Field

  env.gate.wait = new Promise<void>(() => {})
  void pane.press({ key: 'enviar-1' })
  await env.clock.settle()
  await $.turn.start({ text: 'Atualize a timeline', turnId: 'turn-9' } as never)
  await pane.redraw()
  expect(await pane.find({ key: 'mais-1' })).toBe(undefined)
  expect(await pane.findAll?.({ type: 'Button', text: '11:44 ↗' })).toHaveLength(1)
})

// The end of an answer of the main conversation, as the engine raises it
const answered = (reason: 'answer' | 'aborted' | 'error') =>
  ({ answer: 'Pronto.', durationMs: 1000, isAborted: reason === 'aborted', turnId: 'turn-1', reason }) as never

test('automatic sending: after an answer the first noted prompt enters in 5 seconds, one for each answer', async ($, on) => {
  const env = world(on)
  await $.command.run({ command: 'anotar', args: 'primeiro' } as never)
  await $.command.run({ command: 'anotar', args: 'segundo' } as never)
  const pane = (await mounted($, { ...PANE, surface: 'desktop' } as never)) as unknown as Field

  // Off until the user turns it on: an answer sends nothing
  expect((await pane.find({ key: 'envio-automatico' }))?.props.label).toBe('Envio automático: desligado')
  await $.turn.complete(answered('answer'))
  await env.clock.advance(6000)
  expect(env.sent).toHaveLength(0)

  await pane.press({ key: 'envio-automatico' })
  expect((await pane.find({ key: 'envio-automatico' }))?.props.label).toBe('Envio automático: ligado')
  await $.turn.complete(answered('answer'))
  await pane.redraw()
  expect(env.toasts.at(-1)).toBe('Envio automático: o próximo prompt entra em 5 segundos. Para parar, clique em Cancelar.')
  expect(await pane.find({ key: 'cancelar-envio' })).toBeDefined()
  await env.clock.advance(4000)
  expect(env.sent).toHaveLength(0)
  await env.clock.advance(1500)
  expect(env.sent.map(one => one.text)).toEqual(['primeiro'])

  // The second waits for the next answer
  await env.clock.advance(60_000)
  expect(env.sent).toHaveLength(1)
  await $.turn.complete(answered('answer'))
  await env.clock.advance(5500)
  expect(env.sent.map(one => one.text)).toEqual(['primeiro', 'segundo'])
})

test('automatic sending: "Cancelar" calls the sending off and turns it off', async ($, on) => {
  const env = world(on)
  await $.command.run({ command: 'anotar', args: 'primeiro' } as never)
  await $.command.run({ command: 'envio-automatico', args: 'ligar' } as never)
  const pane = (await mounted($, { ...PANE, surface: 'desktop' } as never)) as unknown as Field

  await $.turn.complete(answered('answer'))
  await pane.redraw()
  await pane.press({ key: 'cancelar-envio' })
  await env.clock.advance(6000)
  expect(env.sent).toHaveLength(0)
  expect((await pane.find({ key: 'envio-automatico' }))?.props.label).toBe('Envio automático: desligado')
  expect(await pane.find({ key: 'enviar-1' })).toBeDefined()
})

test('automatic sending: an interrupted answer or one with an error turns it off, and a running agent makes it wait', async ($, on) => {
  const env = world(on)
  await $.command.run({ command: 'anotar', args: 'primeiro' } as never)

  for (const reason of ['aborted', 'error'] as const) {
    await $.command.run({ command: 'envio-automatico', args: 'ligar' } as never)
    await $.turn.complete(answered(reason))
    await env.clock.advance(6000)
    expect(env.sent).toHaveLength(0)
    expect(env.toasts.at(-1)).toBe(
      'Envio automático desligado: a resposta ' + (reason === 'aborted' ? 'foi interrompida.' : 'terminou com erro.'),
    )
  }

  await $.command.run({ command: 'envio-automatico', args: 'ligar' } as never)
  env.rules.agents = [{ id: 'agent-1', status: 'running' }]
  await $.turn.complete(answered('answer'))
  await env.clock.advance(6000)
  expect(env.sent).toHaveLength(0)

  // The agent ended: the answer to its notice ends, and the prompt enters
  env.rules.agents = [{ id: 'agent-1', status: 'completed' }]
  await $.turn.complete(answered('answer'))
  await env.clock.advance(5500)
  expect(env.sent.map(one => one.text)).toEqual(['primeiro'])
})

test('automatic sending: a turn that starts during the wait calls the sending off, and the model turns it on by the tool', async ($, on) => {
  const env = world(on)
  await $.command.run({ command: 'anotar', args: 'primeiro' } as never)

  const answer = await $.tool.call({ tool: TOOL, tool_use_id: 'call-1', envio_automatico: true } as never)
  expect((answer as { result?: unknown }).result).toBe(
    'Painel atualizado: 0 passos, 0 termos, 0 pontos. Envio automático ligado. Prompts anotados: 1.',
  )

  await $.turn.complete(answered('answer'))
  await env.clock.advance(2000)
  await $.turn.start({ text: 'uma mensagem que o usuário digitou', turnId: 'turn-2' } as never)
  await env.clock.advance(6000)
  expect(env.sent).toHaveLength(0)

  // Still on: the end of that turn starts a new wait
  await $.turn.complete(answered('answer'))
  await env.clock.advance(5500)
  expect(env.sent.map(one => one.text)).toEqual(['primeiro'])
})

const USAGE = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 1, cache_creation_input_tokens: 0 }

test('/painel-recarregar fills the panel of a session that ran without it: past messages, steps, terms and points', async ($, on) => {
  const env = world(on)
  // One message sent with the panel on: it keeps its time and is not listed twice
  await $.prompt.submit({ text: 'Qual é o próximo passo?', wait: false, origin: { kind: 'composer' } })
  env.past.rows = [
    { role: 'user', text: 'Crie a tela de usuários', toolUses: [] },
    { role: 'assistant', text: 'Criei.', toolUses: [] },
    // Rows the user did not type
    { role: 'user', text: '<command-name>/anotar</command-name>', toolUses: [] },
    { role: 'user', text: '[SYSTEM NOTIFICATION - NOT USER INPUT] tarefa terminou', toolUses: [] },
    { role: 'user', text: 'Stop hook feedback: reescreva', toolUses: [] },
    { role: 'user', text: '', toolUses: [] },
    { role: 'user', text: 'Ajuste o espaçamento', toolUses: [] },
    { role: 'user', text: 'Qual é o próximo passo?', toolUses: [] },
  ]
  env.past.fork = {
    isAnswered: true,
    usage: USAGE,
    text:
      'Aqui está:\n```json\n' +
      JSON.stringify({
        steps: [
          { title: 'Criar a tela', status: 'done' },
          { title: 'Ajustar o espaçamento', status: 'current' },
        ],
        terms: [{ term: 'RBAC', meaning: 'Controle de acesso por papel' }],
        points: ['A tela usa o componente do pacote'],
      }) +
      '\n```',
  }

  const told = await $.command.run({ command: 'painel-recarregar', args: '' } as never)
  expect(told.text).toBe('Mensagens anteriores recarregadas: 2. Passos: 2. Termos: 1. Pontos: 1.')

  const pane = (await mounted($, { ...PANE, surface: 'desktop' } as never)) as unknown as Field
  // The two past messages have no time and come before the one sent with the panel on
  expect(await pane.findAll?.({ type: 'Button', text: 'antes ↗' })).toHaveLength(2)
  expect(await pane.find({ type: 'Text', text: 'Crie a tela de usuários' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: 'Stop hook feedback' })).toBe(undefined)
  expect(await pane.findAll?.({ type: 'Text', text: 'Qual é o próximo passo?' })).toHaveLength(1)
  expect((await pane.find({ type: 'Text', text: '2. Ajustar o espaçamento' }))?.props.bold).toBe(true)
  expect(await pane.find({ type: 'Text', text: /^RBAC$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: 'A tela usa o componente do pacote' })).toBeDefined()
})

test('the reload keeps the steps of the panel when the model does not answer or answers out of format', async ($, on) => {
  const env = world(on)
  await $.tool.call({ tool: TOOL, tool_use_id: 'call-1', steps: [{ title: 'Validar o mod', status: 'current' }] } as never)
  const pane = (await mounted($, { ...PANE, surface: 'desktop' } as never)) as unknown as Field

  await pane.press({ key: 'recarregar' })
  expect(env.toasts.at(-1)).toBe(
    'Mensagens anteriores recarregadas: 0. Passos, termos e pontos não foram recarregados: a conversa ainda não tem nenhuma resposta.',
  )

  env.past.fork = { isAnswered: true, usage: USAGE, text: 'Não consegui resumir.' }
  await pane.press({ key: 'recarregar' })
  expect(env.toasts.at(-1)).toBe(
    'Mensagens anteriores recarregadas: 0. Passos, termos e pontos não foram recarregados: a resposta do modelo veio fora do formato.',
  )

  env.past.fork = { isAnswered: false, reason: 'api-error', status: 529, error: 'overloaded', usage: USAGE }
  await pane.press({ key: 'recarregar' })
  expect(env.toasts.at(-1)).toBe(
    'Mensagens anteriores recarregadas: 0. Passos, termos e pontos não foram recarregados: a API retornou erro 529.',
  )
  await pane.redraw()
  expect(await pane.find({ type: 'Text', text: '1. Validar o mod' })).toBeDefined()
  // The button is back: no reload is left marked as under way
  expect(await pane.find({ key: 'recarregar' })).toBeDefined()
})

test('the list of messages names each day once it goes beyond today, and names none while every message is of today', async ($, on) => {
  const { clock } = world(on)
  const HOUR = 60 * 60 * 1000
  const say = (text: string) => $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } })

  // 02/10 at 11:44 and at 12:44
  await say('mensagem do dia 2, de manhã')
  await clock.advance(HOUR)
  await say('mensagem do dia 2, ao meio-dia')
  const pane = (await mounted($, { ...PANE, surface: 'desktop' } as never)) as unknown as Field
  expect(await pane.find({ type: 'Text', text: /^Hoje$/ })).toBe(undefined)

  // 05/10 at 23:50, then 06/10 at 00:10: twenty minutes apart and on two days
  await clock.advance(3 * 24 * HOUR + 11 * HOUR + 6 * 60 * 1000)
  await say('mensagem do dia 5, perto da meia-noite')
  await clock.advance(20 * 60 * 1000)
  await say('mensagem do dia 6')
  await pane.redraw()

  expect(await pane.findAll?.({ type: 'Text', text: /^Hoje$/ })).toHaveLength(1)
  expect(await pane.findAll?.({ type: 'Text', text: /^Ontem · 05\/10\/2026$/ })).toHaveLength(1)
  // The two messages of 02/10 are under one line
  expect(await pane.findAll?.({ type: 'Text', text: /^02\/10\/2026 · há 4 dias$/ })).toHaveLength(1)
  expect(await pane.find({ type: 'Button', text: '23:50 ↗' })).toBeDefined()
  expect(await pane.find({ type: 'Button', text: '00:10 ↗' })).toBeDefined()
})

test('notes: each Enter writes a line, a line is changed in the field, deleted, and all are cleared after a confirmation', async ($, on) => {
  const env = world(on)
  const pane = (await mounted($, { ...PANE, surface: 'desktop' } as never)) as unknown as Field
  const lines = async () => {
    const found: string[] = []
    for (const text of ['comprar pão', 'ligar para o cliente', 'ligar para a empresa', 'revisar o contrato']) {
      if ((await pane.find({ type: 'Text', text: new RegExp('^' + text + '$') })) !== undefined) found.push(text)
    }
    return found
  }

  expect(await pane.find({ type: 'Text', text: 'Nenhuma anotação nesta sessão.' })).toBeDefined()
  await pane.input({ key: 'nova-anotacao', text: 'comprar pão' })
  await pane.input({ key: 'nova-anotacao', text: 'ligar para o cliente' })
  await pane.input({ key: 'nova-anotacao', text: '   ' })
  expect(await lines()).toEqual(['comprar pão', 'ligar para o cliente'])
  expect(await pane.find({ type: 'Text', text: '2 linhas' })).toBeDefined()
  // Writing a note sends nothing to the conversation
  expect(env.sent).toHaveLength(0)

  // The second line goes to the field, and Enter replaces it
  await pane.press({ key: 'nota-editar-1' })
  expect((await pane.find({ key: 'nova-anotacao' }))?.props.value).toBe('ligar para o cliente')
  expect((await pane.find({ key: 'nova-anotacao' }))?.props.submitLabel).toBe('Salvar')
  await pane.input({ key: 'nova-anotacao', text: 'ligar para a empresa' })
  expect(await lines()).toEqual(['comprar pão', 'ligar para a empresa'])
  expect((await pane.find({ key: 'nova-anotacao' }))?.props.value).toBe('')

  await pane.press({ key: 'nota-excluir-0' })
  expect(await lines()).toEqual(['ligar para a empresa'])

  // "Limpar tudo" asks first: "Manter" keeps the notes, "Excluir" deletes them
  await pane.press({ key: 'notas-limpar' })
  expect(await pane.find({ type: 'Text', text: 'Excluir todas as anotações?' })).toBeDefined()
  await pane.press({ key: 'notas-limpar-nao' })
  expect(await lines()).toEqual(['ligar para a empresa'])
  await pane.press({ key: 'notas-limpar' })
  await pane.press({ key: 'notas-limpar-sim' })
  expect(await lines()).toEqual([])
  expect(await pane.find({ key: 'notas-limpar' })).toBe(undefined)
})

test('notes: /nota writes a text of several lines, and the model reads none of the notes', async ($, on) => {
  const env = world(on)
  await $.command.run({ command: 'nota', args: 'revisar o contrato\n\ncomprar pão' } as never)
  expect(env.toasts.at(-1)).toBe('Escrito em Anotações: revisar o contrato comprar pão')

  const pane = (await mounted($, { ...PANE, surface: 'desktop' } as never)) as unknown as Field
  // The blank line between the two is kept
  expect(await pane.find({ type: 'Text', text: '3 linhas' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^revisar o contrato$/ })).toBeDefined()

  const entered = await $.prompt.submit({ text: 'Qual é o próximo passo?', wait: false, origin: { kind: 'composer' } })
  expect(String(entered.context?.[0])).toContain('Passos no painel agora')
  expect(String(entered.context?.[0]).includes('revisar o contrato')).toBe(false)
})

// The tests below cover the findings of the review of 06/10/2026

test('after a compaction the next prompt carries the state of the panel again', async ($, on) => {
  world(on)
  const say = (text: string) => $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } })

  expect((await say('primeira')).context?.[0]).toContain('Passos no painel agora')
  expect((await say('segunda')).context).toBe(undefined)
  await $.session.compact({ trigger: 'auto', messages: [{ role: 'user', text: 'conversa', toolUses: [] }] } as never)
  expect((await say('terceira')).context?.[0]).toContain('Passos no painel agora')
})

test('a prompt that did not enter is not listed among the messages sent', async ($, on) => {
  const env = world(on)
  await $.command.run({ command: 'anotar', args: 'Atualize a timeline' } as never)
  const pane = (await mounted($, { ...PANE, surface: 'desktop' } as never)) as unknown as Field

  env.rules.drop = 'bloqueado por uma regra'
  await pane.press({ key: 'enviar-1' })
  await pane.redraw()
  expect(await pane.find({ type: 'Button', text: '11:44 ↗' })).toBe(undefined)
  expect(await pane.find({ type: 'Text', text: 'Nenhuma mensagem enviada desde que o painel foi ligado.' })).toBeDefined()

  // Sent again with the rule gone, it enters once and is listed once
  env.rules.drop = null
  await pane.press({ key: 'enviar-1' })
  await pane.redraw()
  expect(env.sent).toHaveLength(1)
  expect(await pane.findAll?.({ type: 'Button', text: '11:44 ↗' })).toHaveLength(1)
})

test('a failure while the panel is filled from the conversation is told to the user', async ($, on) => {
  const env = world(on)
  env.past.isBroken = true
  const pane = (await mounted($, { ...PANE, surface: 'desktop' } as never)) as unknown as Field

  await pane.press({ key: 'recarregar' })
  expect(String(env.toasts.at(-1))).toContain('O painel não foi recarregado: ')
  await pane.redraw()
  expect(await pane.find({ key: 'recarregar' })).toBeDefined()

  const told = await $.command.run({ command: 'painel-recarregar', args: '' } as never)
  expect(String(told.text)).toContain('O painel não foi recarregado: ')
})

test('notes: deleting a line while another is being changed empties the field, and blanks write nothing', async ($, on) => {
  world(on)
  const pane = (await mounted($, { ...PANE, surface: 'desktop' } as never)) as unknown as Field
  await pane.input({ key: 'nova-anotacao', text: 'primeira' })
  await pane.input({ key: 'nova-anotacao', text: 'segunda' })

  await pane.press({ key: 'nota-editar-1' })
  expect((await pane.find({ key: 'nova-anotacao' }))?.props.value).toBe('segunda')
  await pane.press({ key: 'nota-excluir-0' })
  expect((await pane.find({ key: 'nova-anotacao' }))?.props.value).toBe('')
  expect((await pane.find({ key: 'nova-anotacao' }))?.props.submitLabel).toBe('Escrever')
  expect(await pane.find({ type: 'Text', text: '1 linha' })).toBeDefined()

  // Typing only spaces and Enter: nothing is written and the field is drawn again, empty
  await pane.input({ key: 'nova-anotacao', text: '   ', kind: 'change' })
  await pane.input({ key: 'nova-anotacao', text: '   ' })
  expect((await pane.find({ key: 'nova-anotacao' }))?.props.value).toBe('')
  expect(await pane.find({ type: 'Text', text: '1 linha' })).toBeDefined()
})

test('notes: a line is cut at 1000 characters and the 201st line is refused', async ($, on) => {
  const env = world(on)
  await $.command.run({ command: 'nota', args: 'x'.repeat(1500) } as never)
  const pane = (await mounted($, { ...PANE, surface: 'desktop' } as never)) as unknown as Field
  const line = (await pane.find({ type: 'Text', text: /^x+$/ })) as unknown as { text: string } | undefined
  expect(line?.text.length).toBe(1000)

  await $.command.run({ command: 'nota', args: Array.from({ length: 199 }, (_, i) => 'linha ' + i).join('\n') } as never)
  await pane.redraw()
  expect(await pane.find({ type: 'Text', text: '200 linhas' })).toBeDefined()
  await $.command.run({ command: 'nota', args: 'mais uma' } as never)
  await pane.redraw()
  expect(env.toasts.at(-1)).toBe('Anotações já tem 200 linhas, que é o limite. Exclua alguma antes de escrever outra.')
  expect(await pane.find({ type: 'Text', text: '200 linhas' })).toBeDefined()
})

test('automatic sending: while an agent runs, the panel says it is waiting for the agent', async ($, on) => {
  const env = world(on)
  await $.command.run({ command: 'anotar', args: 'primeiro' } as never)
  const pane = (await mounted($, { ...PANE, surface: 'desktop' } as never)) as unknown as Field
  const waiting = { type: 'Text', text: 'Aguardando um agente em segundo plano terminar para enviar.' }

  // Turned on with no answer running, the sending would start its 5 seconds at once: here an agent runs
  env.rules.agents = [{ id: 'agent-1', status: 'running' }]
  await $.command.run({ command: 'envio-automatico', args: 'ligar' } as never)
  await $.turn.complete(answered('answer'))
  await pane.redraw()
  expect(await pane.find(waiting)).toBeDefined()

  // The notice of the agent's end starts a turn: the text goes, and at that turn's end the wait of 5 seconds starts
  env.rules.agents = [{ id: 'agent-1', status: 'completed' }]
  await $.turn.start({ text: 'o agente terminou', turnId: 'turn-2' } as never)
  await pane.redraw()
  expect(await pane.find(waiting)).toBe(undefined)
  await $.turn.complete(answered('answer'))
  await pane.redraw()
  expect(await pane.find({ key: 'cancelar-envio' })).toBeDefined()
})

// The tests below cover the layout of 07/10/2026: one view with sections that close, and the list of sessions

test('the panel starts with four sections closed, each with its summary in one line beside the title', async ($, on) => {
  world(on)
  await $.tool.call({
    tool: TOOL,
    tool_use_id: 'call-1',
    steps: [
      { title: 'Ler a documentação', status: 'done' },
      { title: 'Validar o mod', status: 'current' },
      { title: 'Testar no aplicativo', status: 'next' },
    ],
    terms: [{ term: 'Mod', meaning: 'Plugin do Claude Code' }],
    points: ['O painel é por sessão', 'O mod carrega em uma sessão'],
  } as never)
  await $.prompt.submit({ text: 'Qual é o próximo passo?', wait: false, origin: { kind: 'composer' } })
  await $.command.run({ command: 'anotar', args: 'Rode os testes' } as never)
  await $.command.run({ command: 'nota', args: 'ligar para a empresa' } as never)
  await $.session.measure({
    context: { tokens: 441_200, window: 1_000_000, percent: 44 },
    rateLimits: [{ kind: 'seven_day', percentUsed: 35 }],
    changed: ['context', 'rateLimits'],
  } as never)

  for (const surface of ['desktop', 'terminal'] as const) {
    const pane = (await $.ui.mount({ ...PANE, surface } as never)) as unknown as Field
    const label = async (id: string) => (await pane.find({ key: 'secao-' + id }))?.props.label

    // Open: the two sections that ask something of the user
    expect(await label('decisoes')).toBe('▾ DECISÕES SUAS')
    expect(await label('prompts')).toBe('▾ PRÓXIMOS PROMPTS')
    expect(await pane.find({ key: 'enviar-1' })).toBeDefined()

    // Closed, with the summary
    expect(await label('passos')).toBe('▸ PASSOS')
    expect(await pane.find({ type: 'Text', text: '1 de 3 · a seguir: Testar no aplicativo' })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: '2. Validar o mod' })).toBe(undefined)
    expect(await label('mensagens')).toBe('▸ MINHAS ÚLTIMAS MENSAGENS')
    expect(await pane.find({ type: 'Text', text: '11:44 · Qual é o próximo passo?' })).toBeDefined()
    expect(await label('notas')).toBe('▸ NOTAS')
    expect(await pane.find({ type: 'Text', text: '1 anotação · 2 pontos · 1 termo' })).toBeDefined()
    expect(await label('contexto')).toBe('▸ CONTEXTO E LIMITES')
    expect(await pane.find({ type: 'Text', text: '44% · 441,2k de 1M · semana 35%' })).toBeDefined()

    // The top always shows the current step, with no section open
    expect(await pane.find({ type: 'Text', text: 'Passo 2 de 3' })).toBeDefined()
    expect((await pane.find({ type: 'Text', text: /^Validar o mod$/ }))?.props.bold).toBe(true)
    await (pane as unknown as { unmount: () => Promise<void> }).unmount()
  }
})

test('the top of the panel says whether the session answers or waits for the user, and for how long', async ($, on) => {
  const env = world(on)
  const pane = (await $.ui.mount({ ...PANE, surface: 'desktop' } as never)) as unknown as Field
  const top = async (text: string | RegExp) => pane.find({ type: 'Text', text })

  expect(await top('Nenhuma resposta nesta sessão desde que o painel foi ligado')).toBeDefined()

  await $.turn.start({ text: 'Qual é o próximo passo?', turnId: 'turn-1' } as never)
  await pane.redraw()
  expect(await top(/^Respondendo agora$/)).toBeDefined()
  await env.clock.advance(3 * 60 * 1000)
  await pane.redraw()
  expect(await top(/^Respondendo há 3 min$/)).toBeDefined()

  await $.turn.complete(answered('answer'))
  await pane.redraw()
  expect(await top(/^Aguardando você agora$/)).toBeDefined()
  expect(await top('resposta 11:47')).toBeDefined()
  await env.clock.advance(72 * 60 * 1000)
  await pane.redraw()
  expect(await top(/^Aguardando você há 1 h 12 min$/)).toBeDefined()
})

test('the decisions the model leaves for the user are listed, go to the model, and leave when resolved', async ($, on) => {
  world(on)
  const answer = await $.tool.call({
    tool: TOOL,
    tool_use_id: 'call-1',
    decisions: ['Corrigir os 10 achados?', 'Testar a caixa de texto livre?'],
  } as never)
  expect((answer as { result?: unknown }).result).toBe(
    'Painel atualizado: 0 passos, 0 termos, 0 pontos. Decisões do usuário: 2.',
  )

  const entered = await $.prompt.submit({ text: 'Sim', wait: false, origin: { kind: 'composer' } })
  expect(String(entered.context?.[0])).toContain(
    'Decisões que o usuário precisa tomar, no painel agora: Corrigir os 10 achados?; Testar a caixa de texto livre?.',
  )

  const pane = (await $.ui.mount({ ...PANE, surface: 'desktop' } as never)) as unknown as Field
  expect(await pane.find({ type: 'Text', text: 'Corrigir os 10 achados?' })).toBeDefined()
  await pane.press({ key: 'decisao-resolvida-0' })
  expect(await pane.find({ type: 'Text', text: 'Corrigir os 10 achados?' })).toBe(undefined)
  expect(await pane.find({ type: 'Text', text: 'Testar a caixa de texto livre?' })).toBeDefined()

  // A call that sends no list leaves the decisions; an empty list clears them
  await $.tool.call({ tool: TOOL, tool_use_id: 'call-2', points: ['Um ponto'] } as never)
  await pane.redraw()
  expect(await pane.find({ type: 'Text', text: 'Testar a caixa de texto livre?' })).toBeDefined()
  await $.tool.call({ tool: TOOL, tool_use_id: 'call-3', decisions: [] } as never)
  await pane.redraw()
  expect(await pane.find({ type: 'Text', text: 'Nenhuma decisão pendente.' })).toBeDefined()
})

test('a noted prompt shows "Enviar" and one button that opens the other actions', async ($, on) => {
  world(on)
  await $.command.run({ command: 'anotar', args: 'primeiro' } as never)
  await $.command.run({ command: 'anotar', args: 'segundo' } as never)
  const pane = (await $.ui.mount({ ...PANE, surface: 'desktop' } as never)) as unknown as Field

  for (const key of ['caixa-1', 'copiar-1', 'excluir-1']) expect(await pane.find({ key })).toBe(undefined)
  await pane.press({ key: 'mais-1' })
  for (const key of ['caixa-1', 'copiar-1', 'excluir-1']) expect(await pane.find({ key })).toBeDefined()
  // The actions of one prompt at a time
  expect(await pane.find({ key: 'excluir-2' })).toBe(undefined)
  await pane.press({ key: 'mais-2' })
  expect(await pane.find({ key: 'excluir-1' })).toBe(undefined)
  expect(await pane.find({ key: 'excluir-2' })).toBeDefined()
  await pane.press({ key: 'mais-2' })
  expect(await pane.find({ key: 'excluir-2' })).toBe(undefined)
})

test('the second view lists the sessions of the machine: this one first, then the ones that wait for the user', async ($, on) => {
  const HOUR = 60 * 60 * 1000
  const other = (name: string, more: Record<string, unknown>) => ({
    asks: [],
    steps: [
      { title: 'Criar a tela', status: 'done' },
      { title: 'Revisar o texto', status: 'current' },
    ],
    terms: [],
    points: [],
    queue: [{ id: 1, text: 'um prompt' }],
    name,
    savedAt: START - 10 * 60 * 1000,
    ...more,
  })
  world(on, {
    'board:sessao-b': other('api-pedidos', { turnEndedAt: START - 47 * 60 * 1000, decisions: ['Publicar?'] }),
    'board:sessao-c': other('loja-web', { working: true, turnStartedAt: START - 3 * 60 * 1000 }),
    'board:sessao-d': other('site-docs', { ended: true }),
    'board:sessao-e': other('antiga', { turnEndedAt: START - 20 * HOUR, savedAt: START - 20 * HOUR }),
  })
  await $.classic.UserPromptSubmit({ prompt: 'oi', session_title: 'Painel da sessão' } as never)
  const pane = (await $.ui.mount({ ...PANE, surface: 'desktop' } as never)) as unknown as Field

  await pane.press({ key: 'aba-sessoes' })
  const texts = (await pane.findAll?.({ type: 'Text', text: /./ })) as { text: string; props: Record<string, unknown> }[]
  const names = texts.filter(one => one.props.bold === true).map(one => one.text)
  expect(names).toEqual(['Painel da sessão · esta sessão', 'api-pedidos', 'loja-web', 'site-docs', 'antiga'])
  expect(await pane.find({ type: 'Text', text: /^aguardando você$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: 'há 47 min' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: 'Passo 2 de 2 · 1 decisão sua · 1 prompt anotado' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^respondendo$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^encerrada$/ })).toBeDefined()
  // A session that saved nothing for 12 hours is not waiting: it is stopped
  expect(await pane.find({ type: 'Text', text: /^sem atividade$/ })).toBeDefined()
  // The sections of this session are not drawn in the second view
  expect(await pane.find({ key: 'secao-passos' })).toBe(undefined)

  // Back in the first view, the name of the second one counts the other sessions that wait for the user
  await pane.press({ key: 'aba-sessao' })
  expect(await pane.find({ key: 'secao-passos' })).toBeDefined()
  expect((await pane.find({ key: 'aba-sessoes' }))?.props.label).toBe('Sessões 1')
})

// The tests below cover the seven notes the user left on 06/10/2026, done on 07/10/2026

type Closing = { unmount: () => Promise<void> }
const STARTED = { cwd: '/work', surface: 'desktop', isInteractive: true } as const

test('a surface other than the desktop app draws what was typed, and a key typed draws nothing by itself', async ($, on) => {
  world(on)
  const pane = (await mounted($, { ...PANE, surface: 'vscode' } as never)) as unknown as Field

  await pane.input({ key: 'novo-prompt', text: 'manter', kind: 'change' })
  // The key wrote the session's state, which the drawing does not read: the field is as it was drawn
  expect((await pane.find({ key: 'novo-prompt' }))?.props.value).toBe('')
  await pane.redraw()
  expect((await pane.find({ key: 'novo-prompt' }))?.props.value).toBe('manter')
})

test('desktop: a field the mod filled is drawn with no value once the user types in it, and empty after Enter', async ($, on) => {
  world(on)
  await $.command.run({ command: 'nota', args: 'ligar para a empresa' } as never)
  const pane = (await mounted($, { ...PANE, surface: 'desktop' } as never)) as unknown as Field
  const value = async () => (await pane.find({ key: 'nova-anotacao' }))?.props.value

  // No value at first: the app's own field keeps whatever the user types
  expect(await value()).toBe(undefined)
  await pane.press({ key: 'nota-editar-0' })
  expect(await value()).toBe('ligar para a empresa')
  // A drawing with the same value leaves the field to the app
  await pane.redraw()
  expect(await value()).toBe('ligar para a empresa')

  // The first key drops the value and draws the pane, so the app's page forgets the value drawn before
  await pane.input({ key: 'nova-anotacao', text: 'ligar para a empresa X', kind: 'change' })
  expect(await value()).toBe(undefined)
  await pane.input({ key: 'nova-anotacao', text: 'ligar para a empresa X' })
  expect(await value()).toBe('')
  expect(await pane.find({ type: 'Text', text: /^ligar para a empresa X$/ })).toBeDefined()
})

test('a noted prompt moves up and down, and the automatic sending sends the one that is first', async ($, on) => {
  const env = world(on)
  for (const text of ['primeiro', 'segundo', 'terceiro']) await $.command.run({ command: 'anotar', args: text } as never)
  const pane = (await mounted($, { ...PANE, surface: 'desktop' } as never)) as unknown as Field

  await pane.press({ key: 'mais-1' })
  // The first has nowhere to go up, the last nowhere to go down
  expect(await pane.find({ key: 'subir-1' })).toBe(undefined)
  await pane.press({ key: 'descer-1' })
  expect(await pane.find({ key: 'subir-1' })).toBeDefined()
  await pane.press({ key: 'descer-1' })
  expect(await pane.find({ key: 'descer-1' })).toBe(undefined)
  // segundo, terceiro, primeiro; then the last goes up one place
  await pane.press({ key: 'subir-1' })

  await $.command.run({ command: 'envio-automatico', args: 'ligar' } as never)
  await env.clock.advance(5500)
  expect(env.sent.map(one => one.text)).toEqual(['segundo'])
  await $.turn.complete(answered('answer'))
  await env.clock.advance(5500)
  await $.turn.complete(answered('answer'))
  await env.clock.advance(5500)
  expect(env.sent.map(one => one.text)).toEqual(['segundo', 'primeiro', 'terceiro'])
})

test('notes: the line being changed moves up and down, and stays the one being changed', async ($, on) => {
  const env = world(on)
  await $.command.run({ command: 'nota', args: 'um\ndois\ntrês' } as never)
  const pane = (await mounted($, { ...PANE, surface: 'desktop' } as never)) as unknown as Field

  expect(await pane.find({ key: 'nota-descer' })).toBe(undefined)
  await pane.press({ key: 'nota-editar-0' })
  expect(await pane.find({ key: 'nota-subir' })).toBe(undefined)
  await pane.press({ key: 'nota-descer' })
  await pane.press({ key: 'nota-descer' })
  expect(await pane.find({ key: 'nota-descer' })).toBe(undefined)
  expect((await pane.find({ key: 'nova-anotacao' }))?.props.value).toBe('um')
  await pane.press({ key: 'notas-copiar' })
  expect(env.copied.at(-1)).toBe('dois\ntrês\num')

  await pane.press({ key: 'nota-subir' })
  await pane.press({ key: 'notas-copiar' })
  expect(env.copied.at(-1)).toBe('dois\num\ntrês')
})

test('automatic sending: turned on with no answer running, the first prompt enters in 5 seconds', async ($, on) => {
  const env = world(on)
  await $.command.run({ command: 'anotar', args: 'primeiro' } as never)
  const pane = (await mounted($, { ...PANE, surface: 'desktop' } as never)) as unknown as Field

  await pane.press({ key: 'envio-automatico' })
  expect(await pane.find({ key: 'cancelar-envio' })).toBeDefined()
  await env.clock.advance(5500)
  expect(env.sent.map(one => one.text)).toEqual(['primeiro'])
  await pane.redraw()
  expect(await pane.find({ type: 'Text', text: 'Último evento do envio automático: 11:44 · prompt enviado: primeiro' })).toBeDefined()
})

test('automatic sending: a prompt that did not enter is sent again without a new answer', async ($, on) => {
  const env = world(on)
  await $.session.start(STARTED as never)
  await $.command.run({ command: 'anotar', args: 'primeiro' } as never)

  env.rules.drop = 'bloqueado por uma regra'
  await $.command.run({ command: 'envio-automatico', args: 'ligar' } as never)
  await env.clock.advance(5500)
  expect(env.sent).toHaveLength(0)
  expect(env.toasts.at(-1)).toBe('O prompt não foi enviado e continua em Próximos prompts: bloqueado por uma regra')

  // No answer ends: the session is looked at again every 15 seconds, and the 5 seconds start once more
  env.rules.drop = null
  await env.clock.advance(15_000 + 5500)
  expect(env.sent.map(one => one.text)).toEqual(['primeiro'])
})

test('automatic sending: after 3 sendings that did not enter it turns off, and the panel says why', async ($, on) => {
  const env = world(on)
  await $.session.start(STARTED as never)
  await $.command.run({ command: 'anotar', args: 'primeiro' } as never)
  const pane = (await mounted($, { ...PANE, surface: 'desktop' } as never)) as unknown as Field

  env.rules.drop = 'bloqueado por uma regra'
  await $.command.run({ command: 'envio-automatico', args: 'ligar' } as never)
  await env.clock.advance(5500)
  await env.clock.advance(15_000)
  await pane.redraw()
  expect((await pane.find({ key: 'envio-automatico' }))?.props.label).toBe('Envio automático: ligado')
  await env.clock.advance(15_000)
  expect(env.sent).toHaveLength(0)
  expect(env.toasts.at(-1)).toBe('Envio automático desligado: o prompt não entrou na conversa em 3 tentativas.')

  await pane.redraw()
  expect((await pane.find({ key: 'envio-automatico' }))?.props.label).toBe('Envio automático: desligado')
  expect(
    await pane.find({ type: 'Text', text: 'Desligado às 11:44: o prompt não entrou na conversa em 3 tentativas.' }),
  ).toBeDefined()
  expect(await pane.find({ key: 'enviar-1' })).toBeDefined()
  // Nothing else is tried
  env.rules.drop = null
  await env.clock.advance(60_000)
  expect(env.sent).toHaveLength(0)

  // Turned on again, the reason leaves the panel, and it does not come back when the user turns it off
  await pane.press({ key: 'envio-automatico' })
  await pane.press({ key: 'envio-automatico' })
  expect((await pane.find({ key: 'envio-automatico' }))?.props.label).toBe('Envio automático: desligado')
  expect(await pane.find({ type: 'Text', text: 'Desligado às' })).toBe(undefined)
})

test('automatic sending: a prompt moved to the first place during the wait gets a wait of its own', async ($, on) => {
  const env = world(on)
  await $.command.run({ command: 'anotar', args: 'primeiro' } as never)
  await $.command.run({ command: 'anotar', args: 'segundo' } as never)
  const pane = (await mounted($, { ...PANE, surface: 'desktop' } as never)) as unknown as Field

  await $.command.run({ command: 'envio-automatico', args: 'ligar' } as never)
  await env.clock.advance(2000)
  await pane.redraw()
  await pane.press({ key: 'mais-2' })
  await pane.press({ key: 'subir-2' })
  // The 5 seconds that were counting for "primeiro" end here, and nothing is sent
  await env.clock.advance(3500)
  expect(env.sent).toHaveLength(0)
  await env.clock.advance(2000)
  expect(env.sent.map(one => one.text)).toEqual(['segundo'])
})

test('automatic sending: an answer the user interrupted leaves the reason in the panel', async ($, on) => {
  world(on)
  await $.command.run({ command: 'anotar', args: 'primeiro' } as never)
  await $.command.run({ command: 'envio-automatico', args: 'ligar' } as never)
  const pane = (await mounted($, { ...PANE, surface: 'desktop' } as never)) as unknown as Field

  await $.turn.complete(answered('aborted'))
  await pane.redraw()
  expect(await pane.find({ type: 'Text', text: 'Desligado às 11:44: a resposta foi interrompida.' })).toBeDefined()
})

test('automatic sending: the survey of the app holds the sending, and the prompt goes when the survey leaves the screen', async ($, on) => {
  const env = world(on)
  await $.command.run({ command: 'anotar', args: 'primeiro' } as never)
  const survey = await $.ui.mount({ ...BAND, surface: 'desktop', props: { ...BAND.props, hasSurvey: true } } as never)

  await $.command.run({ command: 'envio-automatico', args: 'ligar' } as never)
  const pane = (await mounted($, { ...PANE, surface: 'desktop' } as never)) as unknown as Field
  expect(
    await pane.find({ type: 'Text', text: 'Aguardando a pesquisa do aplicativo sair da tela para enviar.' }),
  ).toBeDefined()
  await env.clock.advance(6000)
  expect(env.sent).toHaveLength(0)

  await survey.unmount()
  await $.ui.mount({ ...BAND, surface: 'desktop' } as never)
  await env.clock.settle()
  await env.clock.advance(5500)
  expect(env.sent.map(one => one.text)).toEqual(['primeiro'])
})

test('automatic sending: a survey that stays on the screen holds the sending for 3 minutes, not for ever', async ($, on) => {
  const env = world(on)
  await $.session.start(STARTED as never)
  await $.command.run({ command: 'anotar', args: 'primeiro' } as never)
  await $.ui.mount({ ...BAND, surface: 'desktop', props: { ...BAND.props, hasSurvey: true } } as never)
  await $.command.run({ command: 'envio-automatico', args: 'ligar' } as never)

  await env.clock.advance(2 * 60 * 1000)
  expect(env.sent).toHaveLength(0)
  await env.clock.advance(60 * 1000 + 15_000 + 5500)
  expect(env.sent.map(one => one.text)).toEqual(['primeiro'])
})

test('a prompt sent that starts no turn is noted again after two minutes with no answer running', async ($, on) => {
  const env = world(on)
  await $.session.start(STARTED as never)
  await $.command.run({ command: 'anotar', args: 'primeiro' } as never)
  const pane = (await mounted($, { ...PANE, surface: 'desktop' } as never)) as unknown as Field

  env.gate.wait = new Promise<void>(() => {})
  void pane.press({ key: 'enviar-1' })
  await env.clock.settle()
  await env.clock.advance(105_000)
  await pane.redraw()
  expect(await pane.find({ key: 'enviar-1' })).toBe(undefined)

  await env.clock.advance(30_000)
  await pane.redraw()
  expect(await pane.find({ key: 'enviar-1' })).toBeDefined()
  // It is not listed among the messages sent
  expect(await pane.find({ type: 'Button', text: '11:44 ↗' })).toBe(undefined)
})

test('desktop: a move of focus the user makes in the pane does not reach the engine, which would draw the pane again', async ($, on) => {
  const env = world(on)
  const move = { component: 'Pane', requestId: 'painel-sessao', plugin: PLUGIN, element: 'secao-passos', origin: { kind: 'person' } }

  const desktop = (await mounted($, { ...PANE, surface: 'desktop' } as never)) as unknown as Field & Closing
  await $.ui.focus(move as never)
  expect(env.moves.count).toBe(0)
  // A move the mod itself asks for goes through
  await $.ui.focus({ ...move, origin: { kind: 'plugin', name: PLUGIN } } as never)
  expect(env.moves.count).toBe(1)
  await desktop.unmount()

  // The terminal draws its own ring, which Tab and the arrows move
  await mounted($, { ...PANE, surface: 'terminal' } as never)
  await $.ui.focus(move as never)
  expect(env.moves.count).toBe(2)
})

test('a message of the user and the whole panel are copied by a button', async ($, on) => {
  const env = world(on)
  await $.tool.call({
    tool: TOOL,
    tool_use_id: 'call-1',
    steps: [
      { title: 'Ler a documentação', status: 'done' },
      { title: 'Validar o mod', status: 'current' },
    ],
    points: ['O painel é por sessão'],
    terms: [{ term: 'Mod', meaning: 'Plugin do Claude Code' }],
    decisions: ['Publicar?'],
  } as never)
  await $.prompt.submit({ text: 'Qual é o próximo passo?', wait: false, origin: { kind: 'composer' } })
  const pane = (await mounted($, { ...PANE, surface: 'desktop' } as never)) as unknown as Field

  await pane.press({ key: 'copiar-msg-' + START })
  expect(env.copied).toEqual(['Qual é o próximo passo?'])
  await pane.press({ key: 'copiar-painel' })
  expect(env.copied.at(-1)).toBe(
    [
      'Passos',
      '[x] 1. Ler a documentação',
      '[>] 2. Validar o mod',
      '',
      'Decisões suas',
      '- Publicar?',
      '',
      'Pontos importantes',
      '- O painel é por sessão',
      '',
      'Termos',
      '- Mod: Plugin do Claude Code',
    ].join('\n'),
  )
})

test('desktop: buttons that wrap onto a second row keep room between the rows', async ($, on) => {
  world(on)
  await $.command.run({ command: 'anotar', args: 'primeiro' } as never)
  await $.command.run({ command: 'nota', args: 'uma linha' } as never)
  const pane = (await mounted($, { ...PANE, surface: 'desktop' } as never)) as unknown as Field
  const rows = ((await pane.findAll?.({ type: 'Box' })) ?? []) as { props: Record<string, unknown> }[]
  // Every row of buttons that may wrap: the last one of the panel, the ones of a noted prompt and of the notes
  const wrapping = rows.filter(row => row.props.flexWrap === 'wrap' && row.props.columnGap === 1)

  expect(wrapping.length >= 5).toBe(true)
  expect(wrapping.every(row => row.props.rowGap === 0.5)).toBe(true)
})

test('desktop: the box of several lines is a trial the user turns on and off', async ($, on) => {
  world(on)
  const pane = (await mounted($, { ...PANE, surface: 'desktop' } as never)) as unknown as Field

  expect(await pane.find({ key: AREA })).toBe(undefined)
  expect((await pane.find({ key: 'caixa-larga' }))?.props.label).toBe('Testar caixa larga de várias linhas')
  await pane.press({ key: 'caixa-larga' })
  expect(await pane.find({ key: AREA })).toBeDefined()
  expect(await pane.find({ key: 'novo-prompt' })).toBe(undefined)
  expect((await pane.find({ key: 'caixa-larga' }))?.props.label).toBe('Voltar ao campo de uma linha')

  await pane.press({ key: 'caixa-larga' })
  expect(await pane.find({ key: AREA })).toBe(undefined)
  expect(await pane.find({ key: 'novo-prompt' })).toBeDefined()
  // Not covered: the return to the field of one line when the app fails to draw the box (the `ui.fault`
  // hook). The kit of Claude Code 2.1.289 has no way to raise that event.

  // The other surfaces that draw a pane do not offer the trial
  const vscode = (await mounted($, { ...PANE, surface: 'vscode' } as never)) as unknown as Field
  expect(await vscode.find({ key: 'caixa-larga' })).toBe(undefined)
})

// The tests below cover the plugin's two options: the language of the panel and the time zone of its times

const ENGLISH = { language: 'en', timeZone: 'America/Sao_Paulo' }
type Drawn = { text: string; props: Record<string, unknown> }

engineTest('english: the tool, the sections, the top, the band and the line under an answer', { options: ENGLISH }, async ($, on) => {
  const env = world(on)
  // A command that is not the mod's: the Portuguese names are not registered in English
  on('command.run', () => ({ text: 'answered by another command' }) as never)
  const answer = await $.tool.call({
    tool: TOOL,
    tool_use_id: 'call-1',
    steps: [
      { title: 'Read the docs', status: 'done' },
      { title: 'Validate the mod', status: 'current' },
      { title: 'Try it in the app', status: 'next' },
    ],
    decisions: ['Publish?'],
  } as never)
  expect((answer as { result?: unknown }).result).toBe('Panel updated: 3 steps, 0 terms, 0 points. Decisions for the user: 1.')

  const entered = await $.prompt.submit({ text: 'What is next?', wait: false, origin: { kind: 'composer' } })
  expect(String(entered.context?.[0])).toContain('Steps in the panel now: 1. [done] Read the docs; 2. [current] Validate the mod')
  expect(String(entered.context?.[0])).toContain('Decisions the user has to make, in the panel now: Publish?.')

  // The command has an English name. The Portuguese one is not the mod's in English: it goes on to
  // whatever else answers it, here the command of this test
  await $.command.run({ command: 'queue', args: 'Run the tests' } as never)
  expect(env.toasts.at(-1)).toBe('Prompt queued: Run the tests')
  expect((await $.command.run({ command: 'anotar', args: 'Then commit' } as never)).text).toBe('answered by another command')
  expect(env.toasts.at(-1)).toBe('Prompt queued: Run the tests')

  const pane = (await $.ui.mount({ ...PANE, surface: 'desktop' } as never)) as unknown as Field
  const label = async (key: string) => (await pane.find({ key }))?.props.label
  expect(await label('secao-decisoes')).toBe('▾ YOUR DECISIONS')
  expect(await label('secao-prompts')).toBe('▾ NEXT PROMPTS')
  expect(await label('secao-passos')).toBe('▸ STEPS')
  expect(await label('secao-mensagens')).toBe('▸ MY LAST MESSAGES')
  expect(await label('secao-notas')).toBe('▸ NOTES')
  expect(await label('secao-contexto')).toBe('▸ CONTEXT AND LIMITS')
  expect(await pane.find({ type: 'Text', text: '1 of 3 · next: Try it in the app' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: 'Step 2 of 3' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: 'No answer in this session since the panel was turned on' })).toBeDefined()
  expect(await label('enviar-1')).toBe('➤ Send')
  expect(await label('envio-automatico')).toBe('Auto-send: off')
  expect(await label('decisao-resolvida-0')).toBe('✓ Resolved')
  expect(await label('aba-sessoes')).toBe('Sessions')

  const band = await $.ui.mount({ ...BAND, surface: 'desktop' } as never)
  expect(await band.find({ type: 'Text', text: '● Step 2 of 3' })).toBeDefined()
  expect(await band.find({ type: 'Text', text: '1 queued prompt' })).toBeDefined()

  await env.clock.advance(8 * 60 * 1000)
  const ended = await $.turn.complete({
    answer: 'Done.',
    durationMs: 8 * 60 * 1000,
    isAborted: false,
    turnId: 'turn-1',
    reason: 'answer',
  } as never)
  expect(ended.text).toBe('⏱ 02 Oct 2026 · asked 11:44 · answered 11:52 · 8 min 00 s (GMT-3)')
  await pane.redraw()
  expect(await pane.find({ type: 'Text', text: /^Waiting for you · just now$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: 'answered 11:52' })).toBeDefined()
})

engineTest('english: with every section open and filled, no text of the panel is left in Portuguese', { options: ENGLISH }, async ($, on) => {
  const env = world(on)
  await $.tool.call({
    tool: TOOL,
    tool_use_id: 'call-1',
    steps: [
      { title: 'Read the docs', status: 'done' },
      { title: 'Check the version', status: 'done' },
      { title: 'Write the mod', status: 'done' },
      { title: 'Validate the mod', status: 'current' },
      ...Array.from({ length: 8 }, (_, i) => ({ title: 'Later step ' + (i + 1), status: 'next' })),
    ],
    terms: [{ term: 'Mod', meaning: 'A plugin that draws in Claude Code' }],
    points: ['The panel is per session'],
    decisions: ['Publish?'],
  } as never)
  for (let i = 1; i <= 7; i += 1) {
    await $.prompt.submit({ text: 'message ' + i, wait: false, origin: { kind: 'composer' } })
    await env.clock.advance(60_000)
  }
  await $.command.run({ command: 'queue', args: 'one\ntwo\nthree\nfour\nfive\nsix' } as never)
  await $.command.run({ command: 'queue', args: 'Second prompt' } as never)
  await $.command.run({ command: 'note', args: 'call the company\nreview the contract' } as never)
  await $.session.measure({
    context: { tokens: 441_200, window: 1_000_000, percent: 44 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 12.5, resetsAt: '2026-10-02T17:00:00Z' },
      { kind: 'seven_day', percentUsed: 35, resetsAt: '2026-10-03T20:00:00Z' },
    ],
    changed: ['context', 'rateLimits'],
  } as never)
  env.rules.agents = [{ id: 'agent-1', status: 'running' }]
  await $.command.run({ command: 'auto-send', args: 'on' } as never)
  await $.turn.complete({
    answer: 'Done.',
    durationMs: 1000,
    isAborted: false,
    turnId: 'turn-1',
    reason: 'answer',
    usage: { input_tokens: 2100, output_tokens: 3400, cache_read_input_tokens: 430_000, cache_creation_input_tokens: 5000 },
  } as never)

  const pane = (await mounted($, { ...PANE, surface: 'desktop' } as never)) as unknown as Field
  await pane.press({ key: 'mais-1' })
  await pane.press({ key: 'nota-editar-0' })
  await pane.press({ key: 'notas-limpar' })
  const drawn = [
    ...(((await pane.findAll?.({ type: 'Text', text: /./ })) ?? []) as Drawn[]).map(one => one.text),
    ...(((await pane.findAll?.({ type: 'Button' })) ?? []) as Drawn[]).map(one => String(one.props.label)),
    ...(((await pane.findAll?.({ type: 'Input' })) ?? []) as Drawn[]).flatMap(one => [
      String(one.props.placeholder),
      String(one.props.submitLabel),
    ]),
  ]
  // The panel drew what it should: the count is of the texts the pane holds with all of this open
  expect(drawn.length > 80).toBe(true)
  // A text in Portuguese has an accented letter or one of these words; the data of this test has none
  const portuguese = /[À-ÿ]|\b(de|do|da|em|para|uma?|linhas?|passos?|nenhum|agora|mais|antes|depois)\b/i
  expect(drawn.filter(text => portuguese.test(text))).toEqual([])

  // Figures use the decimal point, and the days of the week their English names
  expect(await pane.find({ type: 'Text', text: '441.2k / 1M · 44%' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^12\.5%$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: 'resets Sat 17:00' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: 'Waiting for a background agent to finish before sending.' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: '⋮ 2 more lines' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: '⋮ 2 more steps' })).toBeDefined()
  // The text that says when the first prompt enters is drawn only with nothing to wait for
  env.rules.agents = []
  await $.turn.start({ text: 'the agent ended', turnId: 'turn-2' } as never)
  await pane.redraw()
  expect(await pane.find({ type: 'Text', text: 'After each answer, the first prompt enters in 5 seconds.' })).toBeDefined()
  expect((await pane.find({ key: 'nova-anotacao' }))?.props.placeholder).toBe('Change line 1 and press Enter.')
})

engineTest('english: the commands answer in English, by their English names', { options: ENGLISH }, async ($, on) => {
  const env = world(on)

  const turned = await $.command.run({ command: 'auto-send', args: 'on' } as never)
  expect(turned.text).toBe(
    'Auto-send is on. Queued prompts: 0. The first one enters 5 seconds after each answer, or now, if no answer is under way.',
  )
  expect((await $.command.run({ command: 'auto-send', args: 'maybe' } as never)).text).toBe('Use /auto-send on or /auto-send off.')
  expect((await $.command.run({ command: 'auto-send', args: 'off' } as never)).text).toBe('Auto-send is off. Queued prompts: 0.')

  await $.command.run({ command: 'note', args: 'call the company' } as never)
  expect(env.toasts.at(-1)).toBe('Written to your notes: call the company')

  const told = await $.command.run({ command: 'panel-reload', args: '' } as never)
  expect(told.text).toBe(
    'Earlier messages reloaded: 0. Steps, terms and points were not reloaded: the conversation has no answer yet.',
  )
})

// The tests below cover what the review of 09/10/2026 found before the repository was published

test('a command with the English name is not the mod\'s in Portuguese: it goes on to whatever else answers it', async ($, on) => {
  const env = world(on)
  on('command.run', () => ({ text: 'answered by another command' }) as never)

  for (const command of ['panel', 'queue', 'note', 'auto-send', 'panel-reload']) {
    expect((await $.command.run({ command, args: 'x' } as never)).text).toBe('answered by another command')
  }
  expect(env.toasts).toEqual([])
  const pane = (await mounted($, { ...PANE, surface: 'desktop' } as never)) as unknown as Field
  expect(await pane.find({ key: 'enviar-1' })).toBe(undefined)
  expect((await pane.find({ key: 'envio-automatico' }))?.props.label).toBe('Envio automático: desligado')
})

test('automatic sending: an interrupted answer turns it off with no prompt queued too', async ($, on) => {
  world(on)
  await $.command.run({ command: 'envio-automatico', args: 'ligar' } as never)
  const pane = (await mounted($, { ...PANE, surface: 'desktop' } as never)) as unknown as Field

  await $.turn.complete(answered('aborted'))
  await pane.redraw()
  expect((await pane.find({ key: 'envio-automatico' }))?.props.label).toBe('Envio automático: desligado')
  expect(await pane.find({ type: 'Text', text: 'Desligado às 11:44: a resposta foi interrompida.' })).toBeDefined()
})

test('a prompt longer than 4000 characters is refused, not cut', async ($, on) => {
  const env = world(on)
  await $.command.run({ command: 'anotar', args: 'x'.repeat(4001) } as never)
  expect(env.toasts.at(-1)).toBe('O prompt tem 4001 caracteres e o limite é 4000. Ele não foi anotado.')

  const pane = (await mounted($, { ...PANE, surface: 'desktop' } as never)) as unknown as Field
  expect(await pane.find({ key: 'enviar-1' })).toBe(undefined)
  // The field keeps a long text the panel refused, so the user can shorten it
  await pane.input({ key: 'novo-prompt', text: 'y'.repeat(4001) })
  expect(await pane.find({ key: 'enviar-1' })).toBe(undefined)
  await $.command.run({ command: 'anotar', args: 'x'.repeat(4000) } as never)
  await pane.redraw()
  expect(await pane.find({ key: 'enviar-1' })).toBeDefined()
})

test('the store keeps the boards of the 40 other sessions that saved last', async ($, on) => {
  const stored: Record<string, unknown> = {}
  for (let i = 1; i <= 45; i += 1) {
    const id = 'outra-' + String(i).padStart(2, '0')
    // The higher the number, the later the session saved
    stored['board:' + id] = { asks: [], steps: [], terms: [], points: [], queue: [], savedAt: START - (50 - i) * 60_000 }
    stored['rows:' + id] = { savedAt: START, rows: {} }
  }
  const env = world(on, stored)
  await $.session.start(STARTED as never)

  // The 5 that saved first are deleted, each with its rows
  const gone = ['01', '02', '03', '04', '05']
  expect(env.deleted.filter(key => key.startsWith('board:')).sort()).toEqual(gone.map(n => 'board:outra-' + n))
  expect(env.deleted.filter(key => key.startsWith('rows:')).sort()).toEqual(gone.map(n => 'rows:outra-' + n))
})

engineTest('with the two options off, the pane does not open by itself and no line goes under an answer', { options: { ...SAO_PAULO, openOnStart: false, answerLine: false } }, async ($, on) => {
  const env = world(on)
  await $.session.start(STARTED as never)
  expect(env.titles).toEqual([])

  const ended = await $.turn.complete({ answer: 'Pronto.', durationMs: 0, isAborted: false, turnId: 'turn-1', reason: 'answer' } as never)
  expect(ended.text).toBe('Pronto.')
  // The command still opens the pane
  await $.command.run({ command: 'painel', args: '' } as never)
  expect(env.titles).toEqual(['Painel da sessão'])
})

test('the commands, the tool and the pane are named in Portuguese when the language option is left as it comes', async ($, on) => {
  const env = world(on)
  await $.session.start(STARTED as never)

  expect(env.commands).toEqual(['painel', 'anotar', 'envio-automatico', 'nota', 'painel-recarregar'])
  expect(env.described[0]).toContain('Atualiza o painel da sessão que o usuário acompanha.')
  expect(env.titles).toEqual(['Painel da sessão'])
})

engineTest('english: the commands, the tool and the pane are named in English', { options: ENGLISH }, async ($, on) => {
  const env = world(on)
  await $.session.start(STARTED as never)

  expect(env.commands).toEqual(['panel', 'queue', 'auto-send', 'note', 'panel-reload'])
  expect(env.described[0]).toContain('Updates the session panel the user follows.')
  expect(env.titles).toEqual(['Session panel'])
})

engineTest('the times of the panel follow the time zone of the option', { options: { timeZone: 'Asia/Tokyo' } }, async ($, on) => {
  world(on)
  await $.prompt.submit({ text: 'Qual é o próximo passo?', wait: false, origin: { kind: 'composer' } })
  const pane = (await mounted($, { ...PANE, surface: 'desktop' } as never)) as unknown as Field
  // 14:44 UTC is 23:44 in Tokyo
  expect(await pane.find({ type: 'Button', text: '23:44 ↗' })).toBeDefined()

  const ended = await $.turn.complete({ answer: 'Pronto.', durationMs: 0, isAborted: false, turnId: 'turn-1', reason: 'answer' } as never)
  expect(ended.text).toBe('⏱ 02/10/2026 · pergunta 23:44 · resposta 23:44 · 0 s (GMT+9)')
})

engineTest('the offset under an answer is the one of the zone at that moment, with its minutes', { options: { timeZone: 'America/New_York' } }, async ($, on) => {
  const env = world(on)
  const done = { answer: 'Pronto.', durationMs: 0, isAborted: false, turnId: 'turn-1', reason: 'answer' } as never

  // In October New York is on daylight saving time; 120 days later it is not
  expect((await $.turn.complete(done)).text).toBe('⏱ 02/10/2026 · pergunta 10:44 · resposta 10:44 · 0 s (GMT-4)')
  await env.clock.advance(120 * 24 * 60 * 60 * 1000)
  expect((await $.turn.complete(done)).text).toBe('⏱ 30/01/2027 · pergunta 09:44 · resposta 09:44 · 0 s (GMT-5)')
})

engineTest('a zone with minutes in its offset shows them', { options: { timeZone: 'Asia/Kolkata' } }, async ($, on) => {
  world(on)
  const ended = await $.turn.complete({ answer: 'Pronto.', durationMs: 0, isAborted: false, turnId: 'turn-1', reason: 'answer' } as never)
  expect(ended.text).toBe('⏱ 02/10/2026 · pergunta 20:14 · resposta 20:14 · 0 s (GMT+5:30)')
})

engineTest('a time zone the system does not know is told to the user, and the panel goes on', { options: { timeZone: 'Marte/Olimpo' } }, async ($, on) => {
  const env = world(on)
  await $.session.start(STARTED as never)
  expect(env.toasts.some(text => text.includes('timeZone "Marte/Olimpo" não é um fuso horário conhecido; o painel usa o do sistema.'))).toBe(true)

  const ended = await $.turn.complete({ answer: 'Pronto.', durationMs: 0, isAborted: false, turnId: 'turn-1', reason: 'answer' } as never)
  expect(String(ended.text)).toContain(' · pergunta ')
})
