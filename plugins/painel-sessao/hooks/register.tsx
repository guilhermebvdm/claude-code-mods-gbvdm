import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Ask, Board, Queued, SessionRow, Step, Term, Usage } from '../types'
import { commandName, dateText, decimal, setLang, t, weekdayText } from './texts'

const PANE = 'painel-sessao'
// The title of the pane, in the language in force
const title = (): string => t('Painel da sessão')
const DAY_MS = 24 * 60 * 60 * 1000

// The time zone the panel shows times in: the one of the plugin's `timeZone` option (an IANA name, as
// "America/Sao_Paulo"), or the system's when the option is empty
let zoneParts = new Intl.DateTimeFormat('en-GB', zoneFormat(undefined))

function zoneFormat(timeZone: string | undefined): Intl.DateTimeFormatOptions {
  return {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }
}

// Sets the time zone from the plugin's option. Returns false for a name the system does not know, and the
// system's zone stays in force.
function setZone(value: unknown): boolean {
  const name = typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
  try {
    zoneParts = new Intl.DateTimeFormat('en-GB', zoneFormat(name))

    return true
  } catch {
    zoneParts = new Intl.DateTimeFormat('en-GB', zoneFormat(undefined))

    return false
  }
}

type Wall = { year: number; month: number; day: number; hour: number; minute: number; second: number }

// The date and the time a moment has on a clock of the zone in force
function wall(ms: number): Wall {
  const parts: Record<string, number> = {}
  for (const part of zoneParts.formatToParts(new Date(ms))) parts[part.type] = Number(part.value)

  return {
    year: parts.year ?? 1970,
    month: parts.month ?? 1,
    day: parts.day ?? 1,
    hour: parts.hour ?? 0,
    minute: parts.minute ?? 0,
    second: parts.second ?? 0,
  }
}

// The same date and time read as if they were UTC: its difference to the moment is the zone's offset then
function wallMs(ms: number): number {
  const w = wall(ms)

  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second)
}

// The zone's offset at a moment, as the line under an answer names it: "GMT-3", "GMT+5:30", "GMT"
function zoneLabel(ms: number): string {
  const minutes = Math.round((wallMs(ms) - Math.floor(ms / 1000) * 1000) / 60000)
  if (minutes === 0) return 'GMT'
  const size = Math.abs(minutes)

  return 'GMT' + (minutes < 0 ? '-' : '+') + Math.floor(size / 60) + (size % 60 === 0 ? '' : ':' + two(size % 60))
}

// The one accent color of the panel (current step, progress, term names) and the color of a done step
const ACCENT = '#D97757'
const DONE = '#3FA66B'
// The color of a session that is answering
const BUSY = '#5B9BD5'

const EMPTY: Board = { asks: [], steps: [], terms: [], points: [], queue: [], savedAt: 0 }
const board = atom({ plugin: 'painel-sessao', key: 'board' } as const, EMPTY)

// What the user chose to see in the panel: how many of their messages, and which noted prompts whole
const view = atom({ plugin: 'painel-sessao', key: 'view' } as const, { shownAsks: 5, expanded: [] })

// The key a message of the user is found by: the start of its text, on one line
function rowKey(text: string): string {
  return oneLine(text, 80)
}

const NO_USAGE: Usage = { window: 0, limits: [], compactions: 0 }
const usage = atom({ plugin: 'painel-sessao', key: 'usage' } as const, NO_USAGE)

// What the user has typed in the two fields of the panel and not sent yet. The drawing of the desktop app does
// not read it, so a key typed writes it without drawing the panel again; it survives a reload of the mod,
// which empties the module's own memory.
const typed = atom({ plugin: 'painel-sessao', key: 'typed' } as const, { prompt: '', note: '' })

const RED = '#E5484D'

const two = (n: number): string => String(n).padStart(2, '0')

// The day of a message of the user, as the list names it: "Hoje", "Ontem · 05/10/2026", "02/10/2026 · há 4 dias".
// Days are calendar days in the zone in force, so a message of 23:50 is of yesterday ten minutes later.
function dayLabel(at: number, now: number): string {
  if (at === 0) return t('Antes de o painel ser ligado')
  const days = Math.floor(wallMs(now) / DAY_MS) - Math.floor(wallMs(at) / DAY_MS)
  if (days <= 0) return t('Hoje')
  if (days === 1) return t('Ontem · {date}', { date: day(at) })

  return t('{date} · há {n} dias', { date: day(at), n: days })
}

// "HH:MM:SS" in the zone in force
function clockSeconds(ms: number): string {
  return clock(ms) + ':' + two(wall(ms).second)
}

// A count of tokens in the short form the app uses: 441,2k, 1M
function amount(n: number): string {
  const cut = (value: number): string => decimal(Math.round(value * 10) / 10)
  if (n >= 1_000_000) return cut(n / 1_000_000) + 'M'
  if (n >= 1000) return cut(n / 1000) + 'k'

  return String(n)
}

// When a limit's window resets: the time if it is today, the weekday and the time otherwise
function resetLabel(iso: string | undefined, now: number): string {
  if (iso === undefined) return ''
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return ''
  if (day(ms) === day(now)) return clock(ms)

  return weekdayText(new Date(wallMs(ms)).getUTCDay()) + ' ' + clock(ms)
}

function limitName(kind: string): string {
  if (kind === 'five_hour') return t('5 horas')
  if (kind === 'seven_day') return t('Semana')

  if (kind === 'spend_limit') return t('Limite de gasto')

  return kind.replace(/_/g, ' ')
}

// Green while there is room, the accent from half, red near the end
function tone(percent: number): string {
  if (percent >= 80) return RED

  return percent >= 50 ? ACCENT : DONE
}

type Measured = {
  context: { tokens?: number; window: number; percent?: number }
  rateLimits: readonly { kind: string; percentUsed: number; resetsAt?: string }[]
}

// The usage with the figures of one measurement; a figure the measurement lacks keeps its last value
function measured(now: Usage, e: Measured): Usage {
  return {
    ...now,
    tokens: e.context.tokens ?? now.tokens,
    window: e.context.window,
    percent: e.context.percent ?? now.percent,
    limits:
      e.rateLimits.length === 0
        ? now.limits
        : e.rateLimits.map(one => ({ kind: one.kind, percent: one.percentUsed, resetsAt: one.resetsAt })),
  }
}

// "HH:MM" in the zone in force
function clock(ms: number): string {
  const w = wall(ms)

  return two(w.hour) + ':' + two(w.minute)
}

// The date in the zone in force, as the language in force writes it
function day(ms: number): string {
  const w = wall(ms)

  return dateText(w.year, w.month, w.day)
}

function span(ms: number): string {
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return seconds + ' s'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return minutes + ' min ' + two(seconds % 60) + ' s'
  return Math.floor(minutes / 60) + ' h ' + two(minutes % 60) + ' min'
}

function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? flat.slice(0, max - 1) + '…' : flat
}

function isBoard(value: unknown): value is Board {
  if (typeof value !== 'object' || value === null) return false
  const b = value as Record<string, unknown>
  return (
    Array.isArray(b.asks) &&
    Array.isArray(b.steps) &&
    Array.isArray(b.terms) &&
    Array.isArray(b.points) &&
    Array.isArray(b.queue)
  )
}

function isEmpty(b: Board): boolean {
  return (
    b.asks.length + b.steps.length + b.terms.length + b.points.length + b.queue.length + (b.notes ?? []).length === 0
  )
}

// The steps the model sent, with exactly one of them current while any is left to do
function asSteps(value: unknown): Step[] | null {
  if (!Array.isArray(value)) return null
  const steps: Step[] = []
  let hasCurrent = false
  for (const item of value.slice(0, 40)) {
    if (typeof item !== 'object' || item === null) continue
    const { title, status } = item as { title?: unknown; status?: unknown }
    if (typeof title !== 'string' || title.trim() === '') continue
    if (status === 'current' && !hasCurrent) {
      hasCurrent = true
      steps.push({ title: oneLine(title, 160), status: 'current' })
    } else {
      steps.push({ title: oneLine(title, 160), status: status === 'done' ? 'done' : 'next' })
    }
  }
  // A list in which no item is a valid step is a malformed call, not a request to empty the panel
  if (value.length > 0 && steps.length === 0) return null
  if (hasCurrent) return steps
  const first = steps.findIndex(step => step.status === 'next')

  return steps.map((step, i) => (i === first ? { ...step, status: 'current' as const } : step))
}

function asTerms(value: unknown): Term[] {
  if (!Array.isArray(value)) return []
  const terms: Term[] = []
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue
    const { term, meaning } = item as { term?: unknown; meaning?: unknown }
    if (typeof term !== 'string' || term.trim() === '') continue
    terms.push({ term: oneLine(term, 40), meaning: typeof meaning === 'string' ? oneLine(meaning, 200) : '' })
  }
  return terms
}

function asStrings(value: unknown, max: number): string[] | null {
  if (!Array.isArray(value)) return null
  return value.filter((one): one is string => typeof one === 'string' && one.trim() !== '').map(one => oneLine(one, max))
}

// The current step becomes done and the first step still to do becomes current
function advance(steps: Step[]): Step[] {
  let isMoved = false
  return steps
    .map(step => (step.status === 'current' ? { ...step, status: 'done' as const } : step))
    .map(step => {
      if (isMoved || step.status !== 'next') return step
      isMoved = true
      return { ...step, status: 'current' as const }
    })
}

// How many rows of a noted prompt the panel shows before "Ver tudo"
const ROWS_SHOWN = 4

// The start of a text that fits in `rows` rows of `rowChars` characters: whole lines while they fit, then the
// line that does not, cut with an ellipsis. `hidden` counts the lines left out after it.
function firstRows(
  lines: string[],
  rowChars: number,
  rows: number,
): { lines: string[]; hidden: number; isCut: boolean } {
  const shown: string[] = []
  let left = rows
  for (const [i, line] of lines.entries()) {
    const needs = Math.max(1, Math.ceil(line.length / rowChars))
    if (needs <= left) {
      shown.push(line)
      left -= needs
      continue
    }
    if (left === 0) return { lines: shown, hidden: lines.length - i, isCut: false }
    shown.push(line.slice(0, left * rowChars - 1).trimEnd() + '…')

    return { lines: shown, hidden: lines.length - i - 1, isCut: true }
  }

  return { lines: shown, hidden: 0, isCut: false }
}

// How many of the user's messages the panel keeps
const ASKS_KEPT = 100
// How many prompts the panel keeps noted, and how long one may be
const QUEUE_LIMIT = 30
const NOTE_LIMIT = 4000

function withQueued(b: Board, text: string): Board {
  const id = b.queue.reduce((max, item) => Math.max(max, item.id), 0) + 1
  return { ...b, queue: [...b.queue, { id, text: text.trim().slice(0, NOTE_LIMIT) }] }
}

// How many lines the user's notes keep, and how long one line may be: 200 KB for a session at most, in a
// store of 4 MiB that every session shares
const NOTES_LIMIT = 200
const NOTE_LINE_LIMIT = 1000

// Adds a text to the user's notes, one entry for each of its lines. Returns false when the notes are full.
async function withNote($: EngineInterface, text: string): Promise<boolean> {
  const lines = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line.trimEnd().slice(0, NOTE_LINE_LIMIT))
  if (lines.every(line => line === '')) return true
  // The limit is checked where the lines are added, so two writes at once cannot pass it together
  let isAdded = false
  await commit($, now => {
    const notes = now.notes ?? []
    isAdded = notes.length + lines.length <= NOTES_LIMIT

    return isAdded ? { ...now, notes: [...notes, ...lines] } : now
  })
  if (!isAdded) {
    $.ui.toast(t('Anotações já tem {n} linhas, que é o limite. Exclua alguma antes de escrever outra.', { n: NOTES_LIMIT }))
  }

  return isAdded
}

// Notes a prompt, unless the panel already keeps as many as it may: the oldest is never dropped in silence
async function noted($: EngineInterface, text: string): Promise<boolean> {
  if (text.trim() === '') return false
  // A prompt longer than the panel keeps is refused, never cut: what is queued is what is sent as the user
  if (text.trim().length > NOTE_LIMIT) {
    $.ui.toast(
      t('O prompt tem {n} caracteres e o limite é {max}. Ele não foi anotado.', { n: text.trim().length, max: NOTE_LIMIT }),
    )

    return false
  }
  if ((await read($, board)).queue.length >= QUEUE_LIMIT) {
    $.ui.toast(t('Próximos prompts já tem {n} prompts anotados, que é o limite. Envie ou exclua um.', { n: QUEUE_LIMIT }))

    return false
  }
  await commit($, now => (now.queue.length >= QUEUE_LIMIT ? now : withQueued(now, text)))

  return true
}

// What the model reads beside a prompt: what the panel shows now. How to update it is in the tool's description.
function contextFor(b: Board): string {
  const steps =
    b.steps.length === 0
      ? t('nenhum passo registrado')
      : b.steps.map((step, i) => i + 1 + '. [' + step.status + '] ' + step.title).join('; ')
  const terms = b.terms.length === 0 ? t('nenhum') : b.terms.map(one => one.term).join(', ')
  const points = b.points.length === 0 ? t('nenhum') : b.points.join('; ')
  const decisions = (b.decisions ?? []).length === 0 ? t('nenhuma') : (b.decisions ?? []).join('; ')

  return [
    t('Painel da sessão (mod painel-sessao), que o usuário acompanha. Atualize com a ferramenta mcp__painel-sessao__atualizar quando passos, decisões, termos ou pontos mudarem.'),
    t('Passos no painel agora: ') + steps + '.',
    t('Decisões que o usuário precisa tomar, no painel agora: ') + decisions + '.',
    t('Termos no painel agora: ') + terms + '.',
    t('Pontos no painel agora: ') + points + '.',
  ].join('\n')
}

// The sections that are open when the user has not opened or closed any: the two that ask something of the
// user. The others show their summary in one line.
const OPEN_AT_FIRST = ['decisoes', 'prompts']

// How long ago, as the panel says it: "agora", "há 12 min", "há 2 h 05 min", "há 3 dias"
function ago(ms: number): string {
  const minutes = Math.floor(ms / 60000)
  if (minutes < 1) return t('agora')
  if (minutes < 60) return t('há {n} min', { n: minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t('há {h} h {m} min', { h: hours, m: two(minutes % 60) })
  const days = Math.floor(hours / 24)

  return t(days === 1 ? 'há {n} dia' : t('há {n} dias'), { n: days })
}

// A session that saved nothing for this long is not answering nor waiting: it is stopped
const STOPPED_AFTER_MS = 12 * 60 * 60 * 1000

// One line of the list of sessions, from what a session's panel saved
function rowOf(id: string, b: Board, now: number, isThis: boolean): SessionRow {
  const at = b.steps.findIndex(step => step.status === 'current')
  const isStale = now - (b.savedAt ?? 0) > STOPPED_AFTER_MS
  const state: SessionRow['state'] =
    b.ended === true
      ? 'encerrada'
      : isStale
        ? 'parada'
        : b.working === true
          ? 'respondendo'
          : b.turnEndedAt !== undefined
            ? 'aguardando'
            : 'nova'

  return {
    id,
    isThis,
    name: b.name ?? t('Sessão ') + id.slice(0, 8),
    state,
    at:
      state === 'respondendo'
        ? (b.turnStartedAt ?? b.savedAt)
        : state === 'aguardando'
          ? (b.turnEndedAt ?? b.savedAt)
          : b.savedAt,
    stepsDone: b.steps.filter(step => step.status === 'done').length,
    stepsTotal: b.steps.length,
    step: at < 0 ? '' : (b.steps[at]?.title ?? ''),
    decisions: (b.decisions ?? []).length,
    queued: b.queue.length,
  }
}

// The sessions of this machine that run the mod, from the store they all write to: this one first, then
// the ones that wait for the user, then the rest, the most recent first
async function sessionRows($: EngineInterface): Promise<SessionRow[]> {
  const mine = await $.session.id()
  const now = await $.clock.now()
  const rows: SessionRow[] = []
  for (const key of await $.store.keys()) {
    if (!key.startsWith('board:')) continue
    const id = key.slice('board:'.length)
    const saved = id === mine ? { ...(await read($, board)), savedAt: now } : await $.store.get(key)
    if (isBoard(saved)) rows.push(rowOf(id, saved, now, id === mine))
  }
  // A session that has not saved its board yet is still listed
  if (!rows.some(row => row.isThis)) rows.push(rowOf(mine, { ...(await read($, board)), savedAt: now }, now, true))
  const rank = (row: SessionRow): number => (row.isThis ? 0 : row.state === 'aguardando' ? 1 : 2)

  return rows.sort((a, b) => rank(a) - rank(b) || b.at - a.at).slice(0, 20)
}

// What the model last read about the panel: the same state is not sent again with every prompt. Emptied
// when the conversation is cleared, resumed or compacted, so the state goes again.
let lastContext = ''

// The writes of the board to the store, one after the other: each reads the state when its turn comes,
// so the last write always holds the latest board, whatever order the changes finished in
let saving: Promise<void> = Promise.resolve()
// True after the user was told that the store refused a write, so the notice is given once
let hasToldUnsaved = false

// Writes the board to the session's state, which redraws the panel, and to the store, which survives a restart
async function commit($: EngineInterface, change: (b: Board) => Board): Promise<void> {
  await update($, board, change)
  saving = saving.then(async () => {
    try {
      const value = await read($, board)
      await $.store.set('board:' + (await $.session.id()), { ...value, savedAt: await $.clock.now() })
      hasToldUnsaved = false
    } catch {
      // A full store keeps the board in the session's state only: the panel goes on working until a restart
      if (hasToldUnsaved) return
      hasToldUnsaved = true
      $.ui.toast(
        t('O painel não foi gravado: o arquivo do mod está cheio. O que aparece continua na tela até o aplicativo reiniciar.'),
        { timeoutMs: 10000 },
      )
    }
  })
  await saving
}

// Loads the board this session saved before a restart or a resume
async function restore($: EngineInterface): Promise<void> {
  const current = await read($, board)
  if (!isEmpty(current)) return
  const id = await $.session.id()
  const saved = await $.store.get('board:' + id)
  if (!isBoard(saved)) return
  // A prompt that was waiting to enter when the app closed never entered: it can be sent again. The automatic
  // sending starts off, and no sending is waiting.
  const queue = saved.queue.map(one => ({ id: one.id, text: one.text }))
  // Nor does a message that was waiting for its row get one after a restart
  const asks = saved.asks.map(ask => (ask.row === undefined ? { at: ask.at, text: ask.text } : ask))
  // No turn is under way in a session that has just started
  await update($, board, () => ({
    ...saved,
    asks,
    queue,
    auto: false,
    pending: undefined,
    hold: undefined,
    stopped: undefined,
    working: false,
    ended: false,
  }))
}

// How many boards of other sessions the store keeps: the store is one file of 4 MiB for every session of the
// machine, and each /clear and each resumed session writes a board of its own
const BOARDS_KEPT = 40

// Deletes from the store, which every session shares: the boards of sessions that saved nothing for 30 days,
// the boards beyond the 40 that saved last, the rows kept for a session that has no board, and any key this
// version of the mod does not write
async function prune($: EngineInterface): Promise<void> {
  const id = await $.session.id()
  const now = await $.clock.now()
  const keys = await $.store.keys()
  // The boards of the other sessions, the one that saved last first: the ones after the 40th are deleted
  const others: { key: string; savedAt: number }[] = []
  for (const key of keys) {
    if (!key.startsWith('board:') || key === 'board:' + id) continue
    const saved = await $.store.get(key)
    if (isBoard(saved)) others.push({ key, savedAt: saved.savedAt ?? 0 })
  }
  const beyond = new Set(
    others
      .sort((a, b) => b.savedAt - a.savedAt)
      .slice(BOARDS_KEPT)
      .map(one => one.key),
  )
  for (const key of keys) {
    if (key === 'board:' + id || key === 'rows:' + id || key === 'trace:' + id) continue
    if (key.startsWith('rows:') || key.startsWith('trace:')) {
      // The rows of a session with no board are those of a session that is open and has not written one
      // yet, or of one that never will: only their own age tells, so they go after 30 days without a write.
      // The record of clicks of a session follows the same rule.
      if (keys.includes('board:' + key.slice(key.indexOf(':') + 1))) continue
      const kept = (await $.store.get(key)) as { savedAt?: unknown } | null
      const savedAt = typeof kept?.savedAt === 'number' ? kept.savedAt : 0
      if (now - savedAt > 30 * DAY_MS) await $.store.delete(key)
      continue
    }
    const saved = key.startsWith('board:') ? await $.store.get(key) : null
    if (!isBoard(saved) || now - (saved.savedAt ?? 0) > 30 * DAY_MS || beyond.has(key)) {
      await $.store.delete(key)
      if (key.startsWith('board:')) {
        await $.store.delete('rows:' + key.slice('board:'.length))
        await $.store.delete('trace:' + key.slice('board:'.length))
      }
    }
  }
}

// How long the automatic sending waits after an answer, so the user can cancel it
const AUTO_WAIT_MS = 5000
// How often the automatic sending looks again at a session that is not answering: a sending that failed, or
// one that waited for something, is tried again without a new answer
const AUTO_LOOK_MS = 15000
// How long the app's survey about the session holds the automatic sending. After that the prompt goes anyway:
// the band may not be drawn again to say the survey is gone.
const SURVEY_HOLD_MS = 3 * 60 * 1000
// A prompt sent that started no turn, with no answer running for this long, did not enter: it can go again
const STUCK_AFTER_MS = 2 * 60 * 1000
// How many automatic sendings in a row may fail before the automatic sending turns itself off
const AUTO_TRIES = 3

// The noted prompts being sent right now, so a second click on "Enviar" does not send one twice
const inFlight = new Set<number>()
// When each noted prompt was sent, by id
const sentAt = new Map<number, number>()
// When the app's survey about the session was first drawn; 0 while there is none
let surveyAt = 0
// How many automatic sendings in a row did not enter the conversation
let autoFailures = 0

// The board with one more line of what the automatic sending did: the panel shows the last one
function logged(b: Board, at: number, what: string): Board {
  return { ...b, autoLog: [...(b.autoLog ?? []), { at, what }].slice(-12) }
}

// What the automatic sending waits for now, if anything; written to the board so the panel says it
async function held($: EngineInterface): Promise<boolean> {
  const at = await $.clock.now()
  const hold =
    surveyAt !== 0 && at - surveyAt < SURVEY_HOLD_MS
      ? ('pesquisa' as const)
      : (await $.agent.list()).some(agent => agent.status === 'running')
        ? ('agente' as const)
        : undefined
  if ((await read($, board)).hold !== hold) {
    await commit($, now =>
      hold === undefined
        ? { ...now, hold }
        : logged(
            { ...now, hold },
            at,
            hold === 'agente' ? t('aguardando um agente terminar') : t('aguardando a pesquisa do aplicativo sair da tela'),
          ),
    )
  }

  return hold !== undefined
}

// Starts the 5 seconds of the automatic sending when it is on, a prompt is noted and no answer runs. Called
// at the end of each answer, when the user turns it on, and every 15 seconds.
async function arm($: EngineInterface): Promise<void> {
  const b = await read($, board)
  if (b.auto !== true || b.working === true || b.pending !== undefined) return
  // A prompt already sent has to enter the conversation first
  const item = b.queue.some(one => one.sending === true) ? undefined : b.queue[0]
  if (item === undefined || (await held($))) return
  const at = (await $.clock.now()) + AUTO_WAIT_MS
  await commit($, now => ({ ...now, pending: { id: item.id, at } }))
  $.ui.toast(t('Envio automático: o próximo prompt entra em 5 segundos. Para parar, clique em Cancelar.'))
  $.clock.after(AUTO_WAIT_MS, () => void fire($, item.id, at))
}

// The end of the 5 seconds: sends the prompt, unless the wait was called off or something came up to wait for
async function fire($: EngineInterface, id: number, at: number): Promise<void> {
  const b = await read($, board)
  // Called off, or replaced by a later wait: this timer does nothing
  if (b.auto !== true || b.pending?.id !== id || b.pending.at !== at) return
  const item = b.queue.find(one => one.id === id && one.sending !== true)
  await commit($, now => ({ ...now, pending: undefined }))
  if (item === undefined || (await held($))) return
  const isSent = await dispatch($, item)
  const now = await $.clock.now()
  if (isSent) {
    autoFailures = 0
    await commit($, state => logged(state, now, t('prompt enviado: ') + oneLine(item.text, 60)))

    return
  }
  autoFailures += 1
  if (autoFailures < AUTO_TRIES) {
    await commit($, state => logged(state, now, t('o prompt não entrou na conversa; nova tentativa em seguida')))

    return
  }
  // The same prompt failed every time: the user is told why nothing else is sent, in the panel and in a notice
  autoFailures = 0
  const why = t('o prompt não entrou na conversa em {n} tentativas', { n: AUTO_TRIES })
  await commit($, state => logged({ ...state, auto: false, hold: undefined, stopped: { at: now, why } }, now, t('desligado: ') + why))
  $.ui.toast(t('Envio automático desligado: {why}.', { why }), { timeoutMs: 10000 })
}

// A prompt sent that started no turn, with no answer running for two minutes, did not enter the conversation:
// it is noted again, so "Enviar" and the automatic sending can send it
async function unstick($: EngineInterface): Promise<void> {
  const b = await read($, board)
  if (b.working === true || surveyAt !== 0) return
  const now = await $.clock.now()
  const stuck = b.queue.filter(
    one => one.sending === true && now - Math.max(sentAt.get(one.id) ?? 0, b.turnEndedAt ?? 0) > STUCK_AFTER_MS,
  )
  if (stuck.length === 0) return
  const ids = new Set(stuck.map(one => one.id))
  const texts = new Set(stuck.map(one => oneLine(one.text, 300)))
  for (const id of ids) {
    inFlight.delete(id)
    sentAt.delete(id)
  }
  await commit($, state =>
    logged(
      {
        ...state,
        queue: state.queue.map(one => (ids.has(one.id) ? { id: one.id, text: one.text } : one)),
        asks: state.asks.filter(ask => !(ask.isEntering === true && texts.has(ask.text))),
      },
      now,
      t('um prompt enviado não entrou na conversa e voltou a ficar anotado'),
    ),
  )
}

// Sends a noted prompt as the user's own words, and tells whether it entered. A prompt sent while Claude
// answers waits for that answer to end: the item says so until its turn starts.
async function dispatch($: EngineInterface, item: Queued): Promise<boolean> {
  if (inFlight.has(item.id)) return false
  inFlight.add(item.id)
  const marked = (isSending: boolean) => (now: Board): Board => ({
    ...now,
    queue: now.queue.map(one => (one.id === item.id ? { ...one, sending: isSending } : one)),
  })
  const at = await $.clock.now()
  sentAt.set(item.id, at)
  try {
    // The message is listed here: a mod's prompt.submit hook does not run for the mod's own prompt
    await commit($, now => ({
      ...marked(true)(now),
      asks: [...now.asks, { at, text: oneLine(item.text, 300), isEntering: true }].slice(-ASKS_KEPT),
    }))
    // For the same reason the panel's state, when it changed, goes as a row only the model reads
    const context = contextFor(await read($, board))
    if (context !== lastContext) {
      try {
        await $.session.append({ message: { type: 'user', content: [{ type: 'text', text: context }] } })
        lastContext = context
      } catch {
        // The session takes no row from a mod: the prompt goes without the panel's state
      }
    }
    const entered = await $.prompt.submit({ text: item.text, asUser: true })
    if (entered.drop !== undefined) throw new Error(entered.drop)
    await commit($, now => ({ ...now, queue: now.queue.filter(one => one.id !== item.id) }))

    return true
  } catch (error) {
    // The prompt did not enter: it stays noted, and it leaves the list of messages sent
    await commit($, now => ({
      ...marked(false)(now),
      asks: now.asks.filter(ask => !(ask.at === at && ask.isEntering === true)),
    }))
    $.ui.toast(
      t('O prompt não foi enviado e continua em Próximos prompts') +
        (error instanceof Error && error.message !== '' ? ': ' + error.message : '.'),
    )

    return false
  } finally {
    inFlight.delete(item.id)
    sentAt.delete(item.id)
  }
}

// Rows the conversation files under the user's role that the user did not type: commands, notices, hook output
const NOT_TYPED = /^(<|\[SYSTEM NOTIFICATION|Stop hook feedback|Tool loaded\.|Another Claude session)/

// What the model is asked, over the whole conversation, to fill the panel of a session that had no panel
const reloadPrompt = (): string => [
  t('Resuma esta sessão para o painel que o usuário acompanha.'),
  t('Responda só com um objeto JSON, sem texto antes ou depois e sem bloco de código, com três chaves:'),
  t('"steps": a lista ordenada dos passos da sessão, cada um {"title": frase curta, "status": "done" | "current" | "next"}, com um único "current", até 20;'),
  t('"terms": as siglas, os termos e os conceitos que o usuário precisa lembrar, cada um {"term": texto, "meaning": uma frase}, até 10;'),
  t('"points": as decisões e os fatos importantes da sessão, em frases curtas, até 8.'),
  t('Escreva em português do Brasil.'),
].join('\n')

// The object in a reply that may carry text around it
function objectIn(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const value: unknown = JSON.parse(text.slice(start, end + 1))

    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
  } catch {
    return null
  }
}

// Fills the panel from the conversation, for a session that ran without the panel: the messages the user
// sent, with no time, because the conversation as the mod reads it carries none; the context and the limits;
// and the steps, terms and points, which the model writes from the whole conversation. Returns what it did.
async function reload($: EngineInterface): Promise<string> {
  if ((await read($, view)).isReloading === true) return t('O painel já está sendo recarregado.')
  await update($, view, now => ({ ...now, isReloading: true }))
  try {
    const rows = (await $.session.messages()) as readonly { role: string; text: string }[]
    const past = rows
      .filter(row => row.role === 'user')
      .map(row => oneLine(row.text, 300))
      .filter(text => text !== '' && !NOT_TYPED.test(text))
    let added = 0
    await commit($, now => {
      const known = new Set(now.asks.map(ask => rowKey(ask.text)))
      const older: Ask[] = []
      for (const text of past) {
        if (known.has(rowKey(text))) continue
        known.add(rowKey(text))
        older.push({ at: 0, text })
      }
      added = older.length

      return { ...now, asks: [...older, ...now.asks].slice(-ASKS_KEPT) }
    })
    const figures = await $.session.usage()
    await update($, usage, now => measured(now, figures))

    const head = t('Mensagens anteriores recarregadas: {n}. ', { n: added })
    const answer = await $.model.fork({ prompt: reloadPrompt() })
    if (!answer.isAnswered) {
      const why =
        answer.reason === 'nothing-to-fork'
          ? t('a conversa ainda não tem nenhuma resposta')
          : answer.reason === 'api-error'
            ? t('a API retornou erro') + (answer.status === null ? '' : ' ' + answer.status)
            : answer.reason === 'empty-reply'
              ? t('o modelo respondeu sem texto')
              : t('a leitura foi interrompida')

      return head + t('Passos, termos e pontos não foram recarregados: {why}.', { why })
    }
    const data = objectIn(answer.text)
    const steps = data === null ? null : asSteps(data.steps)
    if (data === null || steps === null) {
      return (
        head +
        t('Passos, termos e pontos não foram recarregados: {why}.', { why: t('a resposta do modelo veio fora do formato') })
      )
    }
    const terms = asTerms(data.terms)
    const points = asStrings(data.points, 200) ?? []
    await commit($, now => {
      const fresh = new Set(terms.map(one => one.term.toLowerCase()))

      return {
        ...now,
        steps,
        terms: [...now.terms.filter(one => !fresh.has(one.term.toLowerCase())), ...terms].slice(-12),
        points: points.slice(-8),
      }
    })

    return (
      head +
      t('Passos: {steps}. Termos: {terms}. Pontos: {points}.', {
        steps: steps.length,
        terms: terms.length,
        points: Math.min(8, points.length),
      })
    )
  } catch (error) {
    // Whoever asked, the button or the command, gets a text to show: a failure here is never silent
    return t('O painel não foi recarregado: {why}.', {
      why: error instanceof Error && error.message !== '' ? error.message : t('erro sem descrição'),
    })
  } finally {
    await update($, view, now => ({ ...now, isReloading: false }))
  }
}

// The rows saved for the session id in force, which changes on /clear and on a resume, and the key they
// are saved under. A text sent more than once has one row for each time.
async function savedRows($: EngineInterface): Promise<{ key: string; rows: Map<string, string[]> }> {
  const key = 'rows:' + (await $.session.id())
  const kept = (await $.store.get(key)) as { rows?: unknown } | null
  const rows = new Map<string, string[]>()
  if (typeof kept !== 'object' || kept === null) return { key, rows }
  // Since 06/10/2026 the rows are saved under `rows`, beside the time of the write; before, they were the
  // whole value
  const saved = typeof kept.rows === 'object' && kept.rows !== null ? kept.rows : kept
  for (const [text, value] of Object.entries(saved)) {
    const ids = (Array.isArray(value) ? value : [value]).filter((one): one is string => typeof one === 'string')
    if (ids.length > 0) rows.set(text, ids)
  }

  return { key, rows }
}

export const register: Register = (on, options) => {
  // The plugin's options: the language of the panel, the time zone its times are shown in, whether the pane
  // opens by itself when a session starts, and whether a line with the times goes under each answer
  setLang(options.language)
  const isZoneKnown = setZone(options.timeZone)
  const opensOnStart = options.openOnStart !== false
  const hasAnswerLine = options.answerLine !== false

  // What the user has typed in the panel's field and not noted yet, kept so a redraw does not empty the field
  let typing = ''
  // The rows of the conversation that hold each message of the user, by the start of the message's text and
  // in the order they entered. Saved to the store every 2 seconds, because a reload empties this memory.
  let rowIds = new Map<string, string[]>()
  let areRowsDirty = false
  let rowsKey = ''
  const sawRow = (text: string, row: string): void => {
    const key = rowKey(text)
    const ids = rowIds.get(key) ?? []
    if (ids.includes(row)) return
    rowIds.set(key, [...ids, row])
    areRowsDirty = true
  }
  // The noted prompts of a conversation the user cleared, kept for the conversation that follows
  let carried: Queued[] = []
  let carriedNotes: string[] = []
  // What the user has typed in the field of the notes and not written yet
  let noteTyping = ''
  // What a field of the panel must hold at its next drawings, by the field's key: set when the mod itself
  // changes the field (emptied after Enter, filled with a line to change) and dropped when the user types in
  // it. The desktop app draws the panel anew at every change and keeps what was typed only when the value
  // drawn for the field is the one it drew before, or none (read in the app's own code on 07/10/2026): a
  // value that followed the typing emptied the field or moved the cursor at a redraw.
  const fieldSet = new Map<string, string>()
  // The surface that last drew the pane: an event about the pane's focus does not say which one it came from
  let paneSurface = ''
  // The last presses and moves of focus in the pane, saved to the store so a click that did nothing can be
  // looked into afterwards
  let trace: { at: number; kind: string; element: string }[] = []
  let isTraceDirty = false
  const traced = (at: number, kind: string, element: string): void => {
    trace = [...trace, { at, kind, element }].slice(-60)
    isTraceDirty = true
  }

  on('session.start', async ($, e, next) => {
    if (!isZoneKnown) {
      $.ui.toast('painel-sessao: timeZone "' + String(options.timeZone) + '" ' + t('não é um fuso horário conhecido; o painel usa o do sistema.'), {
        timeoutMs: 10000,
      })
    }
    await $.command.register({ name: commandName('panel'), description: t('Abre o painel da sessão') })
    await $.command.register({
      name: commandName('queue'),
      description: t('Anota um prompt em Próximos prompts, no painel da sessão, para enviar depois'),
      argumentHint: t('[texto do prompt]'),
      immediate: true,
    })
    await $.tool.register({
      name: 'atualizar',
      description:
        t('Atualiza o painel da sessão que o usuário acompanha. Chame sempre que apresentar próximos passos, alterar o plano, concluir um passo, ou quando surgir sigla, termo, conceito ou decisão que o usuário precisa lembrar. Cada campo é opcional; envie só o que mudou.'),
      inputSchema: {
        type: 'object',
        properties: {
          steps: {
            type: 'array',
            description:
              t('Lista completa e ordenada dos passos da sessão. Substitui a lista do painel. Um único passo com status "current".'),
            items: {
              type: 'object',
              properties: {
                title: { type: 'string', description: t('O passo em uma frase curta') },
                status: { type: 'string', enum: ['done', 'current', 'next'] },
              },
              required: ['title', 'status'],
            },
          },
          terms: {
            type: 'array',
            description: t('Siglas, termos e conceitos a adicionar. Um `term` que já existe tem o significado substituído.'),
            items: {
              type: 'object',
              properties: {
                term: { type: 'string' },
                meaning: { type: 'string', description: t('O significado em uma frase') },
              },
              required: ['term', 'meaning'],
            },
          },
          remove_terms: { type: 'array', items: { type: 'string' }, description: t('Termos a remover do painel') },
          points: {
            type: 'array',
            items: { type: 'string' },
            description: t('Lista completa de decisões e fatos importantes da sessão. Substitui a lista do painel. Até 8.'),
          },
          decisions: {
            type: 'array',
            items: { type: 'string' },
            description:
              t('Lista completa das decisões que você deixou para o usuário tomar e que ele ainda não respondeu, cada uma como uma pergunta curta. Substitui a lista do painel. Envie a lista sem a decisão quando o usuário a responder, e lista vazia quando não restar nenhuma. Até 6.'),
          },
          envio_automatico: {
            type: 'boolean',
            description:
              t('Liga (true) ou desliga (false) o envio automático dos prompts que o usuário anotou. Envie só quando o usuário pedir para ligar ou desligar.'),
          },
        },
      },
    })
    await $.command.register({
      name: commandName('auto'),
      description: t('Liga ou desliga o envio automático dos prompts anotados no painel da sessão'),
      argumentHint: t('[ligar | desligar]'),
      immediate: true,
    })
    await $.command.register({
      name: commandName('note'),
      description: t('Escreve nas Anotações do painel da sessão; aceita várias linhas e texto colado'),
      argumentHint: t('[texto]'),
      immediate: true,
    })
    await $.command.register({
      name: commandName('reload'),
      description:
        t('Preenche o painel da sessão a partir da conversa: mensagens enviadas, contexto, passos, termos e pontos'),
    })
    await restore($)
    // The list of sessions names this one by the folder it runs in, until the app gives its title
    const folder = (await $.session.cwd()).replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? ''
    await commit($, now => ({ ...now, name: now.name ?? (folder === '' ? undefined : folder), ended: false }))
    // A reload drops the timer of a sending that was waiting: the wait is called off, the choice stays
    if ((await read($, board)).pending !== undefined) await commit($, now => ({ ...now, pending: undefined }))
    // And it drops a filling of the panel that was under way
    if ((await read($, view)).isReloading === true) await update($, view, now => ({ ...now, isReloading: false }))
    await prune($)
    const bound = await savedRows($)
    rowsKey = bound.key
    rowIds = bound.rows
    const figures = await $.session.usage()
    await update($, usage, now => measured(now, figures))
    // The pane opens by itself once in a session with a person at it: a reload does not open again a pane
    // the user closed
    if (opensOnStart && e.isInteractive && !(await read($, view)).hasOpened) {
      await update($, view, now => ({ ...now, hasOpened: true }))
      void $.ui.open({ id: PANE, title: title() })
    }
    $.clock.every(2000, () => {
      if (isTraceDirty) {
        isTraceDirty = false
        void $.store.set(rowsKey.replace('rows:', 'trace:'), { savedAt: Date.now(), events: trace }).catch(() => {})
      }
      if (!areRowsDirty) return
      areRowsDirty = false
      void $.store
        .set(rowsKey, { savedAt: Date.now(), rows: Object.fromEntries([...rowIds].slice(-300)) })
        .catch(() => {})
    })
    // The automatic sending looks at the session again: a sending that failed or waited is tried without a
    // new answer, and a prompt sent that never entered is noted again
    $.clock.every(AUTO_LOOK_MS, () => {
      void unstick($)
        .then(() => arm($))
        .catch(() => {})
    })
    // Once a minute: the list of sessions is read again, and the write redraws the panel, so "há 12 min"
    // and the count of sessions waiting stay current
    const refresh = async (): Promise<void> => {
      try {
        const sessions = await sessionRows($)
        await update($, view, now => ({ ...now, sessions, minuteTick: (now.minuteTick ?? 0) + 1 }))
      } catch {
        // The store could not be read: the list keeps what it had
      }
    }
    void refresh()
    $.clock.every(60000, () => void refresh())
    // After a reload the surface still shows the drawing of the module that was replaced, whose buttons
    // no longer answer: drawing again gives every button a handler of this module
    $.ui.invalidate('ui.render')

    return next(e)
  })

  // /clear ends the conversation and no session.start follows: the noted prompts and the user's notes are
  // kept for the next one
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      const ending = await read($, board)
      carried = ending.queue.map(one => ({ id: one.id, text: one.text }))
      carriedNotes = ending.notes ?? []
    }
    // The list of sessions of the other sessions shows this one as ended
    await commit($, now => ({ ...now, ended: true, working: false }))

    return next(e)
  })

  // The title the app gives the session is the name the user knows it by
  on('classic.UserPromptSubmit', async ($, e, next) => {
    const title = typeof e.session_title === 'string' ? oneLine(e.session_title, 60) : ''
    if (title !== '' && (await read($, board)).name !== title) await commit($, now => ({ ...now, name: title }))

    return next(e)
  })

  // After /clear, a resume or a branch the session id is another and the state is empty: the rows and the
  // board are those of the new id, and after a /clear the noted prompts come along
  on('classic.SessionStart', { source: ['clear', 'resume', 'fork'] }, async ($, e, next) => {
    const bound = await savedRows($)
    rowsKey = bound.key
    rowIds = bound.rows
    areRowsDirty = false
    lastContext = ''
    await restore($)
    if (e.source === 'clear' && carried.length + carriedNotes.length > 0) {
      const queue = carried
      const notes = carriedNotes
      carried = []
      carriedNotes = []
      await commit($, now => ({ ...now, queue, notes }))
    }
    // The conversation that ended was marked as ended; the one that starts is not
    await commit($, now => ({ ...now, ended: false, working: false }))

    return next(e)
  })

  // Each command has a Portuguese name and an English one, written out here, where `claude plugin validate`
  // reads them. The mod registers and answers only the name of the language in force: the other one may be
  // a command of the user's or of another plugin, and goes on to it.
  on('command.run', { command: ['painel', 'panel'] }, async ($, e, next) => {
    if (e.command !== commandName('panel')) return next(e)
    await $.ui.open({ id: PANE, title: title() })

    return {}
  })

  on('command.run', { command: ['anotar', 'queue'] }, async ($, e, next) => {
    if (e.command !== commandName('queue')) return next(e)
    const text = e.args.trim()
    if (text === '') {
      await $.ui.open({ id: PANE, title: title(), focus: true })

      return {}
    }
    if (await noted($, text)) $.ui.toast(t('Prompt anotado: ') + oneLine(text, 60))

    return {}
  })

  on('command.run', { command: ['painel-recarregar', 'panel-reload'] }, async ($, e, next) =>
    e.command === commandName('reload') ? { text: await reload($) } : next(e),
  )

  // The notes are the user's own: the model does not read them, and nothing here starts a turn
  on('command.run', { command: ['nota', 'note'] }, async ($, e, next) => {
    if (e.command !== commandName('note')) return next(e)
    if (e.args.trim() === '') {
      await $.ui.open({ id: PANE, title: title(), focus: true })

      return {}
    }
    if (await withNote($, e.args)) $.ui.toast(t('Escrito em Anotações: ') + oneLine(e.args, 60))

    return {}
  })

  // For a surface that draws no panel, as the phone: the same switch the panel's button is
  on('command.run', { command: ['envio-automatico', 'auto-send'] }, async ($, e, next) => {
    if (e.command !== commandName('auto')) return next(e)
    const word = e.args.trim().toLowerCase()
    const isOn = word === '' ? (await read($, board)).auto !== true : word === 'ligar' || word === 'on'
    if (word !== '' && !isOn && word !== 'desligar' && word !== 'off') {
      return { text: t('Use /envio-automatico ligar ou /envio-automatico desligar.') }
    }
    autoFailures = 0
    await commit($, now => ({ ...now, auto: isOn, pending: undefined, hold: undefined, stopped: undefined }))
    // With no answer running, the first prompt does not wait for one: its 5 seconds start now
    if (isOn) await arm($)
    const count = (await read($, board)).queue.length

    return {
      text: isOn
        ? t(
            'Envio automático ligado. Prompts anotados: {n}. O primeiro entra 5 segundos depois de cada resposta, ou agora, se nenhuma resposta está em curso.',
            { n: count },
          )
        : t('Envio automático desligado. Prompts anotados: {n}.', { n: count }),
    }
  })

  // A prompt the user typed. A prompt sent from the panel does not pass here (a mod's hook does not run
  // for the mod's own call): the button "Enviar" lists it.
  on('prompt.submit', async ($, e, next) => {
    const origin = e.origin
    if (origin.kind !== 'composer' && origin.kind !== 'bridge' && origin.kind !== 'sdk') return next(e)

    const at = await $.clock.now()
    await commit($, b => ({
      ...b,
      asks: [...b.asks, { at, text: oneLine(e.text, 300), isEntering: true }].slice(-ASKS_KEPT),
    }))
    // The model reads the panel's state again only when it changed since the last prompt
    const context = contextFor(await read($, board))
    if (context === lastContext) return next(e)
    lastContext = context

    return next({ ...e, context: [...(e.context ?? []), context] })
  })

  // The row a prompt is stored in, as it enters the conversation: the panel scrolls to it later, whether or
  // not the surface ever drew it
  on('session.append', { door: 'prompt' }, async ($, e, next) => {
    if (e.agentId === undefined && e.message.isMeta !== true) {
      const text = e.message.content.map(block => (block.type === 'text' ? block.text : '')).join(' ')
      const key = rowKey(text)
      // A message listed when it was sent waits for its row. One read back from the conversation, or listed
      // before rows were kept, does not: it never takes the row of a later message with the same text.
      const isWaiting = (ask: Ask): boolean => ask.isEntering === true && rowKey(ask.text) === key
      if (text.trim() !== '') sawRow(text, e.uuid)
      // The oldest message waiting with this text is the one that just entered
      if (text.trim() !== '' && (await read($, board)).asks.some(isWaiting)) {
        await commit($, now => {
          const at = now.asks.findIndex(isWaiting)

          return {
            ...now,
            asks: now.asks.map((ask, i) => (i === at ? { at: ask.at, text: ask.text, row: e.uuid } : ask)),
          }
        })
      }
    }

    return next(e)
  })

  // Keeps the panel's tool in the prompt's own list, where the model reads its description
  on('tool.describe', { tool: 'mcp__painel-sessao__atualizar' }, async ($, e, next) => ({
    ...(await next(e)),
    isDeferred: false,
  }))

  // A call that only writes to this panel, and would ask the user, runs without the prompt. A rule that
  // denies the tool stays in force. A call that turns the automatic sending on is not such a call: after
  // it the user's queued prompts are sent as the user, so the user is asked as for any other tool.
  on('tool.check', { tool: 'mcp__painel-sessao__atualizar' }, async ($, e, next) => {
    const decided = await next(e)
    if (decided.decision !== 'ask') return decided
    const input = (e as unknown as { input?: Record<string, unknown> }).input
    if (input?.envio_automatico === true) return decided

    return { decision: 'allow' as const, reason: t('painel-sessao: a ferramenta só grava no painel da sessão') }
  })

  on('tool.call', { tool: 'mcp__painel-sessao__atualizar' }, async ($, e) => {
    // The panel shows the main conversation: a subagent's plan does not replace it
    if (e.agentId !== undefined) {
      return { deny: t('painel-sessao: só a conversa principal atualiza o painel da sessão.') }
    }
    const input = e as unknown as Record<string, unknown>
    const steps = asSteps(input.steps)
    const terms = asTerms(input.terms)
    const removed = asStrings(input.remove_terms, 40) ?? []
    const points = asStrings(input.points, 200)
    const decisions = asStrings(input.decisions, 200)
    const auto = input.envio_automatico

    await commit($, b => {
      const dropped = new Set([...removed, ...terms.map(one => one.term)].map(one => one.toLowerCase()))
      const kept = b.terms.filter(one => !dropped.has(one.term.toLowerCase()))

      return {
        ...b,
        steps: steps ?? b.steps,
        terms: [...kept, ...terms].slice(-12),
        points: points === null ? b.points : points.slice(-8),
        decisions: decisions === null ? b.decisions : decisions.slice(0, 6),
        auto: typeof auto === 'boolean' ? auto : b.auto,
        pending: typeof auto === 'boolean' ? undefined : b.pending,
        hold: typeof auto === 'boolean' ? undefined : b.hold,
        stopped: typeof auto === 'boolean' ? undefined : b.stopped,
      }
    })
    const now = await read($, board)

    return {
      result:
        t('Painel atualizado: {steps} passos, {terms} termos, {points} pontos.', {
          steps: now.steps.length,
          terms: now.terms.length,
          points: now.points.length,
        }) +
        (decisions === null ? '' : t(' Decisões do usuário: {n}.', { n: (now.decisions ?? []).length })) +
        (typeof auto === 'boolean'
          ? t(auto ? ' Envio automático ligado. Prompts anotados: {n}.' : t(' Envio automático desligado. Prompts anotados: {n}.'), {
              n: now.queue.length,
            })
          : ''),
    }
  })

  // The line under each answer: the day, when the turn started, when it ended and how long it took
  on('turn.complete', async ($, e, next) => {
    const ran = await next(e)
    if (e.agentId !== undefined) return ran

    const spent = e.usage
    if (spent !== undefined) {
      await update($, usage, now => ({
        ...now,
        lastTurn: {
          input: spent.input_tokens,
          output: spent.output_tokens,
          cacheRead: spent.cache_read_input_tokens,
          cacheWrite: spent.cache_creation_input_tokens,
        },
      }))
    }

    const end = await $.clock.now()
    const start = end - e.durationMs
    // The top of the panel and the list of sessions: this session stopped answering and waits for the user
    await commit($, now => ({ ...now, working: false, turnEndedAt: end }))
    const ended = e.reason === 'answer' ? t('resposta') : e.reason === 'aborted' ? t('interrompida') : t('encerrada com erro')
    const line = t('⏱ {date} · pergunta {start} · {ended} {end} · {span} ({zone})', {
      date: day(end),
      start: clock(start),
      ended,
      end: clock(end),
      span: span(e.durationMs),
      zone: zoneLabel(end),
    })
    // A text another mod put under the answer stays, with this line after it
    const theirs = ran.text !== '' && ran.text !== e.answer ? ran.text + '\n' : ''

    // Automatic sending: after a normal answer the first noted prompt enters after a wait in which the user
    // can cancel. An answer the user interrupted, or one that ended with an error, turns it off, and the
    // panel keeps the reason until the user turns it on again.
    const b = await read($, board)
    if (b.auto === true) {
      if (e.reason === 'answer') await arm($)
      else {
        const why = e.reason === 'aborted' ? t('a resposta foi interrompida') : t('a resposta terminou com erro')
        await commit($, now =>
          logged({ ...now, auto: false, pending: undefined, hold: undefined, stopped: { at: end, why } }, end, t('desligado: ') + why),
        )
        $.ui.toast(t('Envio automático desligado: {why}.', { why }))
      }
    }

    return hasAnswerLine ? { ...ran, text: theirs + line } : ran
  })

  // The text box of the panel posts its text when the user presses Enter alone
  on('ui.message', async ($, e, next) => {
    const data = e.data as { kind?: unknown; text?: unknown } | null
    if (e.element !== 'area-prompt' || data === null || data.kind !== 'submit' || typeof data.text !== 'string') {
      return next(e)
    }
    await noted($, data.text)

    return next(e)
  })

  // A prompt sent from the panel leaves the list of noted prompts when its turn starts
  on('turn.start', async ($, e, next) => {
    const text = e.text.trim()
    const isSent = (one: Queued): boolean => one.sending === true && one.text.trim() === text
    const startedAt = await $.clock.now()
    // A turn that starts calls off an automatic sending that was waiting: it is decided again when this turn
    // ends. The top of the panel and the list of sessions show this session as answering.
    await commit($, now => ({
      ...now,
      working: true,
      turnStartedAt: startedAt,
      pending: undefined,
      hold: undefined,
      queue: now.queue.filter(one => !isSent(one)),
    }))

    return next(e)
  })

  // After each turn, and when a limit of the plan moves: the context window's fill and the plan's limits
  on('session.measure', async ($, e, next) => {
    await update($, usage, now => measured(now, e))

    return next(e)
  })

  // Counts each compaction of the main conversation, with its size before and after
  on('session.compact', async ($, e, next) => {
    const ran = await next(e)
    if (e.agentId !== undefined || e.trigger === 'precompute' || ran.skip !== undefined) return ran

    const at = await $.clock.now()
    await update($, usage, now => ({
      ...now,
      compactions: now.compactions + 1,
      lastCompaction: { at, before: ran.tokensBefore, after: ran.tokensAfter },
    }))
    // The message that carried the panel's state is now part of a summary: the next prompt carries it again
    lastContext = ''

    return ran
  })

  // Draws nothing: keeps which row of the conversation holds each message, so the panel can scroll to it
  on('ui.render', { component: 'UserMessage' }, ($, e, next) => {
    sawRow(e.props.text, e.requestId)

    return next(e)
  })

  // The desktop app tells the engine of every move of focus in the pane, and the engine answers by drawing
  // the pane again, which on that app replaces every element of it (read in the app's code on 07/10/2026).
  // A click moves the focus first: on the app of 06/10/2026 the button was replaced before the click
  // ended, and the click did nothing. Answering here, without `next`, leaves the pane as it is drawn. The
  // terminal keeps its ring, which Tab and the arrows move.
  on('ui.focus', { requestId: PANE }, async ($, e, next) => {
    traced(await $.clock.now(), 'focus:' + e.origin.kind, e.element ?? '')
    if (e.origin.kind !== 'person' || paneSurface === '' || paneSurface === 'terminal') return next(e)

    return {}
  })

  // Changes nothing: keeps which presses reached the mod, for a click that did nothing to be looked into
  on('ui.press', { component: 'Pane' }, async ($, e, next) => {
    traced(await $.clock.now(), 'press', e.element)

    return next(e)
  })

  // The text box of several lines failed on this surface: the panel goes back to the app's own field
  on('ui.fault', async ($, e, next) => {
    if ((await read($, board)).wideBox === true) {
      await commit($, now => ({ ...now, wideBox: false }))
      $.ui.toast(
        t('A caixa de várias linhas não funcionou neste aplicativo: {reason}. O painel voltou ao campo de uma linha.', {
          reason: oneLine(e.reason, 120),
        }),
        { timeoutMs: 10000 },
      )
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // The app's survey about the session holds the automatic sending while it is on the screen
    if (e.props.hasSurvey) {
      if (surveyAt === 0) surveyAt = await $.clock.now()
    } else if (surveyAt !== 0) {
      surveyAt = 0
      void arm($).catch(() => {})
    }
    const b = await read($, board)
    const at = b.steps.findIndex(step => step.status === 'current')
    if (e.props.hasSurvey || (at < 0 && b.queue.length === 0)) return next(e)

    const { Box, Text, Button } = $.ui.resolve(e)
    const theirs = await next(e)

    return (
      <Box flexDirection="column">
        {theirs}
        <Box flexDirection="row" columnGap={1}>
          {at >= 0 && (
            <Text color={ACCENT} bold>
              {t('● Passo {n} de {m}', { n: at + 1, m: b.steps.length })}
            </Text>
          )}
          {at >= 0 && <Text wrap="truncate-end">{b.steps[at]?.title ?? ''}</Text>}
          {b.queue.length > 0 && (
            <Text dimColor>
              {at >= 0 ? '· ' : ''}
              {b.queue.length} {b.queue.length === 1 ? t('prompt anotado') : t('prompts anotados')}
            </Text>
          )}
          {b.queue.length > 0 && b.auto === true && b.pending === undefined && <Text color={DONE}>●</Text>}
          {b.queue.length > 0 && b.auto === true && b.pending === undefined && (
            <Text dimColor>{t('envio automático ligado')}</Text>
          )}
          {b.pending !== undefined && (
            <Text color={ACCENT}>{t('Envio automático às {time}', { time: clockSeconds(b.pending.at) })}</Text>
          )}
          {b.pending !== undefined && (
            <Button
              key="cancelar-envio-faixa"
              label={t('✕ Cancelar')}
              onPress={() => void commit($, now => ({ ...now, auto: false, pending: undefined, hold: undefined }))}
            />
          )}
          <Button
            key="abrir-painel"
            label={t('Painel')}
            dimColor
            onPress={() => void $.ui.open({ id: PANE, title: title() })}
          />
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: 'painel-sessao' }, async ($, e) => {
    const table = $.ui.resolve(e)
    const { Box, Text, Button } = table
    const Input = 'Input' in table ? table.Input : null
    // The text box that receives each key is drawn in the terminal only: on 02/10/2026 the desktop app
    // (Claude Code 2.1.286) drew nothing for a Client and never ran its file. Elsewhere the prompt is
    // written line by line in the app's own field. On 06/10/2026, with 2.1.288, the desktop app did run
    // a Client's file; whether the keys reach it there was not checked, so this choice stands.
    // On 07/10/2026 the user can turn the box on in the desktop app to try it there ("Testar caixa larga"),
    // because the app gives its own field a width the mod cannot change.
    const b = await read($, board)
    paneSurface = e.surface
    const isBoxOn = e.surface === 'terminal' || (e.surface === 'desktop' && b.wideBox === true)
    const Client = isBoxOn && 'Client' in table ? table.Client : null
    // The desktop app keeps what the user types in a field across drawings by itself, as long as the mod
    // draws no value for it or the same one; elsewhere the mod draws what was typed, as before
    const keepsTyping = e.surface === 'desktop'
    const fieldValue = (key: string, typedNow: string): string | undefined =>
      keepsTyping ? fieldSet.get(key) : typedNow
    // The user typed in a field the mod had set: from now on the mod draws no value for it. The drawing asked
    // here takes the value drawn before out of the app's page, so the next time the mod sets the field (to
    // empty it after Enter) the app sees a value that changed.
    const typedIn = (key: string): void => {
      if (fieldSet.delete(key) && keepsTyping) {
        void update($, view, now => ({ ...now, fieldTick: (now.fieldTick ?? 0) + 1 }))
      }
    }
    const draft = b.draft ?? []

    const numbered = b.steps.map((step, i) => ({ ...step, number: i + 1 }))
    const done = numbered.filter(step => step.status === 'done')
    const current = numbered.filter(step => step.status === 'current')
    const upcoming = numbered.filter(step => step.status === 'next')
    const v = await read($, view)
    const asks = b.asks.slice(-v.shownAsks).reverse()

    const remove = (item: Queued) => commit($, now => ({ ...now, queue: now.queue.filter(one => one.id !== item.id) }))

    const send = (item: Queued) => dispatch($, item)

    // Turns the automatic sending on or off; either way, a sending that was waiting is called off
    const setAuto = async (isOn: boolean) => {
      autoFailures = 0
      await commit($, now => ({ ...now, auto: isOn, pending: undefined, hold: undefined, stopped: undefined }))
      // With no answer running, the first prompt does not wait for one: its 5 seconds start now
      if (isOn) await arm($)
    }

    // Moves a noted prompt one place up or down: the automatic sending sends the first of the list
    const move = (item: Queued, by: -1 | 1) =>
      commit($, now => {
        const from = now.queue.findIndex(one => one.id === item.id)
        const to = from + by
        if (from < 0 || to < 0 || to >= now.queue.length) return now
        const queue = [...now.queue]
        const [taken] = queue.splice(from, 1)
        if (taken === undefined) return now
        queue.splice(to, 0, taken)

        // A wait that was counting for the prompt that was first is counted again for the one that is first now
        const isSameFirst = now.pending === undefined || queue[0]?.id === now.pending.id

        return { ...now, queue, pending: isSameFirst ? now.pending : undefined }
      }).then(() => arm($))

    // Adds the noted prompt to what the prompt box already holds, without replacing it
    const toBox = async (item: Queued) => {
      const filled = await $.prompt.fill({ text: item.text, mode: 'append' })
      if (filled.isFilled) await remove(item)
      else $.ui.toast(t('A caixa de prompt não aceitou o texto. O prompt continua em Próximos prompts.'))
    }

    // Notes the lines already kept plus the line in the field as one prompt
    const note = async (line: string) => {
      const text = [...draft, line].join('\n')
      // When the panel keeps as many prompts as it may, the text stays in the field and in the kept lines
      if (text.trim() !== '' && !(await noted($, text))) return
      await emptied('novo-prompt')
      await commit($, now => ({ ...now, draft: [] }))
    }

    // The field is empty from its next drawing on, and so is the record of what was typed in it
    const emptied = async (key: 'novo-prompt' | 'nova-anotacao') => {
      fieldSet.set(key, '')
      if (key === 'novo-prompt') typing = ''
      else noteTyping = ''
      await update($, typed, now => (key === 'novo-prompt' ? { ...now, prompt: '' } : { ...now, note: '' }))
    }

    // Keeps the line in the field as a line of the prompt being written, and empties the field. After a
    // reload of the mod the module's own memory of the field is empty, and the session's state has the line.
    const breakLine = async () => {
      const line = typing !== '' ? typing : (await read($, typed)).prompt
      await emptied('novo-prompt')
      await commit($, now => ({ ...now, draft: [...(now.draft ?? []), line].slice(-40) }))
    }

    const clearDraft = async () => {
      await emptied('novo-prompt')
      await commit($, now => ({ ...now, draft: [] }))
    }

    const notes = b.notes ?? []
    // Enter in the field of the notes: replaces the line being changed, or adds what was typed as new lines
    const writeNote = async (text: string) => {
      const at = v.editingNote
      if (at !== undefined) {
        await emptied('nova-anotacao')
        await commit($, now => ({
          ...now,
          notes: (now.notes ?? []).map((line, i) => (i === at ? text.trimEnd().slice(0, NOTE_LINE_LIMIT) : line)),
        }))
        await update($, view, now => ({ ...now, editingNote: undefined }))

        return
      }
      if (await withNote($, text)) {
        await emptied('nova-anotacao')
        // A blank text changed no note, so nothing would draw the field again, empty: this value does.
        // It is a state write because a redraw asked with $.ui.invalidate needed a second click (02/10/2026).
        if (text.trim() === '') await update($, view, now => ({ ...now, fieldTick: (now.fieldTick ?? 0) + 1 }))
      }
    }
    // Puts a line of the notes in the field, to be changed there
    const editNote = (at: number) => {
      noteTyping = notes[at] ?? ''
      fieldSet.set('nova-anotacao', noteTyping)

      return update($, view, now => ({ ...now, editingNote: at, isClearingNotes: undefined }))
    }
    const dropNote = async (at: number) => {
      // A change under way is called off, and the text it had put in the field goes with it
      if (v.editingNote !== undefined) await emptied('nova-anotacao')
      await update($, view, now => ({ ...now, editingNote: undefined }))
      await commit($, now => ({ ...now, notes: (now.notes ?? []).filter((_, i) => i !== at) }))
    }
    const clearNotes = async () => {
      await emptied('nova-anotacao')
      await update($, view, now => ({ ...now, editingNote: undefined, isClearingNotes: undefined }))
      await commit($, now => ({ ...now, notes: [] }))
    }
    // Moves the line of the notes that is being changed one place up or down; the change goes on, on that line
    const moveNote = async (by: -1 | 1) => {
      const from = v.editingNote
      const to = (from ?? 0) + by
      if (from === undefined || to < 0 || to >= notes.length) return
      await commit($, now => {
        const lines = [...(now.notes ?? [])]
        const [taken] = lines.splice(from, 1)
        if (taken === undefined) return now
        lines.splice(to, 0, taken)

        return { ...now, notes: lines }
      })
      await update($, view, now => ({ ...now, editingNote: to }))
    }

    // The progress bar is as wide as the card's body: the pane less the border and the padding
    const barWidth = Math.max(10, Math.min(60, e.props.bodyColumns - 4))
    const hiddenDone = done.length - 2
    // How many characters fit in one row of a noted prompt: the pane less the frame, the padding and the
    // number. The desktop app's font is narrower than the cell the pane is measured in: a row of 62 cells
    // held 77 characters on 06/10/2026.
    const rowChars = Math.max(20, Math.floor((e.props.bodyColumns - 6) * (e.surface === 'terminal' ? 1 : 1.2)))

    // Scrolls the conversation to the row of a message the user sent
    const jump = async (ask: Ask) => {
      // The row kept when the message entered the conversation; for a message older than that record, the
      // last row the conversation showed with the same text
      const row = ask.row ?? rowIds.get(rowKey(ask.text))?.at(-1)
      if (row === undefined) {
        $.ui.toast(t('Não achei essa mensagem na conversa. Ela ainda não apareceu na tela com o painel ligado.'))

        return
      }
      try {
        const moved = await $.ui.scroll({ to: { requestId: row }, block: 'start' })
        if (moved.deny !== undefined) $.ui.toast(t('A conversa não rolou até a mensagem: ') + moved.deny)
      } catch (error) {
        $.ui.toast(t('A conversa não rolou até a mensagem: ') + (error instanceof Error ? error.message : String(error)))
      }
    }

    // Writing the value redraws the panel: a redraw asked with $.ui.invalidate from a press needed a
    // second click on the desktop app (02/10/2026)
    const showAsks = (more: number) =>
      update($, view, now => ({ ...now, shownAsks: more === 0 ? 5 : now.shownAsks + more }))

    // The room above a row of buttons: half a row where the surface lays out in pixels, none in the terminal
    const breath = e.surface === 'terminal' ? 0 : 0.5
    // The room between the title of an open section and what the section holds
    const titleGap = e.surface === 'terminal' ? 0 : 0.75

    const openIds = b.open ?? OPEN_AT_FIRST
    const toggleSection = (id: string) =>
      commit($, now => {
        const list = now.open ?? OPEN_AT_FIRST

        return { ...now, open: list.includes(id) ? list.filter(one => one !== id) : [...list, id] }
      })

    const toggleItem = (id: number) =>
      update($, view, now => ({
        ...now,
        expanded: now.expanded.includes(id) ? now.expanded.filter(one => one !== id) : [...now.expanded, id],
      }))

    // One section of the panel: a rounded frame and its title, which opens and closes it. Closed, the title
    // is followed by the section's summary in one line, so the whole panel reads without a click; open, by
    // a count. The title is in capitals, to stand apart from what the section holds: a button's label takes
    // no color and no weight, so the case is what a mod can change in it, and the color goes in a mark before
    // it. The arrow stays in the button, because the arrow is where a click lands. Open, the title has room
    // below it.
    const card = (id: string, label: string, count: string, body: JSX.Element) => {
      const isOpen = openIds.includes(id)
      const beside = isOpen ? count : (summaries[id] ?? count)

      return (
        <Box flexDirection="column" borderStyle="round" borderDimColor paddingX={1}>
          <Box
            flexDirection="row"
            justifyContent="space-between"
            alignItems="center"
            columnGap={2}
            marginBottom={isOpen ? titleGap : 0}
          >
            <Box flexDirection="row" columnGap={1} alignItems="center" flexShrink={0}>
              <Text color={ACCENT} bold>
                ▍
              </Text>
              <Button
                key={'secao-' + id}
                label={(isOpen ? '▾ ' : '▸ ') + label.toUpperCase()}
                plain
                onPress={() => void toggleSection(id)}
              />
            </Box>
            <Text dimColor wrap="truncate-end">
              {beside}
            </Text>
          </Box>
          {isOpen && body}
        </Box>
      )
    }

    const u = await read($, usage)
    const clockNow = await $.clock.now()
    // True when a listed message is not of today: then the list names each day
    const spansDays = asks.some(ask => dayLabel(ask.at, clockNow) !== t('Hoje'))
    const used = u.percent ?? (u.tokens !== undefined && u.window > 0 ? Math.round((u.tokens / u.window) * 100) : 0)
    const meterWidth = Math.max(10, Math.min(60, e.props.bodyColumns - 4))
    const turn = u.lastTurn
    const compaction = u.lastCompaction

    // A progress bar. Where the surface draws pictures it is a drawing as wide as the card, whatever the
    // pane's width; a row of characters wrapped onto three lines in the desktop app, whose font is not of
    // fixed width (06/10/2026). The terminal, whose font is, keeps the row of characters.
    const Svg = e.surface !== 'terminal' && 'Svg' in table ? table.Svg : null
    const meter = (percent: number, color: string, alt: string, cells: number) => {
      const share = Math.max(0, Math.min(100, percent))
      if (Svg === null) {
        const filled = Math.round((share / 100) * cells)

        return (
          <Box flexDirection="row">
            <Text color={color}>{'━'.repeat(filled)}</Text>
            <Text dimColor>{'━'.repeat(cells - filled)}</Text>
          </Box>
        )
      }

      return (
        <Svg
          alt={alt}
          height={6}
          source={
            '<svg xmlns="http://www.w3.org/2000/svg" width="4000" height="6" viewBox="0 0 1000 6" preserveAspectRatio="none">' +
            '<rect width="1000" height="6" rx="3" fill="#888888" fill-opacity="0.28"/>' +
            (share > 0 ? '<rect width="' + share * 10 + '" height="6" rx="3" fill="' + color + '"/>' : '') +
            '</svg>'
          }
        />
      )
    }

    // A figure of the first section: its name dim, its value in bold, and a note after it
    const figure = (name: string, value: string, color: string | undefined, note: string) => (
      <Box flexDirection="row" columnGap={1}>
        <Text dimColor>{name}</Text>
        <Text bold color={color}>
          {value}
        </Text>
        {note !== '' && <Text dimColor>{note}</Text>}
      </Box>
    )

    const decisions = b.decisions ?? []
    const lastAuto = (b.autoLog ?? []).at(-1)
    // What the panel shows of the session, as plain text: a selection made with the mouse does not last on
    // the desktop app, which replaces the panel's text at every redraw
    const asText = (): string =>
      [
        t('Passos'),
        ...b.steps.map((step, i) => (step.status === 'done' ? '[x] ' : step.status === 'current' ? '[>] ' : '[ ] ') + (i + 1) + '. ' + step.title),
        '',
        t('Decisões suas'),
        ...decisions.map(one => '- ' + one),
        '',
        t('Pontos importantes'),
        ...b.points.map(one => '- ' + one),
        '',
        t('Termos'),
        ...b.terms.map(one => '- ' + one.term + ': ' + one.meaning),
      ].join('\n')
    const nowStep = current[0]
    const lastAsk = b.asks[b.asks.length - 1]
    const week = u.limits.find(limit => limit.kind === 'seven_day')
    const plural = (count: number, one: string, many: string): string => count + ' ' + (count === 1 ? one : many)

    // What each closed section says in one line beside its title
    const summaries: Record<string, string> = {
      decisoes: decisions.length === 0 ? t('nenhuma pendente') : (decisions[0] ?? ''),
      passos:
        b.steps.length === 0
          ? t('nenhum registrado')
          : t('{a} de {b}', { a: done.length, b: b.steps.length }) +
            (upcoming[0] === undefined ? '' : t(' · a seguir: ') + upcoming[0].title),
      prompts:
        b.queue.length === 0
          ? t('nenhum anotado')
          : (b.auto === true ? t('envio automático · ') : '') + oneLine(b.queue[0]?.text ?? '', 80),
      mensagens:
        lastAsk === undefined ? t('nenhuma') : (lastAsk.at === 0 ? '' : clock(lastAsk.at) + ' · ') + lastAsk.text,
      notas:
        plural(notes.length, t('anotação'), t('anotações')) +
        ' · ' +
        plural(b.points.length, t('ponto'), t('pontos')) +
        ' · ' +
        plural(b.terms.length, t('termo'), t('termos')),
      contexto:
        u.tokens === undefined
          ? t('sem medição ainda')
          : t('{used}% · {tokens} de {window}', { used, tokens: amount(u.tokens), window: amount(u.window) }) +
            (week === undefined ? '' : t(' · semana {p}%', { p: decimal(week.percent) })),
    }

    // The state of the session, at the top: answering, waiting for the user, or about to send a noted prompt
    const state =
      b.pending !== undefined
        ? { text: t('Envio automático às {time}', { time: clockSeconds(b.pending.at) }), color: ACCENT }
        : b.working === true
          ? { text: t('Respondendo ') + ago(clockNow - (b.turnStartedAt ?? clockNow)), color: BUSY }
          : b.turnEndedAt !== undefined
            ? { text: t('Aguardando você ') + ago(clockNow - b.turnEndedAt), color: ACCENT }
            : { text: t('Nenhuma resposta nesta sessão desde que o painel foi ligado'), color: undefined }

    const sessions = v.sessions ?? []
    // The number beside the second view's name: the other sessions that wait for the user
    const waitingElsewhere = sessions.filter(row => row.state === 'aguardando' && !row.isThis).length
    const isSessions = v.tab === 'sessoes'
    const showTab = async (tab: 'sessao' | 'sessoes') => {
      await update($, view, now => ({ ...now, tab }))
      if (tab !== 'sessoes') return
      const rows = await sessionRows($)
      await update($, view, now => ({ ...now, sessions: rows }))
    }
    const stateLabel: Record<SessionRow['state'], string> = {
      respondendo: t('respondendo'),
      aguardando: t('aguardando você'),
      encerrada: t('encerrada'),
      parada: t('sem atividade'),
      nova: t('sem resposta ainda'),
    }
    const stateColor: Record<SessionRow['state'], string | undefined> = {
      respondendo: BUSY,
      aguardando: ACCENT,
      encerrada: undefined,
      parada: undefined,
      nova: undefined,
    }

    // The two views of the pane. The second lists every session of this machine that runs the mod.
    const tabs = (
      <Box flexDirection="row" columnGap={1} alignItems="center">
        <Button
          key="aba-sessao"
          label={t('Esta sessão')}
          variant={isSessions ? 'secondary' : 'primary'}
          onPress={() => void showTab('sessao')}
        />
        <Button
          key="aba-sessoes"
          label={t('Sessões') + (waitingElsewhere === 0 ? '' : ' ' + waitingElsewhere)}
          variant={isSessions ? 'primary' : 'secondary'}
          onPress={() => void showTab('sessoes')}
        />
      </Box>
    )

    if (isSessions) {
      return (
        <Box flexDirection="column" rowGap={1}>
          {tabs}
          {sessions.length === 0 && (
            <Text dimColor italic>
              {t('Nenhuma sessão com o painel foi encontrada nesta máquina.')}
            </Text>
          )}
          {sessions.map(row => (
            <Box flexDirection="column" borderStyle="round" borderDimColor={row.state !== 'aguardando'} paddingX={1}>
              <Box flexDirection="row" justifyContent="space-between" columnGap={2}>
                <Text color={stateColor[row.state]} dimColor={stateColor[row.state] === undefined}>
                  {stateLabel[row.state]}
                </Text>
                <Text dimColor>{ago(clockNow - row.at)}</Text>
              </Box>
              <Text bold wrap="truncate-end">
                {row.name + (row.isThis ? t(' · esta sessão') : '')}
              </Text>
              <Text dimColor wrap="truncate-end">
                {(row.stepsTotal === 0
                  ? t('sem passos')
                  : t('Passo {n} de {m}', { n: Math.min(row.stepsDone + 1, row.stepsTotal), m: row.stepsTotal })) +
                  (row.decisions === 0 ? '' : ' · ' + plural(row.decisions, t('decisão sua'), t('decisões suas'))) +
                  (row.queued === 0 ? '' : ' · ' + plural(row.queued, t('prompt anotado'), t('prompts anotados')))}
              </Text>
              {row.step !== '' && (
                <Text dimColor wrap="truncate-end">
                  {row.step}
                </Text>
              )}
            </Box>
          ))}
          <Text dimColor>{t('Só aparecem as sessões desta máquina que têm o painel ligado. A lista é lida a cada minuto.')}</Text>
        </Box>
      )
    }

    const contextCard = card(
          'contexto',
          t('Contexto e limites'),
          u.window === 0
            ? ''
            : u.tokens === undefined
              ? t('janela de ') + amount(u.window)
              : amount(u.tokens) + ' / ' + amount(u.window) + ' · ' + used + '%',
          <Box flexDirection="column">
            {u.window === 0 && (
              <Text dimColor italic>
                {t('Sem medição ainda. Os números aparecem depois da próxima resposta.')}
              </Text>
            )}
            {u.tokens !== undefined && (
              <Box flexDirection="column" marginBottom={breath}>
                {meter(used, tone(used), t('{p}% da janela de contexto em uso', { p: used }), meterWidth)}
              </Box>
            )}
            <Box flexDirection="row" columnGap={3} flexWrap="wrap">
              {u.tokens !== undefined &&
                figure(t('Contexto livre'), amount(Math.max(0, u.window - u.tokens)), tone(used), '')}
              {u.limits.map(limit =>
                figure(
                  limitName(limit.kind),
                  decimal(limit.percent) + '%',
                  tone(limit.percent),
                  limit.resetsAt === undefined ? '' : t('reinicia {when}', { when: resetLabel(limit.resetsAt, clockNow) }),
                ),
              )}
              {figure(
                t('Compactações'),
                String(u.compactions),
                undefined,
                compaction === undefined
                  ? ''
                  : t('última ') +
                      clock(compaction.at) +
                      (compaction.before !== undefined && compaction.after !== undefined
                        ? ': ' + amount(compaction.before) + ' → ' + amount(compaction.after)
                        : ''),
              )}
            </Box>
            {turn !== undefined && (
              <Text dimColor wrap="truncate-end">
                {t('Último turno: entrada {input} · saída {output} · cache lido {read} · cache gravado {written}', {
                  input: amount(turn.input),
                  output: amount(turn.output),
                  read: amount(turn.cacheRead),
                  written: amount(turn.cacheWrite),
                })}
              </Text>
            )}
          </Box>,
    )

    return (
      <Box flexDirection="column" rowGap={1}>
        {tabs}

        <Box flexDirection="column" borderStyle="round" borderColor={state.color} borderDimColor={state.color === undefined} paddingX={1}>
          <Box flexDirection="row" justifyContent="space-between" columnGap={2}>
            <Text color={state.color} bold={state.color !== undefined} dimColor={state.color === undefined}>
              {state.text}
            </Text>
            {b.turnEndedAt !== undefined && <Text dimColor>{t('resposta {time}', { time: clock(b.turnEndedAt) })}</Text>}
          </Box>
          {nowStep !== undefined && (
            <Text dimColor>
              {t('Passo {n} de {m}', { n: nowStep.number, m: b.steps.length })}
            </Text>
          )}
          {nowStep !== undefined && <Text bold>{nowStep.title}</Text>}
          {b.steps.length > 0 && (
            <Box flexDirection="column" marginTop={breath}>
              {meter(
                (done.length / b.steps.length) * 100,
                ACCENT,
                t('{a} de {b} passos concluídos', { a: done.length, b: b.steps.length }),
                barWidth,
              )}
            </Box>
          )}
        </Box>

        {card(
          'decisoes',
          t('Decisões suas'),
          decisions.length === 0 ? '' : String(decisions.length),
          <Box flexDirection="column">
            {decisions.length === 0 && (
              <Text dimColor italic>
                {t('Nenhuma decisão pendente.')}
              </Text>
            )}
            {decisions.map((decision, i) => (
              <Box flexDirection="row" columnGap={1} alignItems="flex-start" justifyContent="space-between">
                <Box flexDirection="row" columnGap={1} alignItems="flex-start">
                  <Text color={ACCENT} bold>
                    ?
                  </Text>
                  <Text>{decision}</Text>
                </Box>
                <Box flexShrink={0}>
                  <Button
                    key={'decisao-resolvida-' + i}
                    label={t('✓ Resolvida')}
                    plain
                    dimColor
                    onPress={() =>
                      void commit($, now => ({
                        ...now,
                        decisions: (now.decisions ?? []).filter(one => one !== decision),
                      }))
                    }
                  />
                </Box>
              </Box>
            ))}
          </Box>,
        )}

        {card(
          'passos',
          t('Passos'),
          b.steps.length === 0 ? '' : t('{a} de {b} concluídos', { a: done.length, b: b.steps.length }),
          <Box flexDirection="column">
            {b.steps.length === 0 && (
              <Text dimColor italic>
                {t('Nenhum passo registrado nesta sessão.')}
              </Text>
            )}
            {hiddenDone > 0 && (
              <Text dimColor>
                {t(hiddenDone === 1 ? '⋮ {n} passo concluído antes' : t('⋮ {n} passos concluídos antes'), { n: hiddenDone })}
              </Text>
            )}
            {done.slice(-2).map(step => (
              <Box flexDirection="row" columnGap={1}>
                <Text color={DONE}>✓</Text>
                <Text dimColor>
                  {step.number}. {step.title}
                </Text>
              </Box>
            ))}
            {current.map(step => (
              <Box flexDirection="row" columnGap={1}>
                <Text color={ACCENT} bold>
                  ●
                </Text>
                <Text bold>
                  {step.number}. {step.title}
                </Text>
                <Box flexShrink={0}>
                  <Text color={ACCENT} inverse bold>
                    {t(' AGORA ')}
                  </Text>
                </Box>
              </Box>
            ))}
            {upcoming.slice(0, 6).map(step => (
              <Box flexDirection="row" columnGap={1}>
                <Text dimColor>○</Text>
                <Text>
                  {step.number}. {step.title}
                </Text>
              </Box>
            ))}
            {upcoming.length > 6 && (
              <Text dimColor>
                {t(upcoming.length - 6 === 1 ? '⋮ mais {n} passo depois' : t('⋮ mais {n} passos depois'), {
                  n: upcoming.length - 6,
                })}
              </Text>
            )}
            {current.length > 0 && (
              <Box flexDirection="row" marginTop={1}>
                <Button
                  key="concluir-passo"
                  label={t('Concluir passo atual')}
                  variant="primary"
                  // Concludes the step that was current when the button was drawn: a second click before
                  // the redraw does not conclude the step after it
                  onPress={() =>
                    commit($, now => {
                      const at = now.steps.findIndex(step => step.status === 'current')

                      return at === (current[0]?.number ?? 0) - 1 ? { ...now, steps: advance(now.steps) } : now
                    })
                  }
                />
              </Box>
            )}
          </Box>,
        )}

        {card(
          'prompts',
          t('Próximos prompts'),
          b.queue.length === 0 ? '' : t(b.queue.length === 1 ? '{n} anotado' : t('{n} anotados'), { n: b.queue.length }),
          <Box flexDirection="column" rowGap={1}>
            <Box flexDirection="row" columnGap={1} rowGap={breath} alignItems="center" flexWrap="wrap">
              {/* A button's label takes no color: the mark of the state is a text beside it, green when on */}
              {b.auto === true ? (
                <Text color={DONE} bold>
                  ●
                </Text>
              ) : (
                <Text dimColor>○</Text>
              )}
              <Button
                key="envio-automatico"
                label={b.auto === true ? t('Envio automático: ligado') : t('Envio automático: desligado')}
                onPress={() => void setAuto(b.auto !== true)}
              />
              {b.auto === true && b.pending === undefined && b.hold === undefined && (
                <Text dimColor>{t('Depois de cada resposta, o primeiro prompt entra em 5 segundos.')}</Text>
              )}
              {b.auto === true && b.pending === undefined && b.hold !== undefined && (
                <Text color={ACCENT}>
                  {b.hold === 'pesquisa'
                    ? t('Aguardando a pesquisa do aplicativo sair da tela para enviar.')
                    : t('Aguardando um agente em segundo plano terminar para enviar.')}
                </Text>
              )}
              {b.pending !== undefined && (
                <Text color={ACCENT}>{t('O primeiro prompt entra às {time}.', { time: clockSeconds(b.pending.at) })}</Text>
              )}
              {b.pending !== undefined && (
                <Button key="cancelar-envio" label={t('✕ Cancelar')} onPress={() => void setAuto(false)} />
              )}
            </Box>
            {/* Why the automatic sending turned itself off, until the user turns it on again */}
            {b.auto !== true && b.stopped !== undefined && (
              <Text color={RED}>
                {t('Desligado às {time}: {why}.', { time: clock(b.stopped.at), why: b.stopped.why })}
              </Text>
            )}
            {(b.auto === true || b.stopped !== undefined) && lastAuto !== undefined && (
              <Text dimColor wrap="truncate-end">
                {t('Último evento do envio automático: {time} · {what}', { time: clock(lastAuto.at), what: lastAuto.what })}
              </Text>
            )}
            {Client !== null && (
              <Client
                key="area-prompt"
                module="./textarea.tsx"
                width="100%"
                props={{
                  placeholder: t('Clique aqui e escreva um prompt para enviar depois'),
                  hint: t('Enter anota · Ctrl+Shift+Enter quebra a linha'),
                  accent: ACCENT,
                  minRows: 5,
                }}
              />
            )}
            {Client === null && Input !== null && (
              <Box flexDirection="column">
                {draft.length > 0 && (
                  <Box flexDirection="column" borderStyle="round" borderDimColor paddingX={1}>
                    <Text dimColor>{t('Linhas já guardadas deste prompt')}</Text>
                    {draft.map(line => (
                      <Text>{line === '' ? ' ' : line}</Text>
                    ))}
                  </Box>
                )}
                <Box flexDirection="column" alignItems="stretch" width="100%">
                  <Input
                    key="novo-prompt"
                    // The engine drops any width given to an Input (checked on 02/10/2026), so the field is as
                    // wide as the surface draws it. The long placeholder tests whether the desktop app sizes
                    // the field by its placeholder.
                    placeholder={
                      draft.length === 0
                        ? t('Escreva um prompt para enviar depois e tecle Enter para anotar. Para várias linhas, use Nova linha.')
                        : t('Escreva a próxima linha e tecle Enter para anotar, ou use Nova linha para continuar o prompt.')
                    }
                    value={fieldValue('novo-prompt', typing)}
                    submitLabel={t('Anotar')}
                    onInput={value => {
                      typing = value
                      typedIn('novo-prompt')
                      void update($, typed, now => ({ ...now, prompt: value }))
                    }}
                    onSubmit={value => void note(value)}
                  />
                </Box>
                <Box flexDirection="row" columnGap={1} rowGap={breath} flexWrap="wrap"marginTop={breath}>
                  <Button key="nova-linha" label={t('↵ Nova linha')} onPress={() => void breakLine()} />
                  {draft.length > 0 && (
                    <Button key="limpar-rascunho" label={t('✕ Limpar linhas')} dimColor onPress={() => void clearDraft()} />
                  )}
                </Box>
              </Box>
            )}
            {/* The app gives its own field a fixed width. The box of several lines takes the whole width of
                the panel; whether the desktop app sends it the keys was not seen on screen, so it is a trial
                the user turns on and off */}
            {e.surface === 'desktop' && 'Client' in table && (
              <Box flexDirection="row" columnGap={1} rowGap={breath} alignItems="center" flexWrap="wrap">
                <Button
                  key="caixa-larga"
                  label={b.wideBox === true ? t('Voltar ao campo de uma linha') : t('Testar caixa larga de várias linhas')}
                  dimColor
                  onPress={() => void commit($, now => ({ ...now, wideBox: now.wideBox !== true }))}
                />
              </Box>
            )}
            {b.queue.length === 0 && (
              <Text dimColor italic>
                {t('Nenhum prompt anotado.')}
              </Text>
            )}
            {b.queue.map((item, i) => {
              const lines = item.text.split('\n')
              // A long prompt shows the rows that fit until the user asks for all of it
              const cut = firstRows(lines, rowChars, ROWS_SHOWN)
              const isLong = cut.hidden > 0 || cut.isCut
              const isWhole = !isLong || v.expanded.includes(item.id)
              const shown = isWhole ? lines : cut.lines

              return (
                <Box flexDirection="column">
                  <Box flexDirection="row" columnGap={1} alignItems="flex-start">
                    <Box flexShrink={0}>
                      <Text color={ACCENT} bold>
                        {i + 1}
                      </Text>
                    </Box>
                    <Box flexDirection="column">
                      {shown.map(line => (
                        <Text>{line === '' ? ' ' : line}</Text>
                      ))}
                      {!isWhole && cut.hidden > 0 && (
                        <Text dimColor>
                          {t(cut.hidden === 1 ? '⋮ mais {n} linha' : t('⋮ mais {n} linhas'), { n: cut.hidden })}
                        </Text>
                      )}
                    </Box>
                  </Box>
                  {item.sending === true && (
                    <Box flexDirection="row" columnGap={1} marginLeft={2} marginTop={breath}>
                      <Text color={ACCENT}>{t('Enviado. Entra na conversa quando a resposta atual terminar.')}</Text>
                    </Box>
                  )}
                  <Box flexDirection="row" columnGap={1} rowGap={breath} flexWrap="wrap"marginLeft={2} marginTop={breath}>
                    {item.sending !== true && (
                      <Button
                        key={'enviar-' + item.id}
                        label={t('➤ Enviar')}
                        variant="primary"
                        onPress={() => void send(item)}
                      />
                    )}
                    {isLong && (
                      <Button
                        key={'ver-' + item.id}
                        label={isWhole ? t('▴ Ver menos') : t('▾ Ver tudo')}
                        onPress={() => void toggleItem(item.id)}
                      />
                    )}
                    {/* The other actions stay behind one button, so each noted prompt shows two buttons */}
                    {item.sending !== true && (
                      <Button
                        key={'mais-' + item.id}
                        label="⋯"
                        onPress={() =>
                          void update($, view, now => ({ ...now, menu: now.menu === item.id ? undefined : item.id }))
                        }
                      />
                    )}
                    {item.sending !== true && v.menu === item.id && i > 0 && (
                      <Button key={'subir-' + item.id} label={t('↑ Subir')} onPress={() => void move(item, -1)} />
                    )}
                    {item.sending !== true && v.menu === item.id && i < b.queue.length - 1 && (
                      <Button key={'descer-' + item.id} label={t('↓ Descer')} onPress={() => void move(item, 1)} />
                    )}
                    {item.sending !== true && v.menu === item.id && (
                      <Button key={'caixa-' + item.id} label={t('✎ Pôr na caixa')} onPress={() => void toBox(item)} />
                    )}
                    {item.sending !== true && v.menu === item.id && (
                      <Button
                        key={'copiar-' + item.id}
                        label={t('⧉ Copiar')}
                        onPress={press => void $.ui.copy({ text: item.text, surface: press.surface })}
                      />
                    )}
                    {item.sending !== true && v.menu === item.id && (
                      <Button key={'excluir-' + item.id} label={t('✕ Excluir')} dimColor onPress={() => void remove(item)} />
                    )}
                  </Box>
                </Box>
              )
            })}
          </Box>,
        )}

        {card(
          'mensagens',
          t('Minhas últimas mensagens'),
          asks.length === 0 ? '' : t('{a} de {b}', { a: asks.length, b: b.asks.length }),
          <Box flexDirection="column">
            {asks.length === 0 && (
              <Text dimColor italic>
                {t('Nenhuma mensagem enviada desde que o painel foi ligado.')}
              </Text>
            )}
            {asks.flatMap((ask, i) => {
              // When the list goes beyond today, each day starts with a line that names it
              const label = dayLabel(ask.at, clockNow)
              const before = asks[i - 1]
              const opensDay = spansDays && (before === undefined || dayLabel(before.at, clockNow) !== label)

              return [
                opensDay ? (
                  <Text dimColor bold>
                    {label}
                  </Text>
                ) : null,
                <Box flexDirection="row" columnGap={1} alignItems="center">
                  <Box flexShrink={0}>
                    <Button
                      // A message read back from the conversation has no time: its key is its place in the list
                      key={ask.at === 0 ? 'ir-antiga-' + i : 'ir-' + ask.at}
                      label={ask.at === 0 ? t('antes ↗') : clock(ask.at) + ' ↗'}
                      plain
                      dimColor={i > 0}
                      onPress={() => void jump(ask)}
                    />
                  </Box>
                  <Text wrap="truncate-end" dimColor={i > 0}>
                    {oneLine(ask.text, 120)}
                  </Text>
                  {/* The app replaces the panel's text at every redraw, which drops a selection made with
                      the mouse: this copies what the panel keeps of the message, its first 300 characters */}
                  <Box flexShrink={0}>
                    <Button
                      key={ask.at === 0 ? 'copiar-antiga-' + i : 'copiar-msg-' + ask.at}
                      label="⧉"
                      plain
                      dimColor
                      onPress={press => void $.ui.copy({ text: ask.text, surface: press.surface })}
                    />
                  </Box>
                </Box>,
              ]
            })}
            {(b.asks.length > asks.length || asks.length > 5) && (
              <Box flexDirection="row" columnGap={1} marginTop={breath}>
                {b.asks.length > asks.length && (
                  <Button
                    key="mais-mensagens"
                    label={t('▾ Carregar mais {n}', { n: Math.min(5, b.asks.length - asks.length) })}
                    onPress={() => void showAsks(5)}
                  />
                )}
                {asks.length > 5 && (
                  <Button key="menos-mensagens" label={t('▴ Mostrar só 5')} dimColor onPress={() => void showAsks(0)} />
                )}
              </Box>
            )}
          </Box>,
        )}

        {card(
          'notas',
          t('Notas'),
          summaries.notas ?? '',
          <Box flexDirection="column">
            <Text bold>{t('Pontos importantes')}</Text>
            {b.points.length === 0 && (
              <Text dimColor italic>
                {t('Nenhum ponto registrado.')}
              </Text>
            )}
            {b.points.map(point => (
              <Box flexDirection="row" columnGap={1}>
                <Text color={ACCENT}>◆</Text>
                <Text>{point}</Text>
              </Box>
            ))}
            <Box marginTop={1}>
              <Text bold>{t('Termos')}</Text>
            </Box>
            {b.terms.length === 0 && (
              <Text dimColor italic>
                {t('Nenhum termo registrado.')}
              </Text>
            )}
            {b.terms.map(one => (
              <Box flexDirection="column">
                <Text color={ACCENT} bold>
                  {one.term}
                </Text>
                <Text dimColor>{one.meaning}</Text>
              </Box>
            ))}
            <Box marginTop={1} flexDirection="row" justifyContent="space-between">
              <Text bold>{t('Suas anotações')}</Text>
              <Text dimColor>
                {notes.length === 0 ? '' : t(notes.length === 1 ? '{n} linha' : t('{n} linhas'), { n: notes.length })}
              </Text>
            </Box>
            {notes.length === 0 && (
              <Text dimColor italic>
                {t('Nenhuma anotação nesta sessão. O que você escreve aqui fica só no painel.')}
              </Text>
            )}
            {notes.map((line, i) => (
              <Box flexDirection="row" columnGap={1} alignItems="flex-start" justifyContent="space-between">
                <Text color={v.editingNote === i ? ACCENT : undefined}>{line === '' ? ' ' : line}</Text>
                <Box flexDirection="row" columnGap={1} flexShrink={0}>
                  <Button key={'nota-editar-' + i} label="✎" plain dimColor onPress={() => void editNote(i)} />
                  <Button key={'nota-excluir-' + i} label="✕" plain dimColor onPress={() => void dropNote(i)} />
                </Box>
              </Box>
            ))}
            {Input !== null && (
              <Box flexDirection="column" alignItems="stretch" width="100%" marginTop={notes.length === 0 ? 0 : breath}>
                <Input
                  key="nova-anotacao"
                  placeholder={
                    v.editingNote === undefined
                      ? t('Escreva uma anotação e tecle Enter. Cada Enter começa uma linha.')
                      : t('Altere a linha {n} e tecle Enter.', { n: v.editingNote + 1 })
                  }
                  value={fieldValue('nova-anotacao', noteTyping)}
                  submitLabel={v.editingNote === undefined ? t('Escrever') : t('Salvar')}
                  onInput={value => {
                    noteTyping = value
                    typedIn('nova-anotacao')
                    void update($, typed, now => ({ ...now, note: value }))
                  }}
                  onSubmit={value => void writeNote(value)}
                />
              </Box>
            )}
            {(notes.length > 0 || v.editingNote !== undefined) && (
              <Box flexDirection="row" columnGap={1} rowGap={breath} flexWrap="wrap"alignItems="center" marginTop={breath}>
                {/* The line being changed is the one these two move */}
                {v.editingNote !== undefined && v.editingNote > 0 && (
                  <Button key="nota-subir" label={t('↑ Subir linha')} onPress={() => void moveNote(-1)} />
                )}
                {v.editingNote !== undefined && v.editingNote < notes.length - 1 && (
                  <Button key="nota-descer" label={t('↓ Descer linha')} onPress={() => void moveNote(1)} />
                )}
                {v.editingNote !== undefined && (
                  <Button
                    key="nota-cancelar"
                    label={t('Cancelar a alteração')}
                    onPress={() =>
                      void emptied('nova-anotacao').then(() => update($, view, now => ({ ...now, editingNote: undefined })))
                    }
                  />
                )}
                {notes.length > 0 && (
                  <Button
                    key="notas-copiar"
                    label={t('⧉ Copiar tudo')}
                    onPress={press => void $.ui.copy({ text: notes.join('\n'), surface: press.surface })}
                  />
                )}
                {notes.length > 0 && v.isClearingNotes !== true && (
                  <Button
                    key="notas-limpar"
                    label={t('✕ Limpar tudo')}
                    dimColor
                    onPress={() => void update($, view, now => ({ ...now, isClearingNotes: true }))}
                  />
                )}
                {v.isClearingNotes === true && <Text color={RED}>{t('Excluir todas as anotações?')}</Text>}
                {v.isClearingNotes === true && (
                  <Button key="notas-limpar-sim" label={t('Excluir')} variant="primary" onPress={() => void clearNotes()} />
                )}
                {v.isClearingNotes === true && (
                  <Button
                    key="notas-limpar-nao"
                    label={t('Manter')}
                    onPress={() => void update($, view, now => ({ ...now, isClearingNotes: undefined }))}
                  />
                )}
              </Box>
            )}
          </Box>,
        )}

        {contextCard}

        <Box flexDirection="row" columnGap={1} rowGap={breath} alignItems="center" flexWrap="wrap">
          {v.isReloading === true ? (
            <Text color={ACCENT}>{t('Lendo a conversa para preencher o painel. Leva alguns segundos.')}</Text>
          ) : (
            <Button
              key="recarregar"
              label={t('↻ Preencher o painel a partir da conversa')}
              dimColor
              onPress={() => void reload($).then(told => $.ui.toast(told, { timeoutMs: 8000 }))}
            />
          )}
          <Button
            key="copiar-painel"
            label={t('⧉ Copiar passos, decisões, pontos e termos')}
            dimColor
            onPress={press => void $.ui.copy({ text: asText(), surface: press.surface })}
          />
        </Box>
      </Box>
    )
  })
}
