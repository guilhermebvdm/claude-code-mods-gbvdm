# claude-code-mods-gbvdm

Mods for [Claude Code](https://code.claude.com/docs/en/plugins/mods/overview). A mod is a plugin that draws in Claude Code and reacts to its events.

Leia em português: [README.pt-BR.md](./README.pt-BR.md)

## painel-sessao: a panel for each session

A pane that stays beside the conversation and answers, at a glance, where the session is and what it waits for.

| Section | What it shows |
|---|---|
| Top | Whether Claude is answering or waiting for you, for how long, the current step and a progress bar |
| Your decisions | The questions Claude left for you to decide, until you answer them |
| Steps | The last two steps done, the current one marked, and the next ones |
| Next prompts | Prompts you queue while Claude works. Send one with a click, reorder them, or turn on auto-send |
| My last messages | Your last messages with their time. Click a time to scroll the conversation to that message |
| Notes | Important points and terms of the session, and your own free notes |
| Context and limits | How full the context window is, the limits of your plan, the last turn and compactions |
| Sessions (second view) | The other sessions of the same machine that run the panel: answering, waiting for you, ended |

Claude keeps the steps, decisions, terms and points up to date through a tool the mod registers. Everything else is yours: the queue, the notes, the buttons.

### What changes in your sessions

Three things happen without you asking, and two of them have an option to turn off:

- The pane opens by itself once in each new session (option `openOnStart`).
- Each answer ends with one line: the date, when you asked, when the answer ended and how long it took (option `answerLine`).
- A band above the prompt shows the current step and how many prompts are queued, while there is a current step or a queued prompt.

### Requirements

- Claude Code 2.1.287 or later in the terminal, or the Code tab of the Claude Desktop app.
- The pane is drawn in the terminal and in the Desktop app. In the VS Code extension and on the phone the commands work and nothing is drawn.

### Install

The panel comes in Portuguese unless you ask for English:

```bash
claude plugin marketplace add guilhermebvdm/claude-code-mods-gbvdm
```

```bash
claude plugin install painel-sessao@gbvdm-mods --config language=en
```

Start a new session, or run `/reload-plugins` in an open one. In a session that was already under way, run `/panel-reload` to fill the panel from the conversation.

### Options

| Option | Values | Default |
|---|---|---|
| `language` | `pt-BR` or `en` | `pt-BR` |
| `timeZone` | An IANA time zone name, such as `America/Sao_Paulo` or `Europe/Lisbon` | empty: the time zone of the system |
| `openOnStart` | `true` or `false` | `true` |
| `answerLine` | `true` or `false` | `true` |

Set them when you install, with one `--config` for each:

```bash
claude plugin install painel-sessao@gbvdm-mods --config language=en --config timeZone=Europe/Lisbon --config answerLine=false
```

Or later, in a session, from the plugin's row in `/plugin`.

### Commands

| Portuguese | English | What it does |
|---|---|---|
| `/painel` | `/panel` | Opens the pane |
| `/anotar <text>` | `/queue <text>` | Queues a prompt in Next prompts, without starting a turn |
| `/nota <text>` | `/note <text>` | Writes to your notes. Takes several lines |
| `/envio-automatico [ligar\|desligar]` | `/auto-send [on\|off]` | Turns auto-send on or off |
| `/painel-recarregar` | `/panel-reload` | Fills the panel from the conversation |

The mod registers and answers the names of the language in force. The names of the other language are not its commands.

### Auto-send

With auto-send on, the first queued prompt enters 5 seconds after each answer, and the pane shows the time and a Cancel button during those 5 seconds.

- With auto-send on and no answer running, a queued prompt is sent within 20 seconds, with no answer in between.
- It waits while a background agent runs and, for up to 3 minutes, while the app shows its survey about the session.
- A prompt that does not enter the conversation is sent again within 20 seconds. After 3 failures in a row auto-send turns itself off.
- An answer you interrupt, or one that ends with an error, turns it off, and the pane says why.
- It starts off in every new session.

### What this mod can reach

A mod is code that runs with your permissions. Read this before you install it, and check it yourself: clone the repository and run `claude plugin validate plugins/painel-sessao`, whose `hooks:` and `calls:` lines list the events the mod handles and what it asks Claude Code to do.

- **It reads your prompts.** It keeps the first 300 characters of each one to list them in the pane.
- **It sends prompts as you.** The Send button and auto-send submit a queued prompt as if you had typed it. Only prompts you queued are sent.
- **It approves its own tool.** Claude calls `mcp__painel-sessao__atualizar` without a permission prompt to write steps, decisions, terms and points to the panel. A call that turns auto-send on is not approved by the mod: you are asked, as for any tool. A deny rule of yours stays in force. The tool and its fields keep their Portuguese names in English too.
- **It adds a short text to your prompts.** When the panel changed since the last prompt, the next one carries its steps, decisions, terms and points, so Claude knows what the panel shows. That text also goes with the first prompt of a session and after each compaction. With a prompt sent from the pane, it goes as a separate row of the conversation that only the model reads.
- **It can spend your usage.** `/panel-reload` and the button "Fill the panel from the conversation" read the whole conversation and ask the model for a summary. Nothing else calls a model. The tool is in every request's tool list, and Claude calls it as the plan changes, which adds some tokens to ordinary turns.
- **It writes to the clipboard and to the prompt box when you click.** The copy buttons copy text, and "Move to the prompt box" puts a queued prompt in the prompt box.
- **It stores the panel on your machine.** One JSON file under `~/.claude/plugins/store/` holds, for each session: steps, decisions, terms and points; your queued prompts and the lines of one being written; your notes; the start of your messages and the ids of their rows in the conversation; the session's title or the name of its folder; what auto-send last did, with the first 60 characters of each prompt it sent; and which buttons of the pane were last pressed. A session's entry is deleted after 30 days with no activity, and the file keeps the entries of the 40 other sessions that saved last.

It makes no network request, starts no process, and reads or writes no file other than that store.

### Known limits

- A queued prompt has at most 4000 characters, the queue 30 prompts, and your notes 200 lines. What goes beyond is refused with a notice, never cut. One exception: a line of your notes longer than 1000 characters is cut at 1000.
- The one-line field of the Desktop app has a width the app sets. The button "Try the wide multi-line box" swaps it for a box as wide as the pane. That box was not checked in the Desktop app.
- The Desktop app replaces the pane's content each time it is drawn again, so a selection made with the mouse does not last. The copy buttons are there for that.
- The mod was written and used on Windows, in the Desktop app, in Portuguese. It was not run on macOS or Linux, its pane was never seen in a terminal, and its English version was checked by automated tests only. The tests cover the terminal and Desktop surfaces without drawing them.
- This plugin and a copy of it loaded with `--plugin-dir` or `CLAUDE_CODE_PLUGIN_DIRS` have the same name: with both, the installed one does not load.

### Development

```bash
claude plugin validate plugins/painel-sessao
```

```bash
claude plugin test plugins/painel-sessao
```

The tests run with the times in the zone of São Paulo, whatever the zone of the machine. `plugins/painel-sessao/tsconfig.json` extends the type declarations Claude Code writes beside a plugin when it loads it (`.claude-plugin/types/`, not in the repository): load the plugin once before running `tsc`. `plugins/painel-sessao/.diagramas.md` has sequence diagrams of the parts with the most logic (in Portuguese).

## License

[MIT](./LICENSE)
