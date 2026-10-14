# Changing and releasing a plugin of this repository

Three places, two gates. Nothing reaches the people who installed a plugin before it has run in the author's own sessions.

| Place | What it is | Who runs it |
|---|---|---|
| A branch in a worktree | Where a change is written and tested | Nobody's sessions |
| `main` on the author's machine | The folder the author's Claude Code loads the plugin from, through `CLAUDE_CODE_PLUGIN_DIRS` | Every session of the author |
| `main` on GitHub | The marketplace | Everyone who installed the plugin |

## 1. Write the change on a branch

```bash
git worktree add ../claude-code-mods-gbvdm-dev -b <branch>
```

Work in that folder. Add what changed under `## Unreleased` in `CHANGELOG.md`, in the words of the people who use the plugin.

## 2. Gate into main: the checks

```bash
node scripts/check.mjs
```

It validates the marketplace and each plugin, runs each plugin's tests, and checks that every Portuguese text of `painel-sessao` has an English version. A fix comes with a test that fails without it.

Then, in the folder of `main`:

```bash
git merge --ff-only <branch>
```

Sessions started after that load the change. A session that was already open may keep the version it loaded until it starts again. Look at the change on screen before going on. To take it back out of `main`: `git reset --hard <previous commit>` before the push.

## 3. Gate to GitHub: a new version

```bash
node scripts/release.mjs patch
```

`patch` for corrections, `minor` for something new, `major` for a change that asks something of the people who use the plugin. The script runs the checks again, raises `version` in `plugin.json`, dates the `Unreleased` section of `CHANGELOG.md`, commits and tags `painel-sessao--v<version>`. It does not push. To publish:

```bash
git push origin main --follow-tags
```

People who installed the plugin receive it when they run `claude plugin update painel-sessao@gbvdm-mods`, or by themselves if they turned on auto-update for the marketplace in `/plugin`. A push without a new `version` reaches nobody: Claude Code keeps the copy it has until the number changes.
