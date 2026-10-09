# Sidekick

A toolbox of agent skills that travels with you. Clone it once, point your editor's agent at
it, and every skill inside becomes callable from any project you work on, without touching
those projects.

Works with **Cursor** and **Claude Code**. Both read the same `SKILL.md` format; Sidekick lays
the files out so each tool finds them where it expects.

## Skills

| Skill | What it does |
|---|---|
| [`drive-chrome`](.cursor/skills/drive-chrome/SKILL.md) | Drives a real Chrome window over the Chrome DevTools Protocol, one step at a time, using Playwright-style locators (role, name, text, selector) instead of screenshots or coordinates. No frameworks, nothing written to disk. |

## Install

### Cursor

1. Clone this repository anywhere:
   ```
   git clone https://github.com/travisjj/sidekick.git
   ```
2. In Cursor: **File > Add Folder to Workspace**, pick the `sidekick` folder.
3. Open a new chat. Type `/drive-chrome` followed by what you want done, or just ask.

That is the whole install. Cursor loads `.cursor/skills/`, `.cursor/commands/`, and `AGENTS.md`
from every folder in a multi-root workspace, so Sidekick's skills are available in chats about
any other folder in that workspace. Save the workspace (**File > Save Workspace As**) and
Sidekick comes back every time you open it.

### Claude Code

Claude Code loads skills from the directory you start it in and from any directory added with
`--add-dir`. Two ways to use Sidekick:

**Per session.** Start Claude Code with Sidekick added:
```
claude --add-dir /path/to/sidekick
```
or, inside a running session, `/add-dir /path/to/sidekick`. The skills under
`sidekick/.claude/skills/` are picked up for that session.

**Always on.** Link the skills into your personal skills folder once:
```powershell
# Windows
.\scripts\install-claude.ps1
```
```bash
# macOS / Linux
./scripts/install-claude.sh
```
This creates a link for each skill in `~/.claude/skills/`, so the skills are present in every
project. They are links, not copies: `git pull` in Sidekick updates them, and deleting the links
uninstalls. Rerun the script after adding a new skill.

### Requirements

- Node 22 or newer for `drive-chrome` (it uses the built-in `WebSocket` and `fetch`).
- Google Chrome for `drive-chrome`.
- Nothing else. There are no dependencies to install.

## Using drive-chrome

Ask the agent to open a site and do something while you watch:

> /drive-chrome go to Hacker News and open the top story's comments

The agent launches a separate Chrome (its own profile, port 9333, your real browser is
untouched), reads the page structure, and acts one step at a time, reporting after each. It
stops at logins, two-factor prompts, and CAPTCHAs and hands the window back to you.

Port 9333 is used instead of the conventional 9222 because many tools attach to 9222 by
default. Set `DRIVE_CHROME_PORT` if you need a different one; the launch scripts and the helper
both honour it.

The step and locator reference is in the [skill file](.cursor/skills/drive-chrome/SKILL.md);
ready-to-pipe examples are in [`examples/`](.cursor/skills/drive-chrome/examples/).

## Adding your own skill

```powershell
.\scripts\new-skill.ps1 -Name my-skill -Description "When the agent should use it."
```
```bash
./scripts/new-skill.sh my-skill "When the agent should use it."
```

This creates `.cursor/skills/my-skill/SKILL.md` (the one you edit) and a one-paragraph stub at
`.claude/skills/my-skill/SKILL.md` that points to it. Put helper scripts and reference files
beside the canonical `SKILL.md` and refer to them as "beside this file"; never write an absolute
path, so the skill works on every machine that clones the repo.

## Layout

```
sidekick/
├── .cursor/
│   ├── skills/<name>/      canonical skills: SKILL.md plus any helper files (Cursor reads these)
│   └── commands/<name>.md  one-line shims so /name works as a slash command in Cursor
├── .claude/
│   └── skills/<name>/      stubs pointing at the canonical skill (Claude Code reads these)
├── scripts/
│   ├── install-claude.*    link canonical skills into ~/.claude/skills/
│   └── new-skill.*         scaffold a canonical skill and its Claude stub together
├── AGENTS.md               tells agents this folder is a toolbox, never a task target
├── LICENSE                 MIT
└── README.md
```

## Design rules

- **Isolated.** Skills act on the outside world (a browser, a service, another repository),
  never on the Sidekick folder or on the other folders in your workspace. `AGENTS.md` says so to
  every agent that loads it. Anything a skill must write goes under `.scratch/`, which is
  gitignored.
- **Portable.** No absolute paths anywhere. Every skill references its files relative to its
  own directory. Clone it on any machine and it works.
- **One source of truth.** Each skill exists once, under `.cursor/skills/`. The `.claude/skills/`
  entries are stubs; the install script links the canonical directory, not the stub.

## License

MIT. Copyright (c) 2026 travisjj.
