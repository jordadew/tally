# Tally

**A terminal scoreboard for the numbers that move you.** Tally counts what's already in your data (notes, log files, repos, APIs, any command) and shows it in one panel: what you've earned this month, what you made today, how long since you last posted, what to do next.

It never stores or edits anything. It only counts.

```
        ████████╗ █████╗ ██╗     ██╗     ██╗   ██╗
        ╚══██╔══╝██╔══██╗██║     ██║     ╚██╗ ██╔╝
           ██║   ███████║██║     ██║      ╚████╔╝
           ██║   ██╔══██║██║     ██║       ╚██╔╝
           ██║   ██║  ██║███████╗███████╗   ██║
           ╚═╝   ╚═╝  ╚═╝╚══════╝╚══════╝   ╚═╝
                   thursday 12 november
  ╭─ Earned In November ───────────────────────────────╮
  │ $735 of $3,000                                 24% │
  │ ████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │
  ╰────────────────────────────────────────────────────╯
  ╭─ ▶ Today ─────────╮ ╭─ ▶ This Week ────────────────╮
  │ ✓ planned       1 │ │ planned                    3 │
  │ ✓ filmed        1 │ │ filmed                     1 │
  │ ○ posted        0 │ │ posted                     0 │
  │                   │ │ since post                4d │
  ╰───────────────────╯ ╰──────────────────────────────╯
  ╭─ Deals ────────────────────────────────────────────╮
  │      3         $1,350         1          today     │
  │     open      on table    sent today     idle      │
  ╰────────────────────────────────────────────────────╯
  ╭─ Next ─────────────────────────────────────────────╮
  │ → Finish Morning routine                           │
  │ → Reply to Northwind                               │
  ╰────────────────────────────────────────────────────╯
  q close · h hide
```

Built for people who live in the terminal and keep drifting into the wrong work. Put the numbers that matter where you start your day.

- **Your data, your sources.** Folders of markdown notes (Obsidian works), CSV or markdown logs, JSON exports, any JSON API, git repos, or any command that prints a number.
- **Opens instantly.** The last result shows at once; fresh numbers replace it as they load.
- **`h` hides money and names** for screen sharing or filming. It's remembered between opens.
- **No dependencies.** Node 20 or newer.

## Install

```sh
git clone https://github.com/jordadew/tally.git
cd tally && npm link        # puts `tally` on your PATH
```

Try it on made-up data first:

```sh
node examples/demo/make.mjs
tally --config examples/creator.json
```

## Set up

Two ways to make your own `~/.config/tally/config.json`:

**Guided, in Claude Code (recommended).** It works out what you want to be pushed toward, finds where your data lives, helps pick the few numbers worth showing, and lets you try layouts before saving.

```sh
mkdir -p ~/.claude/skills && cp -r skills/tally-setup ~/.claude/skills/
```

Then in Claude Code: `/tally-setup`.

**Quick, in the terminal:** `tally init`. It asks what to tally and where each thing lives, shows a live count as you answer, then writes the config.

**No data anywhere yet?** Tally only counts, so it needs a home for the data. The simplest is a markdown log you add a line to, which `tally init` can create for you:

```
- 2026-11-12 Replied to Northwind
- 2026-11-12 650 Brand B
```

## Commands

| Command | Does |
|---|---|
| `tally` | Open the panel. `q` or `Esc` closes, `h` hides sensitive numbers |
| `tally --once` | Print the panel once and exit |
| `tally --daily` | Open only if it hasn't been shown today (for startup hooks) |
| `tally check` | Read every number and print its value, or the error, with timing |
| `tally preview` | Try layouts: `Tab` picks a section, `↑` `↓` changes its layout, `w` saves (old config kept as `.bak`). `--sample` uses made-up numbers |
| `tally init` | Set up a config with questions |

Options: `--config <path>` (or `$TALLY_CONFIG`), `--close-key <letter>` (ctrl+letter also closes).

## Config

```json
{
  "title": "TALLY",
  "currency": "$",
  "weekStart": "monday",
  "sections": [ { "title": "Earned in {month}", "layout": "progress", "metric": "earned", "target": 3000 } ],
  "metrics": {
    "earned": {
      "label": "earned", "format": "money", "sensitive": true,
      "source": { "type": "file", "path": "~/notes/income.csv", "pattern": "^(?<date>[\\d-]+),[^,]*,(?<amount>[\\d.]+)$", "window": "month", "measure": "sum", "field": "amount" }
    }
  }
}
```

Paths can start with `~`; relative paths are relative to the config file. [`examples/creator.json`](examples/creator.json) uses every feature.

### Top level

| Key | Default | |
|---|---|---|
| `title` | `"TALLY"` | Any other text shows as a plain heading instead of the banner |
| `banner` | | Your own ASCII art as an array of lines, or `false` for none |
| `currency` | `"$"` | For `money` numbers |
| `weekStart` | `"monday"` | Or `"sunday"` |
| `width` | `54` | Panel width in characters |
| `locale` | `"en-GB"` | Number and date formatting |

### Sections

Every section has a `layout`. Titles can use `{month}`, `{weekday}` and `{date}`.

| Layout | Keys | Shows |
|---|---|---|
| `strip` | `title`, `metrics` | 2–5 numbers in a row, label under each |
| `rows` | `title`, `metrics` | One per line, with each metric's `detail` on the right |
| `pair` | `left`, `right`: `{ title, metrics, ticks }`, optional `ratio` | Two boxes side by side, e.g. today beside this week. `ticks: true` adds ✓ / ○ |
| `progress` | `title`, `metric`, `target` | One number against a target, with a bar |
| `list` | `title`, `metrics` | Next actions from text values (see `template`, `empty`) |

### Metrics

| Key | |
|---|---|
| `source` | Where the number comes from (below). Required |
| `label` | Shown under or beside the number |
| `format` | `number` (default), `money`, `days` (`4d`, `today`), `percent` |
| `tone` | Colour rules, checked red, then amber, then green: `{ "red": ">= 5", "amber": ">= 2", "green": "> 0" }` |
| `sensitive` | `true` → hidden by `h` |
| `detail` | Extra text on the right in `rows` |
| `template`, `empty`, `max` | For `list`: `"Reply to {value}"`, text when there's nothing, how many lines |

### Sources

| `type` | Keys | Reads |
|---|---|---|
| `folder` | `path`, `ext` (`.md`) | One row per note, from its frontmatter (plus `title` from the filename) |
| `file` | `path`, `pattern`, `flags` | One row per line matching the regex. Named groups become fields; `(?<date>…)` makes windows work |
| `json` | `path`, `key` | A value at `key` (e.g. `deals[0].offer`), or an array to count |
| `http` | `url`, `headers`, `key`, `envFile`, `timeout` | A JSON API. Use `${ENV_VAR}` in `url` and `headers`; keys never go in the config |
| `git` | `repo`, `author`, `path` | One row per commit |
| `command` | `run`, `parse` (`number`, `lines`, `text`, `json`), `key`, `envFile`, `timeout` | Anything with a CLI |

Rows from `folder`, `file`, `json`, `http` and `git` are narrowed and measured with:

| Key | |
|---|---|
| `where` | Keep rows whose field equals a value, or any of a list: `{ "status": ["open", "pending"] }` |
| `date` | Which field holds the date (`mtime` = file changed, for `folder`) |
| `window` | `today`, `week`, `month` (needs `date`) |
| `measure` | `count` (default), `sum` (with `field`), `days_since`, `latest`, `first` (with `field`, `sort`) |
| `sort` | For `first`: `{ "field": "status", "order": "desc" }`, or `"rank": ["filmed", "planned"]` for a custom order |

## Put it where you work

**tmux:** a popup on `prefix T`:

```tmux
bind T display-popup -E -w 62 -h 36 "tally --close-key t"
```

**[herdr](https://herdr.dev):**

```sh
herdr plugin install jordadew/tally/herdr
```

then bind a key in `~/.config/herdr/config.toml`:

```toml
[[keys.command]]
key = "prefix+$"          # or "ctrl+t" (that takes ctrl+t from every pane)
type = "plugin_action"
command = "tally.open"
description = "Tally"
```

**Once a day, automatically:** add `tally --daily` to your `~/.zshrc` or `~/.bashrc` (inside an interactive-shell check), or run it from a Claude Code `SessionStart` hook so it appears the first time you start working. In herdr, have the hook run `herdr plugin pane open --plugin tally --entrypoint panel` instead, after checking that `$HERDR_PANE_ID` is set.

## Privacy

Tally reads local files and the sources you configure, and nothing else. It sends nothing anywhere. The last result is kept in `~/.local/state/tally/` so the next open is instant.

## License

MIT
