/** One prompt the user sent, with the time it was submitted (epoch ms). */
export type Ask = {
  /** When the message was sent (epoch ms); 0 for a message read back from the conversation, whose time is not known. */
  at: number
  text: string
  /** The id of the row of the conversation that holds the message, set when the message enters the conversation. */
  row?: string
  /** True from the moment the message is sent until it enters the conversation and gets its row. */
  isEntering?: boolean
}

export type StepStatus = 'done' | 'current' | 'next'

/** One step of the session's plan, as the model reported it. */
export type Step = { title: string; status: StepStatus }

/** An acronym, term or concept the user needs to remember in this session. */
export type Term = { term: string; meaning: string }

/** A prompt the user wrote down to send later. */
export type Queued = {
  id: number
  text: string
  /** True from the click on "Enviar" until the prompt's turn starts: a prompt sent during an answer waits for it to end. */
  sending?: boolean
}

export type Board = {
  asks: Ask[]
  steps: Step[]
  terms: Term[]
  points: string[]
  queue: Queued[]
  /** The lines already kept of the prompt the user is writing in the panel; absent in a board saved before 02/10/2026. */
  draft?: string[]
  /** The user's free notes of this session, one entry for each line; absent in a board saved before 06/10/2026. */
  notes?: string[]
  /** True while the automatic sending is on: after each answer, the first noted prompt is sent. Off in a new session. */
  auto?: boolean
  /** The automatic sending that is waiting: which noted prompt, and when it enters (epoch ms). */
  pending?: { id: number; at: number }
  /**
   * What the automatic sending waits for before it starts the 5 seconds: an agent that is still running, or the
   * app's survey about the session. A board saved before 07/10/2026 holds `true`, which meant the agent.
   */
  hold?: 'agente' | 'pesquisa' | true
  /** Why and when the automatic sending turned itself off, until the user turns it on again. */
  stopped?: { at: number; why: string }
  /** The last things the automatic sending did, the most recent last; the panel shows the last one. */
  autoLog?: { at: number; what: string }[]
  /** The sections of the panel the user closed, by id. Not read since 07/10/2026, when `open` replaced it. */
  collapsed?: string[]
  /**
   * True while the user tries, on the desktop app, the text box of several lines in place of the app's own
   * field of one line. Off by itself when the app fails to draw the box.
   */
  wideBox?: boolean
  /** The sections of the panel that are open, by id; absent until the user opens or closes one. */
  open?: string[]
  /** The questions the model left for the user to decide, the full list as the model last sent it. */
  decisions?: string[]
  /** True from the start of a turn of the main conversation until its end. */
  working?: boolean
  /** When the turn under way started, and when the last one ended (epoch ms). */
  turnStartedAt?: number
  turnEndedAt?: number
  /** What the list of sessions calls this one: the session's title in the app, or the folder it runs in. */
  name?: string
  /** True after the session ended, until it starts again. */
  ended?: boolean
  /** When the board was last written to the store (epoch ms); 0 before the first write. */
  savedAt: number
}

/** One limit of the plan: how much of its window is used and when the window resets (ISO 8601). */
export type Limit = { kind: string; percent: number; resetsAt?: string }

/** The token counts of one turn, as the API reported them. */
export type TurnTokens = { input: number; output: number; cacheRead: number; cacheWrite: number }

/** What the panel shows about the context window, the plan's limits, the last turn and compactions. */
export type Usage = {
  /** Input tokens the last response was answered over; absent before the first response. */
  tokens?: number
  /** The context window of the session's model, in tokens; 0 before the first measurement. */
  window: number
  percent?: number
  limits: Limit[]
  lastTurn?: TurnTokens
  /** How many times the conversation was compacted since the panel was turned on. */
  compactions: number
  lastCompaction?: { at: number; before?: number; after?: number }
}

/** What the user chose to see in the panel: how many of their messages, and which noted prompts whole (by id). */
export type View = {
  shownAsks: number
  expanded: number[]
  /** True once the pane opened by itself in this session, so a reload does not open again a pane the user closed. */
  hasOpened?: boolean
  /** True while the panel is being filled from the conversation, so a second request does not start. */
  isReloading?: boolean
  /** The line of the notes being changed in the field: Enter replaces it instead of adding a line. */
  editingNote?: number
  /** True after the first click on "Limpar tudo" of the notes, until the user confirms or cancels. */
  isClearingNotes?: boolean
  /** Counted up to have the field of the notes drawn again, empty, when nothing else changed. */
  fieldTick?: number
  /** Counted up once a minute, so "há 12 min" and the list of sessions stay current. */
  minuteTick?: number
  /** The noted prompt whose other actions (move up, move down, put in the box, copy, delete) are shown, by id. */
  menu?: number
  /** Which of the two views the pane shows; absent means this session's. */
  tab?: 'sessao' | 'sessoes'
  /** The sessions of this machine that run the mod, as last read from the store. */
  sessions?: SessionRow[]
}

/** One session in the list of sessions: what its own panel last saved. */
export type SessionRow = {
  id: string
  /** True for the session that draws the list. */
  isThis: boolean
  name: string
  state: 'respondendo' | 'aguardando' | 'encerrada' | 'parada' | 'nova'
  /** When the state began, or when the session last saved (epoch ms). */
  at: number
  stepsDone: number
  stepsTotal: number
  step: string
  decisions: number
  queued: number
}

declare module 'claude-code' {
  interface PluginState {
    'painel-sessao': { board: Board; usage: Usage; view: View; typed: { prompt: string; note: string } }
  }
}
