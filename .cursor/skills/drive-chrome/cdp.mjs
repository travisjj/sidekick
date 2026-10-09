// drive-chrome helper.
//
// Usage:
//   <json> | node cdp.mjs [targetUrlSubstring]
//
// Reads an array of steps from standard input. Each step is either a raw Chrome
// DevTools Protocol call:
//
//   { "method": "Page.navigate", "params": { "url": "https://example.com" } }
//
// or one of the locator-based pseudo-methods below, which resolve elements at
// execution time the way Playwright locators do, so the caller never handles
// coordinates:
//
//   { "method": "snapshot", "within": "<css selector>", "limit": 200 }
//   { "method": "click",   "locator": { ... } }
//   { "method": "fill",    "locator": { ... }, "text": "..." }
//   { "method": "press",   "key": "Enter" }
//   { "method": "waitFor", "selector": "...", "urlIncludes": "...", "text": "...", "timeoutMs": 10000 }
//
// A locator is one of:
//   { "testId": "submit" }
//   { "role": "link", "name": "Sign in" }        name matches exactly, then by contains
//   { "text": "Practical limit for ..." }        exact trimmed text, then by contains
//   { "selector": "a.question-hyperlink" }
// plus an optional "nth" (zero-based) to disambiguate when several match.
//
// Every step has a 30 second deadline. Steps that only read (snapshot, waitFor,
// raw Runtime/DOM/Page calls) get one retry on timeout. Steps that dispatch input
// (click, fill, press, raw Input.*) do not, because a retry could act twice.
//
// The optional argument selects which tab to drive when more than one is open;
// it is matched as a substring of the tab URL. With no argument the first page
// target is used.
//
// Chrome must be listening on the DevTools port. The default is 9333 rather than
// the conventional 9222 so this never collides with the many tools that attach to
// 9222 by default. Override with the DRIVE_CHROME_PORT environment variable; the
// launch scripts beside this file honour the same variable.
//
// Nothing is written to disk.

const port = process.env.DRIVE_CHROME_PORT ?? "9333";
const endpoint = `http://localhost:${port}`;
const stepDeadlineMs = 30000;
const targetUrlSubstring = process.argv[2] ?? null;

const steps = JSON.parse(await new Promise((resolve) => {
  let buffer = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => { buffer += chunk; });
  process.stdin.on("end", () => resolve(buffer));
}));

let targets;
try {
  targets = await (await fetch(`${endpoint}/json`)).json();
} catch {
  console.error(`Chrome is not listening on ${endpoint}. Launch it with --remote-debugging-port=${port} first (see launch-chrome.ps1 / launch-chrome.sh).`);
  process.exit(1);
}
const pages = targets.filter((target) => target.type === "page");
const page = targetUrlSubstring
  ? pages.find((candidate) => candidate.url.includes(targetUrlSubstring))
  : pages[0];

if (!page) {
  console.error(targetUrlSubstring
    ? `No page target whose URL contains "${targetUrlSubstring}". Open tabs:\n` + pages.map((candidate) => "  " + candidate.url).join("\n")
    : "No page target found.");
  process.exit(1);
}

const socket = new WebSocket(page.webSocketDebuggerUrl);
const pending = new Map();
let nextId = 1;

socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  const resolver = pending.get(message.id);
  if (resolver) { pending.delete(message.id); resolver(message); }
});

function send(method, params = {}) {
  const id = nextId++;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve) => pending.set(id, resolve));
}

socket.addEventListener("error", (event) => {
  console.error("WebSocket error:", event.message ?? event);
  process.exit(1);
});

// Evaluates an expression in the page and returns its JSON value, or throws with
// the page-side error message.
async function evaluate(expression) {
  const response = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (response.error) throw new Error(response.error.message);
  if (response.result.exceptionDetails) {
    const details = response.result.exceptionDetails;
    throw new Error(details.exception?.description ?? details.text);
  }
  return response.result.result.value;
}

// Page-side library. Installed once per connection under window.__driveChrome so
// locator resolution and snapshotting share one implementation.
const pageLibrary = `(() => {
  if (window.__driveChrome) return "present";
  const interactiveSelector = "a,button,input,select,textarea,summary,[role],[tabindex],[onclick],[contenteditable]";

  function implicitRole(element) {
    const tag = element.tagName.toLowerCase();
    if (tag === "a") return element.hasAttribute("href") ? "link" : null;
    if (tag === "button" || tag === "summary") return "button";
    if (tag === "select") return "combobox";
    if (tag === "textarea") return "textbox";
    if (/^h[1-6]$/.test(tag)) return "heading";
    if (tag === "input") {
      const type = (element.getAttribute("type") || "text").toLowerCase();
      if (type === "checkbox") return "checkbox";
      if (type === "radio") return "radio";
      if (type === "button" || type === "submit" || type === "reset" || type === "image") return "button";
      if (type === "range") return "slider";
      if (type === "number") return "spinbutton";
      if (type === "search") return "searchbox";
      if (type === "hidden") return null;
      return "textbox";
    }
    if (element.isContentEditable) return "textbox";
    return null;
  }

  function role(element) {
    return element.getAttribute("role") || implicitRole(element);
  }

  function labelText(element) {
    if (element.labels && element.labels.length) {
      return [...element.labels].map((label) => (label.innerText || "").trim()).filter(Boolean).join(" ");
    }
    const labelledBy = element.getAttribute("aria-labelledby");
    if (labelledBy) {
      return labelledBy.split(/\\s+/).map((id) => (document.getElementById(id)?.innerText || "").trim()).filter(Boolean).join(" ");
    }
    return "";
  }

  function accessibleName(element) {
    return (element.getAttribute("aria-label")
      || labelText(element)
      || element.getAttribute("placeholder")
      || element.getAttribute("alt")
      || element.getAttribute("title")
      || (element.innerText || element.value || "").trim().slice(0, 160)
      || "").trim();
  }

  function isVisible(element) {
    const rect = element.getBoundingClientRect();
    if (!(rect.width > 0 && rect.height > 0)) return false;
    const style = getComputedStyle(element);
    return style.visibility !== "hidden" && style.display !== "none";
  }

  // Collects every element under root, piercing open shadow roots.
  function allElements(root, out) {
    for (const element of root.querySelectorAll("*")) {
      out.push(element);
      if (element.shadowRoot) allElements(element.shadowRoot, out);
    }
    return out;
  }

  function describe(element) {
    return {
      tag: element.tagName.toLowerCase(),
      role: role(element),
      name: accessibleName(element),
      id: element.id || null,
      testId: element.getAttribute("data-testid") || element.getAttribute("data-test-id") || null,
      type: element.getAttribute("type") || null,
      value: "value" in element && element.value !== undefined ? String(element.value).slice(0, 120) : null,
      disabled: element.disabled === true || element.getAttribute("aria-disabled") === "true"
    };
  }

  function stripEmpty(record) {
    const cleaned = {};
    for (const [key, value] of Object.entries(record)) {
      if (value === null || value === "" || value === false) continue;
      cleaned[key] = value;
    }
    return cleaned;
  }

  function snapshot(options) {
    const root = options.within ? document.querySelector(options.within) : document;
    if (!root) return { error: "within selector matched nothing: " + options.within };
    const elements = allElements(root, [])
      .filter((element) => element.matches(interactiveSelector) && isVisible(element))
      .map((element) => stripEmpty(describe(element)));
    const limit = options.limit ?? Infinity;
    return {
      url: location.href,
      title: document.title,
      readyState: document.readyState,
      headings: [...document.querySelectorAll("h1,h2,h3")].map((heading) => heading.innerText.trim()).filter(Boolean).slice(0, 25),
      frames: [...document.querySelectorAll("iframe")].map((frame) => frame.src),
      elementCount: elements.length,
      elements: elements.slice(0, limit)
    };
  }

  // Resolves a locator to exactly one visible element, or returns a diagnostic.
  function resolve(locator) {
    const everything = allElements(document, []).filter(isVisible);
    let matches = [];
    let strategy = "";

    if (locator.selector) {
      strategy = "selector";
      matches = everything.filter((element) => { try { return element.matches(locator.selector); } catch { return false; } });
    } else if (locator.testId) {
      strategy = "testId";
      matches = everything.filter((element) =>
        element.getAttribute("data-testid") === locator.testId || element.getAttribute("data-test-id") === locator.testId);
    } else if (locator.role) {
      strategy = "role";
      const withRole = everything.filter((element) => role(element) === locator.role);
      if (locator.name === undefined) {
        matches = withRole;
      } else {
        const wanted = locator.name.trim().toLowerCase();
        matches = withRole.filter((element) => accessibleName(element).toLowerCase() === wanted);
        if (!matches.length) matches = withRole.filter((element) => accessibleName(element).toLowerCase().includes(wanted));
      }
    } else if (locator.text !== undefined) {
      strategy = "text";
      const wanted = locator.text.trim().toLowerCase();
      const interactive = everything.filter((element) => element.matches(interactiveSelector));
      matches = interactive.filter((element) => accessibleName(element).toLowerCase() === wanted);
      if (!matches.length) matches = interactive.filter((element) => accessibleName(element).toLowerCase().includes(wanted));
      if (!matches.length) {
        const any = everything.filter((element) => (element.innerText || "").trim().toLowerCase() === wanted);
        // Prefer the innermost element carrying the text.
        matches = any.filter((element) => !any.some((other) => other !== element && element.contains(other)));
      }
    } else {
      return { error: "locator needs one of selector, testId, role, or text" };
    }

    if (locator.nth !== undefined) {
      const chosen = matches[locator.nth];
      return chosen ? { element: chosen, strategy, total: matches.length } : { error: "nth " + locator.nth + " out of range; " + matches.length + " matched" };
    }
    if (matches.length === 1) return { element: matches[0], strategy, total: 1 };
    if (!matches.length) return { error: "no visible element matched " + JSON.stringify(locator) };
    return {
      error: matches.length + " elements matched " + JSON.stringify(locator) + "; narrow the locator or add nth",
      candidates: matches.slice(0, 10).map((element) => stripEmpty(describe(element)))
    };
  }

  // Scrolls the element into view and reports whether its center is actually the
  // top-most hit target, so the caller can decide between trusted input events and
  // a direct element.click().
  function prepareClick(locator) {
    const resolved = resolve(locator);
    if (resolved.error) return resolved;
    const element = resolved.element;
    element.scrollIntoView({ block: "center", inline: "center" });
    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const hit = document.elementFromPoint(x, y);
    const hitIsTarget = !!hit && (hit === element || element.contains(hit) || hit.contains(element));
    window.__driveChrome.lastTarget = element;
    return {
      strategy: resolved.strategy,
      total: resolved.total,
      element: stripEmpty(describe(element)),
      x: Math.round(x),
      y: Math.round(y),
      hitIsTarget,
      coveredBy: hitIsTarget || !hit ? null : hit.tagName.toLowerCase() + (hit.id ? "#" + hit.id : "") + (hit.className && typeof hit.className === "string" ? "." + hit.className.trim().split(/\\s+/).slice(0, 2).join(".") : "")
    };
  }

  function clickLastTarget() {
    const element = window.__driveChrome.lastTarget;
    if (!element) return { error: "no prepared target" };
    element.click();
    return { clicked: true };
  }

  // Focuses the element and selects its existing contents so a following
  // Input.insertText replaces rather than appends.
  function prepareFill(locator) {
    const resolved = resolve(locator);
    if (resolved.error) return resolved;
    const element = resolved.element;
    element.scrollIntoView({ block: "center", inline: "center" });
    element.focus();
    if (typeof element.select === "function") {
      element.select();
    } else if (element.isContentEditable) {
      const range = document.createRange();
      range.selectNodeContents(element);
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    }
    return { strategy: resolved.strategy, element: stripEmpty(describe(element)), focused: document.activeElement === element };
  }

  function readFill(locator) {
    const resolved = resolve(locator);
    if (resolved.error) return resolved;
    const element = resolved.element;
    return { value: ("value" in element ? element.value : element.innerText || "").slice(0, 300) };
  }

  function waitCheck(condition) {
    if (condition.selector && !document.querySelector(condition.selector)) return false;
    if (condition.urlIncludes && !location.href.includes(condition.urlIncludes)) return false;
    if (condition.text && !(document.body?.innerText || "").includes(condition.text)) return false;
    if (condition.readyState && document.readyState !== condition.readyState) return false;
    return true;
  }

  window.__driveChrome = { snapshot, resolve, prepareClick, clickLastTarget, prepareFill, readFill, waitCheck, lastTarget: null };
  return "installed";
})()`;

async function ensureLibrary() {
  await evaluate(pageLibrary);
}

function mouse(type, x, y, extra = {}) {
  return send("Input.dispatchMouseEvent", { type, x, y, ...extra });
}

const keyTable = {
  Enter: { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" },
  Tab: { key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 },
  Escape: { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 },
  Backspace: { key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 },
  Delete: { key: "Delete", code: "Delete", windowsVirtualKeyCode: 46 },
  Space: { key: " ", code: "Space", windowsVirtualKeyCode: 32, text: " " },
  ArrowUp: { key: "ArrowUp", code: "ArrowUp", windowsVirtualKeyCode: 38 },
  ArrowDown: { key: "ArrowDown", code: "ArrowDown", windowsVirtualKeyCode: 40 },
  ArrowLeft: { key: "ArrowLeft", code: "ArrowLeft", windowsVirtualKeyCode: 37 },
  ArrowRight: { key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 },
  Home: { key: "Home", code: "Home", windowsVirtualKeyCode: 36 },
  End: { key: "End", code: "End", windowsVirtualKeyCode: 35 },
  PageUp: { key: "PageUp", code: "PageUp", windowsVirtualKeyCode: 33 },
  PageDown: { key: "PageDown", code: "PageDown", windowsVirtualKeyCode: 34 }
};

async function runStep(step) {
  switch (step.method) {
    case "snapshot": {
      await ensureLibrary();
      return evaluate(`JSON.stringify(window.__driveChrome.snapshot(${JSON.stringify({ within: step.within ?? null, limit: step.limit ?? null })}), null, 1)`);
    }
    case "click": {
      await ensureLibrary();
      const prepared = await evaluate(`window.__driveChrome.prepareClick(${JSON.stringify(step.locator ?? {})})`);
      if (prepared.error) return prepared;
      if (prepared.hitIsTarget) {
        await mouse("mouseMoved", prepared.x, prepared.y);
        await mouse("mousePressed", prepared.x, prepared.y, { button: "left", clickCount: 1 });
        await mouse("mouseReleased", prepared.x, prepared.y, { button: "left", clickCount: 1 });
        return { clicked: prepared.element, via: "input events", matchedBy: prepared.strategy };
      }
      const fallback = await evaluate(`window.__driveChrome.clickLastTarget()`);
      if (fallback.error) return fallback;
      return { clicked: prepared.element, via: "element.click()", coveredBy: prepared.coveredBy, matchedBy: prepared.strategy };
    }
    case "fill": {
      await ensureLibrary();
      const prepared = await evaluate(`window.__driveChrome.prepareFill(${JSON.stringify(step.locator ?? {})})`);
      if (prepared.error) return prepared;
      await send("Input.insertText", { text: step.text ?? "" });
      const after = await evaluate(`window.__driveChrome.readFill(${JSON.stringify(step.locator ?? {})})`);
      return { filled: prepared.element, focused: prepared.focused, matchedBy: prepared.strategy, valueNow: after.value ?? after.error };
    }
    case "press": {
      const definition = keyTable[step.key];
      if (!definition) return { error: `unknown key "${step.key}"; known: ${Object.keys(keyTable).join(", ")}` };
      const { text, ...base } = definition;
      const modifiers = step.modifiers ?? 0;
      await send("Input.dispatchKeyEvent", { type: text ? "keyDown" : "rawKeyDown", modifiers, text, ...base });
      await send("Input.dispatchKeyEvent", { type: "keyUp", modifiers, ...base });
      return { pressed: step.key };
    }
    case "waitFor": {
      const condition = {
        selector: step.selector ?? null,
        urlIncludes: step.urlIncludes ?? null,
        text: step.text ?? null,
        readyState: step.readyState ?? (step.selector || step.urlIncludes || step.text ? null : "complete")
      };
      const timeoutMs = step.timeoutMs ?? 10000;
      const started = Date.now();
      while (Date.now() - started < timeoutMs) {
        // The library is re-installed after navigation because a new document drops window state.
        let satisfied = false;
        try {
          await ensureLibrary();
          satisfied = await evaluate(`window.__driveChrome.waitCheck(${JSON.stringify(condition)})`);
        } catch {
          // The page is mid-navigation; keep polling.
        }
        if (satisfied) {
          const where = await evaluate(`location.href`);
          return { satisfied: condition, url: where, afterMs: Date.now() - started };
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      const where = await evaluate(`location.href`).catch(() => "unknown");
      return { error: "waitFor timed out after " + timeoutMs + "ms", condition, url: where };
    }
    default: {
      const response = await send(step.method, step.params ?? {});
      if (response.error) return { error: response.error };
      return response.result;
    }
  }
}

function isInputStep(step) {
  return step.method === "click" || step.method === "fill" || step.method === "press" || step.method.startsWith("Input.");
}

function withDeadline(promise, ms) {
  let timer;
  const deadline = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("deadline")), ms); });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

socket.addEventListener("open", async () => {
  await send("Page.enable");
  await send("Runtime.enable");
  await send("DOM.enable");
  await send("Accessibility.enable");

  let exitCode = 0;
  for (const step of steps) {
    const label = step.method;
    let result;
    let attempts = 0;
    while (true) {
      attempts++;
      try {
        result = await withDeadline(runStep(step), stepDeadlineMs);
        break;
      } catch (error) {
        const timedOut = error.message === "deadline";
        if (timedOut && attempts === 1 && !isInputStep(step)) {
          console.error(`${label} -> timed out after ${stepDeadlineMs / 1000}s, retrying once`);
          continue;
        }
        result = { error: timedOut ? `${label} timed out after ${stepDeadlineMs / 1000}s` + (isInputStep(step) ? " (input steps are not retried)" : " on retry") : error.message };
        break;
      }
    }
    if (step.method === "snapshot" && typeof result === "string") {
      console.log(result);
    } else {
      console.log(label + " -> " + JSON.stringify(result));
    }
    if (result && result.error) { exitCode = 1; break; }
  }
  process.exit(exitCode);
});
