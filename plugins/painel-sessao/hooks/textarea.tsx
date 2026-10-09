import type { ClientKeyEvent, ClientModule } from 'claude-code'

type Props = { placeholder: string; hint: string; accent: string; minRows: number }
type State = { text: string; caret: number; isActive: boolean }
type Row = { start: number; end: number }

const START: State = { text: '', caret: 0, isActive: false }

// Keys that arrive by name and type nothing
const NAMED = new Set([
  'tab',
  'escape',
  'insert',
  'pageup',
  'pagedown',
  'f1',
  'f2',
  'f3',
  'f4',
  'f5',
  'f6',
  'f7',
  'f8',
  'f9',
  'f10',
  'f11',
  'f12',
])

// The text as the rows the box shows: each line of the text, cut every `width` characters
function rowsOf(text: string, width: number): Row[] {
  const rows: Row[] = []
  let lineStart = 0
  for (const line of text.split('\n')) {
    const lineEnd = lineStart + line.length
    let at = lineStart
    do {
      const end = Math.min(at + width, lineEnd)
      rows.push({ start: at, end })
      at = end
    } while (at < lineEnd)
    lineStart = lineEnd + 1
  }
  return rows
}

// The row the caret is on: the last row that starts at or before it
function rowOf(rows: Row[], caret: number): number {
  let found = 0
  rows.forEach((row, i) => {
    if (row.start <= caret) found = i
  })
  return found
}

// The longest text the box holds: the same limit the panel gives a noted prompt
const LIMIT = 4000

function typed(state: State, piece: string): State {
  if (state.text.length + piece.length > LIMIT) return state

  return {
    ...state,
    text: state.text.slice(0, state.caret) + piece + state.text.slice(state.caret),
    caret: state.caret + piece.length,
  }
}

// The caret one row up or down, in the same column where the row is long enough
function moved(state: State, width: number, by: number): State {
  const rows = rowsOf(state.text, width)
  const from = rowOf(rows, state.caret)
  const target = rows[from + by]
  const here = rows[from]
  if (target === undefined || here === undefined) return state

  return { ...state, caret: Math.min(target.start + (state.caret - here.start), target.end) }
}

// What one key does to the text. `null` means Enter alone: the text is ready to be noted.
function afterKey(state: State, event: ClientKeyEvent, width: number): State | null {
  const { key } = event
  const hasModifier = event.ctrl === true || event.shift === true || event.meta === true

  if (key === 'return' || key === 'enter') return hasModifier ? typed(state, '\n') : null
  if (key === 'backspace') {
    if (state.caret === 0) return state
    return {
      ...state,
      text: state.text.slice(0, state.caret - 1) + state.text.slice(state.caret),
      caret: state.caret - 1,
    }
  }
  if (key === 'delete') {
    return { ...state, text: state.text.slice(0, state.caret) + state.text.slice(state.caret + 1) }
  }
  if (key === 'left') return { ...state, caret: Math.max(0, state.caret - 1) }
  if (key === 'right') return { ...state, caret: Math.min(state.text.length, state.caret + 1) }
  if (key === 'up') return moved(state, width, -1)
  if (key === 'down') return moved(state, width, 1)
  if (key === 'home' || key === 'end') {
    const rows = rowsOf(state.text, width)
    const row = rows[rowOf(rows, state.caret)]
    if (row === undefined) return state
    return { ...state, caret: key === 'home' ? row.start : row.end }
  }
  if (key === 'space') return typed(state, ' ')
  // Ctrl or Meta with a letter is a shortcut, not typing
  if (event.ctrl === true || event.meta === true) return state
  // Any other key of more than one character is the name of a key that types nothing
  if (NAMED.has(key) || [...key].length !== 1) return state

  return typed(state, key)
}

// A text box of several rows: Enter notes the text, Enter with Ctrl, Shift or both breaks the line
const TextArea: ClientModule<Props, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  const state = surface.state ?? START
  // The box's body: the region less the frame, the padding and one cell for the caret at a row's end
  const width = Math.max(8, (surface.columns || 44) - 5)

  surface.onPointer(event => {
    const now = surface.state ?? START
    if (event.type === 'down' && !now.isActive) surface.setState({ ...now, isActive: true })
  })

  surface.onKey(event => {
    const now = { ...(surface.state ?? START), isActive: true }
    const next = afterKey(now, event, width)
    if (next !== null) {
      surface.setState(next)
      return
    }
    if (now.text.trim() === '') return
    surface.post({ kind: 'submit', text: now.text })
    surface.setState({ ...START, isActive: true })
  })

  const rows = rowsOf(state.text, width)
  const caretRow = rowOf(rows, state.caret)
  const blank = Math.max(0, props.minRows - rows.length)

  return (
    <Box flexDirection="column">
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={state.isActive ? props.accent : undefined}
        borderDimColor={!state.isActive}
        paddingX={1}
      >
        {state.text === '' && !state.isActive && (
          <Text dimColor italic>
            {props.placeholder}
          </Text>
        )}
        {(state.text !== '' || state.isActive) &&
          rows.map((row, i) => {
            const line = state.text.slice(row.start, row.end)
            if (i !== caretRow || !state.isActive) return <Text>{line === '' ? ' ' : line}</Text>
            const column = state.caret - row.start

            return (
              <Box flexDirection="row">
                <Text>{line.slice(0, column)}</Text>
                <Text inverse>{line.slice(column, column + 1) || ' '}</Text>
                <Text>{line.slice(column + 1)}</Text>
              </Box>
            )
          })}
        {Array.from({ length: state.text === '' && !state.isActive ? Math.max(0, blank - 1) : blank }, () => (
          <Text> </Text>
        ))}
      </Box>
      <Text dimColor>{props.hint}</Text>
    </Box>
  )
}

export default TextArea
