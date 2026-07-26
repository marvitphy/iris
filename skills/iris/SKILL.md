---
name: iris
description: Drive the Iris browser to operate real, logged-in websites for the user — research, competitor analysis, form-filling, and automating any site behind a login that no public API exposes. Use whenever a task needs a real browser with the user's sessions (X, LinkedIn, SaaS dashboards, admin panels, ticketing/event platforms, etc.). Requires the `iris` MCP server connected and the Iris app running.
---

# Iris — the browser you drive for the user

Iris is a real Chromium browser on the user's machine. You operate it through the `iris` MCP
tools; the user watches live in the Iris window (an activity trail, a glow while you work) and can
take over any time. Iris runs on the user's **real logged-in sessions**, so you can do anything the
user can do in a browser they're signed into.

## How you see the page

`snapshot` is **your** eyes — it is not shown to the user. It returns a compact accessibility tree
(text, with `[ref=eN]` markers), which is how you perceive the page cheaply, in few tokens — not a
screenshot. Meanwhile the human sees the actual rendered website in the Iris window; you don't need
to describe the page to them, they can already see it. Use `screenshot` only when you need real
pixels (canvas, maps, charts) or to give the user visual evidence.

## When the user says "look at what I'm seeing"

You share the same tab and scroll position as the user. `snapshot` and `read_text` cover the WHOLE
page, so they don't tell you which part the user is currently looking at. For that, use
**`read_viewport`** — it returns only the text visible on screen right now. Add `screenshot` if you
also need the visual layout (images, charts, positioning). Then answer about that region specifically.

## The core loop

Always: **snapshot → act by ref → the action returns a fresh snapshot → repeat.**

1. `snapshot` returns the compact accessibility tree with `[ref=eN]` markers — this is your view.
2. Act on an element by its ref: `click`, `type`, `scroll`.
3. Every mutating action returns a fresh snapshot — read it, don't reuse old refs.

Refs are only valid against the latest snapshot. After a navigation or a big change, snapshot again.

## Spaces and tabs — get this right

- A **Space** is an isolated session (own cookies/login). There is usually already one Space.
- To work on **several pages, open tabs — do NOT create extra Spaces.** Use `tab_new` (optionally
  with a URL). Create a new Space only when you genuinely need a separate, isolated login.
- `tab_new`, `tab_list`, `tab_activate`, `tab_close`. Navigation/snapshot act on the **active tab**;
  `tab_activate` to switch which tab you're driving.
- Omit `spaceId` on most tools — they default to the active Space.
- **Name the Space for what it's for.** Once you know the task, call `space_rename` with a short
  title (1-3 words): "Deep research", "AI in 2026", "Diabetes treatments", "Competitor analysis".
  Not a long sentence. This is how the user tells Spaces apart in the rail.

### Never trust your memory of Spaces/tabs — check ground truth

The user creates, deletes, switches, and renames Spaces and tabs **by hand, at any time**, without
telling you. Whatever you remember from earlier in the conversation may already be wrong (a Space you
created may have been deleted; the active Space may have changed).

- **Before answering "which Space/tab is open" or acting on a specific Space, call `current_context`**
  (or `space_list`). These return live state. Do not answer from memory.
- `current_context` tells you the Space and tab the user is looking at **right now**, plus every open
  Space. That is the source of truth.
- **Stay where the user is.** If the user has a tab/Space open and asks you to do something, keep
  working in that active Space unless they clearly ask for a new/other one. Omitting `spaceId` already
  targets the active Space — rely on that instead of hard-coding an old id.

## Working with the logged-in web

- `navigate` takes a URL or a search query (a plain query does a web search).
- **`scrape` is your default reader**: the page as clean markdown, headings and links kept, nav and
  ads dropped. Use it for articles, docs, and results. `read_text` is the raw fallback; `evaluate`
  runs JS for structured extraction in ONE call (e.g. `[...document.querySelectorAll('h3')].map(e=>e.innerText)`).
- `screenshot` when you need to SEE the page (canvas, maps, charts, visual verification).
- `go_back` / `go_forward` to move in history; `history` lists what this Space has visited.

## Filling things in

- `click` and `type` cover most of it. Beyond that:
  - **`press_key`** for keys with no element: `Escape` to dismiss a modal, `Tab`, `ArrowDown` to walk
    a custom dropdown, `Control+A`.
  - **`select_option`** for native `<select>` (by visible label). For a JS dropdown, click it open and
    click the option.
  - **`upload_file`** to attach a local file (absolute path). It always asks the user first; if the
    decision is `rejected`, do not retry.
- Files the page downloads land in Documents/Iris — `list_downloads` gives you their paths.

## When a page misbehaves

Don't guess and don't retry blindly. **`page_logs`** returns this Space's recent console errors and
failed/4xx/5xx requests: read it first when a page shows an error, renders empty, or an action seems
to do nothing. Then decide: reload, wait, take a different route, or tell the user what is broken.

## Remember what you learn

Iris keeps memory across sessions, and it is the difference between a tool that starts from zero every
time and one that gets better at the user's actual sites.

- When you work out how a site behaves ("on linkedin.com the export lives under More > Export"), call
  **`remember`** with `scope: "site"` and `key` = the domain. **`navigate` hands those notes straight
  back to you** (a `learnings` field) the next time you land on that domain, so you never rediscover it.
- Use `scope: "global"` for lasting facts about the user, `scope: "space"` for findings in this session.
- Write one reusable sentence, not a log line. Save the lesson, not the event.
- **`recall`** searches everything by keyword.
- The user can read and delete every memory in the Memory dialog, so keep entries honest and useful.

## Keep the user informed

Call **`set_status`** with a short line whenever you start a new phase of a longer task
("Comparing ticketing platforms", "Reading the OpenAI post"). It shows in the Iris sidebar and is how
the human follows along. Clear it with an empty string when you finish.

## Two rules that build trust

1. **Handoff.** After actions, watch for a non-null `handoff` in the response (captcha, OTP, login
   wall). When it appears: STOP acting, tell the user plainly what's needed, and poll
   `handoff_status` until it clears. The user solves it in the real tab and clicks Continue.
   Never try to solve captchas or type the user's passwords.

2. **Approval before anything irreversible.** BEFORE you buy, pay, send a message/email, post,
   delete, or submit a form that commits something, call `request_approval("<clear one-line
   description>")` and only proceed on `"approved"`.
   - **Always call it** — do not decide on your own to skip it. The *system* decides how it resolves:
     if the user turned on **Autonomy** for the Space (a toggle in the Space header), `request_approval`
     returns `"approved"` instantly with no human prompt; if Autonomy is off (the default), it blocks
     until the user clicks Approve/Reject. `current_context` reports the Space's `autonomous` flag if you
     want to know, but your behavior is the same either way: request, then act on the result.
   - Captcha/OTP/login **handoff still pauses** even in Autonomy mode — those physically need the human.

## Turning work into output

- `save_file(filename, content)` — write a report, CSV, or notes you composed to the user's
  `Documents/Iris` folder.
- `export_page(format)` — save the current page as `pdf`, `md`, or `text`.

## Keep the user's view on what you're doing

The user is watching the active tab. Don't leave them looking at the wrong thing.

- **Show, don't just report.** When you reference a specific result, post, listing, or element
  ("here's your post", "this is the cheapest flight"), bring it into their view: `navigate` the active
  tab to that exact page (e.g. the tweet's own URL, not the profile) **and** call `reveal(ref)` to
  scroll it into view and highlight it. Reporting only a URL is not enough — they should see it.
- After you finish an action that produced something (a post, a submitted form, a result), leave the
  active tab on that result, scrolled to it, so the user sees the outcome.
- Work in the active tab the user sees; if you must work elsewhere, bring them back to the relevant
  view when you're done.

## Good habits

- Prefer `evaluate` / `read_text` over many snapshot+click round-trips for reading and extraction.
- Keep related pages as tabs in one Space so the user can follow along in the sidebar.
- Tell the user what you're about to do on their account before doing it; the activity trail and
  approval gates are there so they stay in control.
