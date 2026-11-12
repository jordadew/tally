---
name: tally-setup
description: Guided setup for Tally, the terminal scoreboard. Finds out what the person wants to be pushed toward, where their data already lives, which numbers are worth showing, then prototypes layouts and writes the config. Use when someone says "set up tally", "/tally-setup", "configure tally", "what should my tally show", or wants to add, remove or rethink metrics or layout in an existing Tally config.
---

# Tally setup

Tally counts what already exists in someone's data (notes, files, repos, APIs, any command) and shows it in one terminal panel. It never stores or edits data. Your job: help them choose a **few numbers that change what they do**, wire each to a source they already have, and pick a layout they like. Then write `~/.config/tally/config.json` (or the path from `$TALLY_CONFIG`).

Read `examples/creator.json` in the Tally repo before writing any config: it shows every source type, measure, tone rule and layout in use. The config schema is in the README.

## How to run it

- One question at a time. Lead with a concrete proposal they can accept or change, not an open list of questions.
- Plain words. No internal terms ("metric", "source", "measure") unless they use them first; say "number" and "where it comes from".
- Never print secrets. API keys go in environment variables or an env file referenced by `envFile`, never in the config.
- Every number you propose must point at a source you have actually checked exists.

## 1. The job

Ask what Tally should push them toward, in one sentence. Examples: "earn before I build", "post every day", "ship something daily", "train four times a week". Everything later is judged against this. If they have several, rank them; the first one gets the top section.

## 2. Areas

Propose 2–4 areas from the job (money, content, sales, code, habits, writing, or their own). More than four makes the panel noise.

## 3. Where the data lives

For each area, ask where it is now, and look: list likely folders, check installed CLIs (`which gh stripe notion ...`), look for app exports. Match it to a source type:

| Data | Source |
|---|---|
| Notes, one per item, with frontmatter (Obsidian, any markdown) | `folder` with `date`, `where` |
| One file with a dated line per item (CSV, a markdown log) | `file` with a regex and a `(?<date>…)` group |
| An app's JSON export | `json` |
| An API (Stripe, Airtable, Supabase, a CRM) | `http`, keys via `${ENV_VAR}` |
| A repo | `git` |
| Anything with a CLI | `command` (prints a number, lines, or JSON) |

**No data anywhere?** Say so plainly: Tally only counts. Suggest the smallest home that fits how they already work, usually a markdown log (`- 2026-11-12 what happened`, one line per item) in a folder they already open, or a field they could add to notes they already keep. Offer to create the empty file. Never suggest Tally itself as the place to enter data.

## 4. Choose the numbers

Brainstorm candidates per area, then score each one in a table against four tests:

1. **Can they move it today** by their own action? (Not views, followers, inbound leads.)
2. **Does it point at an action?** (A running total since forever doesn't.)
3. **Is the data reliable?** Check the actual field or file; say if it's partial (e.g. "only 16 of 156 deals have a price").
4. **Not shown elsewhere** on the panel already.

Keep the ones that pass, at most four per section, and explain each cut in one line. Patterns that work:

- **Recency beats totals.** "Days since last post" or "idle: days since last reply" nudges harder than "posts this year".
- **Match granularity to the work.** Fast actions (replies, workouts) are counted today; slow outputs (videos, features) work better as this week, with today alongside if they tend to leave things until late.
- **A carrot.** Money waiting to be won ("on table") motivates more than money already counted.
- **One target**, if any: a monthly or weekly goal on a progress bar. Ask for the real number; never invent one.
- **A next action.** A list section that names the specific item to do next (`measure: "first"` with a `sort`) beats a vague "do content".
- Mark money and client names `sensitive: true` so `h` hides them when screen sharing.

Confirm the final list in words before writing anything.

## 5. Write and check

Write the config. Run `tally check` and fix every error before going on. Show the numbers next to where they came from so the person can confirm each matches what their app shows; if one differs, trace why before moving on (a different filter, window or definition).

## 6. Layout

Run `tally preview` (with `--sample` if the real numbers are all zero) and walk them through it: Tab picks a section, ↑ ↓ cycles its layout (strip, rows, pair, progress, list), `w` saves. Suggest a starting point:

- 2–5 numbers of the same kind → **strip**
- today beside this week → **pair** (`ticks: true` on the today side)
- one number against a target → **progress**
- next actions → **list**
- numbers that need a detail line → **rows**

If they want something the built-in layouts can't show, say so plainly rather than forcing it.

## 7. Open it

`tally` opens the panel (`q` closes, `h` hides sensitive numbers). Offer the integrations in the README: a popup key in herdr or tmux, and `tally --daily` in a shell or Claude Code startup hook so it opens once a day.

## Changing an existing setup

Read the current config first. Re-run steps 4–6 for whatever they want changed; keep everything else byte for byte.
