---
name: drive-chrome
description: Drive a real Chrome window over the Chrome DevTools Protocol, one step at a time, using role/name/text/selector locators instead of screenshots or coordinates. Use only when the user explicitly asks to open a site and interact with it while they watch.
disable-model-invocation: true
---

# drive-chrome

Open Chrome with the Chrome DevTools Protocol enabled and drive it interactively, one step
at a time, while the user watches.

The task is whatever the user wrote after invoking this skill. Read it fully before acting,
then start by getting to the landing page.

## Operating Rules

- **One step at a time.** Take one action, read the page structure back, say a sentence about
  what changed, then stop and wait for the user. Do not chain actions to "make progress faster."
  The one exception is when the user explicitly says to continue without stopping.
- **Structural driving, not visual.** Identify elements by role, accessible name, label, test
  id, and text content, the way Playwright locators do. No screenshots.
- **Write no artifacts.** The browser window is in front of the user. Do not write logs,
  snapshots, transcripts, or step files. The helper script already exists; do not create
  anything else on disk. Cookies and browser state are a byproduct of browsing and are fine;
  do not launch incognito or disable the cache.
- **The user is watching.** If something is ambiguous, unexpected, or looks wrong, stop and
  ask. Do not guess past a blocker.
- **Drive the page as a user would.** Click real elements, type into real fields, wait for real
  navigation. Do not call the site's backend directly with `fetch`, `XMLHttpRequest`, or a
  constructed HTTP request to shortcut the user interface. The Chrome DevTools Protocol
  WebSocket to `localhost` is the intended channel and is not what this restriction is about.
- **No browser automation frameworks.** No Playwright, Puppeteer, or Selenium. Interact with
  the Chrome DevTools Protocol directly, the same way those libraries do underneath.
- **Never enter credentials.** If a login, a two-factor prompt, or a CAPTCHA appears, stop and
  hand the browser back to the user.

## Setup

The helper is `cdp.mjs`, in the same directory as this file. You know that directory because
you just read this file from it; use that absolute path and quote it in every shell invocation.
Node 22 or newer is required (the helper uses the built-in `WebSocket` and `fetch`). If
`cdp.mjs` is missing, stop and tell the user rather than recreating it.

### 1. Launch Chrome

Run the launch script that sits beside this file. It starts Chrome with a dedicated user data
directory outside any cloud-synced folder, on port 9333, pointed at `about:blank`. Chrome
refuses `--remote-debugging-port` when it would join an already-running default-profile
instance, which is why the dedicated profile is mandatory; it also keeps the session out of the
user's real profile, cookies, and open tabs.

Windows (PowerShell):

```powershell
& "<skill directory>\launch-chrome.ps1"
```

macOS / Linux:

```bash
bash "<skill directory>/launch-chrome.sh"
```

Port 9333 is used rather than the conventional 9222 because many tools attach to 9222 by
default and target discovery would otherwise find the wrong page. If 9333 is taken, set the
`DRIVE_CHROME_PORT` environment variable before launching; the launch scripts and the helper
both read it.

### 2. Verify the endpoint

```powershell
Invoke-RestMethod -Uri "http://localhost:9333/json/version" -TimeoutSec 5
```

```bash
curl -s --max-time 5 http://localhost:9333/json/version
```

If this fails, Chrome did not start with the flag. Tell the user rather than retrying blindly.

### 3. Run a step

Pipe a JSON array of steps in. Nothing is saved.

```powershell
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$cdp = "<skill directory>\cdp.mjs"
@'
[{"method":"snapshot"}]
'@ | node $cdp
```

```bash
echo '[{"method":"snapshot"}]' | node "<skill directory>/cdp.mjs"
```

Set `$OutputEncoding` once per PowerShell session so non-ASCII text survives the pipe. Each
invocation opens a fresh connection, which is fine; the browser holds the state, not the
connection.

If the site opens a second tab, pass a substring of the URL you want as the first argument
(`node $cdp "checkout"`) so the helper drives the right one. With no argument it takes the
first page target.

Each step has a 30 second deadline. Read-only steps (`snapshot`, `waitFor`, raw `Runtime.*`,
`DOM.*`, `Page.*`) get one retry on timeout; input steps (`click`, `fill`, `press`, raw
`Input.*`) do not, because a retry could act twice. The run stops at the first step that
returns an error, so nothing after a failed step executes.

## Locating Elements

Run `snapshot` to get the page structure: URL, title, ready state, headings, iframe sources, and
every visible interactive element with its `tag`, `role`, `name`, `id`, `testId`, `type`,
`value`, and `disabled`. Empty fields are omitted. On a large page, add `"within": "<css
selector>"` to scope the snapshot to one region, or `"limit": N` to cap the element list;
`elementCount` always reports the full count.

Then act on an element with a **locator**. The helper resolves it at execution time, so a
stale snapshot or a shifted layout cannot send a click to the wrong place. Choose the locator
the way a Playwright locator would, in this order of preference:

1. `{ "testId": "..." }` when the site provides one.
2. `{ "role": "link", "name": "..." }`: role plus accessible name. Exact match first, then
   contains. Roles are the explicit `role` attribute or the implicit one (`a[href]` is `link`,
   `button` is `button`, text inputs are `textbox`, `select` is `combobox`, and so on).
3. `{ "text": "..." }`: visible text or label of an interactive element.
4. `{ "selector": "..." }`: a CSS selector, when nothing semantic is available.

Add `"nth": N` (zero-based) only when several elements legitimately match. If a locator
matches more than one element the helper stops and lists the candidates; narrow the locator
rather than reaching for `nth` by reflex. If it matches nothing, say so and snapshot again
rather than guessing a different one.

If you need richer semantics than the snapshot gives, call `Accessibility.getFullAXTree` for
the real accessibility tree.

For content inside an `iframe`, the page's execution context will not reach it. Use
`Page.getFrameTree` and evaluate against that frame's execution context, or attach to the
out-of-process iframe target listed by `http://localhost:9333/json`.

## Acting on the Page

Never compute or pass coordinates. The helper's verbs take a locator and do what Playwright
does underneath: re-resolve the element, scroll it into view, check that its center is really
the top-most hit target, and then dispatch real pointer events. If something is covering the
element (a cookie banner, an overlay), `click` falls back to `element.click()` and tells you
what was in the way via `coveredBy`; mention that when you report the step.

- **Navigate:** `{ "method": "Page.navigate", "params": { "url": "..." } }` followed by a
  `waitFor`, then `snapshot`.
- **Click:** `{ "method": "click", "locator": { ... } }`.
- **Fill a field:** `{ "method": "fill", "locator": { ... }, "text": "..." }`. Works on
  inputs, textareas, and rich-text (`contenteditable`) editors. Replaces existing content. Do
  not set `.value` through `Runtime.evaluate`; that skips the events the page listens for.
- **Press a key:** `{ "method": "press", "key": "Enter" }`. Known keys: Enter, Tab, Escape,
  Backspace, Delete, Space, ArrowUp/Down/Left/Right, Home, End, PageUp, PageDown.
- **Wait:** `{ "method": "waitFor", ... }` with one of `"urlIncludes"`, `"selector"`, or
  `"text"`, and an optional `"timeoutMs"` (default 10000). With no condition it waits for
  `document.readyState === "complete"`. Never assume a navigation or an asynchronous update
  finished instantly.
- **Select an option:** `click` the control to open it, `snapshot` to see the options that
  rendered, then `click` the one you want.
- **Scroll:** raw `Input.dispatchMouseEvent` with `type: "mouseWheel"`, `x`, `y`, and a
  `deltaY`. This is the one place coordinates are acceptable, because the target is the
  viewport, not an element.

Any other `method` is passed straight through to the Chrome DevTools Protocol as an escape
hatch. Reading page text with `Runtime.evaluate` is fine; acting on elements with it is not,
unless a helper verb has already failed and you have told the user why.

Example step, ready to pipe:

```json
[
  { "method": "click", "locator": { "role": "link", "name": "Newest" } },
  { "method": "waitFor", "urlIncludes": "tab=newest" },
  { "method": "snapshot", "within": "#questions" }
]
```

More examples live in the `examples/` folder beside this file.

## Known Limitations

- `fill` uses `Input.insertText`, which sets the value without per-character key events. Some
  autocomplete widgets only react to real keystrokes; if a suggestion list does not appear
  after `fill`, a single `press` of `Backspace` or `ArrowDown` usually wakes it up.
- `waitFor` with `"text"` reads `document.body.innerText`, so hidden text and text inside
  iframes do not count.
- Snapshot pierces open shadow roots but cannot see closed ones.

## Rhythm

After each action: one or two sentences on what you did and what changed, then what you propose
next, then stop and wait. The user can see the browser, so keep it short and do not narrate the
obvious.

## Cleanup

When the user says they are done, close Chrome through the protocol: `[{"method":"Browser.close"}]`
piped to the helper. Leave `cdp.mjs` where it is.
