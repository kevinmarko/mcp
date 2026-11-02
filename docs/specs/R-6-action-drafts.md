# Spec R-6: Action drafts ("Draft email" per decision)

Status: draft for Kevin, 2026-10-30. Author: B4 (UX, R6). Builder: B5 (app HTML); B1 (`draftActionText` in `shared/`); B2 (the
`ActionRecipients` tab and its reader in `TeamSheet.gs`).
Plan reference: [RESEARCH_BUILDOUT_PLAN.md](../RESEARCH_BUILDOUT_PLAN.md) slice 2c-1 (research idea 6, Q4, D84). Depends on the
decision card ([R-4](R-4-decision-card.md)) and the decision records (2a-3, ADR-R1). Written against the existing
`openGmailSearch`, `copyTextToClipboard`, `window.__SERVER_CONFIG__` (Config Sheet injection, `TeamSheet.gs`) and `GOOGLE_SERVICES_OFF`.

## 1. What it is

After a decision is saved, a **Draft email** button opens the person's own mail client with the recipients, subject and body already
filled in, so the freeze request or roll notice that today is typed by hand after the call (research pain 5) is one click. The app
**only drafts**: it has no mail scope, calls no send API and cannot know whether the email was sent. The person reads, edits and
sends it themselves (Q4, DECIDED 2026-10-30).

## 2. Decisions needed from Kevin

| # | Question | Recommendation (what this spec assumes) |
|---|---|---|
| K1 | Gmail compose URL or `mailto:`? | **Gmail compose** (`https://mail.google.com/mail/?view=cm&fs=1&to=…&cc=…&su=…&body=…`) as the button, with `Open in mail app` (`mailto:`) as a secondary link. The team works in Gmail and `openGmailSearch` already opens it. |
| K2 | Which Gmail account opens? | Add `authuser={signed-in email}` when the server returned one, so a person signed into a personal account too does not draft from it. That puts the user's own address in a URL to Google's own host only; never to any other host. |
| K3 | Does Monitor get a draft? | **Yes, optional FYI** to the lane's team; Freeze, Cut and Roll get requests. The button is there for all four. |
| K4 | Shape of `ActionRecipients` | One row per rule: `Action, Lane, To, Cc, Note`. `Action` is `freeze|monitor|cut|roll|*`, `Lane` a lane code or `*`. Most specific row wins (action+lane, then action+`*`, then `*`+lane, then `*`+`*`). Several addresses separated by `;`. |
| K5 | No matching row | **To = the lane PIC's email** from the D4 map (`myWork.picEmails` format), Cc empty, and the draft says `No ActionRecipients rule for EC4/freeze; addressed to the PIC.` If the PIC has no email either, To is empty and the person fills it. |
| K6 | Are recipient lists visible to every visitor? | They arrive with the page in `window.__SERVER_CONFIG__` (internal addresses, the same people visible in Gmail). Alternative: a `google.script.run` call per draft returning only the matched row. Recommended: the injection, with no address ever logged, put in `Startup Errors`, or shown outside the draft preview. |
| K7 | Record that a draft was opened? | **Yes**, an append-only ADR-R1 row `kind: 'draft'` (action, decision id, author, time, rule matched, recipient **count**; no addresses, no body). It says "drafted", never "sent". |
| K8 | Hard-constraint and weight-fix drafts (research idea 6) | **Not in 2c-1**: they have no decision button. A later slice adds them as templates. |

## 3. Placement and flow

- In the decision card, the latest decision line (R-4 state C4) gets `Draft email` (primary) and `Open in mail app` (link) beside
  it. Also in call mode (R-7) on each decision since the last call. Only shown for a saved decision (never for an unsaved choice).
- Click `Draft email`: an inline **preview** expands under the decision (not a second dialog): To, Cc, Subject, the body in a
  read-only `<textarea>`, the matched rule (`Rule: freeze / EC4` or `Rule: none, addressed to the PIC`), then `Open in Gmail`,
  `Open in mail app`, `Copy text`. Opening happens from the preview, so the person sees the recipients before anything opens.
- `Open in Gmail` calls `window.open(url, '_blank', 'noopener,noreferrer')`, records K7, and shows `Draft opened in Gmail. Nothing
  is sent until you press Send there.` (polite status).
- Basic build (`GOOGLE_SERVICES_OFF`): no recipients and no decisions, so no button.

## 4. The text: `BFShared.draftActionText(decision, row, opts)`

Pure, in `shared/` (B1, own tests), ES5, returns `{ subject, body, warnings }`; the app only encodes and opens. `row` is the card's
figures (the R-4 `seen` object plus `vvd, vessel, lane, saleWeek, pol, cutoff`); `opts` carries `appUrl` (the page's own
`?vvd=` link from slice 1-C) and `author`.

- Subject (one line): `[Freeze request] ONE HAMMERSMITH 0613W · USSAV01 · EC4 W45` (`[Monitor]`, `[Cut bookings]`, `[Roll request]`).
- Body: one sentence per fact, the decision first:
  `Decision: Freeze at USSAV01 (Ryan T, Thu 10/30 09:42).`, `Reason: …`, `Roll to: …` (Roll only), `Booked 612 TEU vs POL Max
  Laden 540; threshold 150% (ceiling 810).`, `Desk declared 70 TEU empties (Empty Planning as of Wed 10/29 14:00).` or `Desk
  declaration: not connected.`, the assumption line verbatim with `Assumption:`, `Cut-off: Mon 11/3.`, `Data as of: Thu 10/30 09:00
  (hourly flash).`, then `Open in Booking Flash: {appUrl}`.
- No figure is computed here; all come from `row` (rule 8: the email repeats what the card showed, so the two never differ).

## 5. Privacy and injection

| Risk | Rule |
|---|---|
| Header injection via `mailto:` / Gmail params | Subject: CR, LF and other control characters replaced by a space, then capped at 150 characters. Each address must match `^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$` after trim; anything else is dropped and listed in `warnings` (shown in the preview as `Skipped "x" in ActionRecipients: not an email address.`). Addresses are joined with `,`. |
| Newlines in reasons and notes | Normalised to `\n` in `body`; the URL builder encodes every part with `encodeURIComponent`, so a newline becomes `%0A` (`%0D%0A` for `mailto:`, RFC 6068). Never string-concatenate raw text into a URL. |
| Untrusted text (reasons by other people, `opIssues`, `remarks`, vessel names) | Control characters other than `\n` and tab removed; never rendered as HTML (React text and a `<textarea>` only); never placed in `to`/`cc`. |
| Recipient privacy | Addresses come only from the Config Sheet (`ActionRecipients`, the D4 PIC map), never from the feed, a note, a reason or the URL. They are not logged, not stored in the draft record (K7), not put in any URL except the compose URL itself. |
| Who it goes to | The person sees To and Cc in the preview before opening; the app never sends. B7 reviews each recipient rule (plan section 9). |
| URL length | Budgets: **Gmail URL 7,500 characters, `mailto:` 1,900** (conservative: commonly cited client limits, UNCONFIRMED on the team's machines). Over budget: the body is cut at a line boundary and ends `… (full text copied to the clipboard)`, the full text is copied, and the preview says so. Recipients and subject are never cut. |
| Sheet formula injection (the K7 record) | Stored as text by `TeamSheet.gs` (2a-3); a leading `=`, `+`, `-` or `@` is never evaluated. |

## 6. States

| ID | Condition | Renders |
|---|---|---|
| D0 | Basic build, or no saved decision | No button. |
| D1 | Rule matched | Preview with `Rule: {action} / {lane}`. |
| D2 | No rule, PIC email known | Preview with `Rule: none, addressed to the PIC (Ryan T).` |
| D3 | No rule, no PIC email | To empty; `No recipients configured. Add a row to ActionRecipients, or type the address in Gmail.` Buttons still work. |
| D4 | Some addresses skipped | D1/D2 plus the `warnings` lines in amber. |
| D5 | Over the URL budget | Preview note `Body shortened for the link; the full text is on your clipboard.` |
| D6 | Popup blocked (`window.open` returned null) | `Your browser blocked the new tab. Use Copy text, or allow pop-ups for this page.` |

## 7. Keyboard, screen reader, themes, widths

- `Draft email` is `aria-expanded` / `aria-controls` the preview; Escape in the preview closes it and returns focus to the button.
  Tab order: To, Cc, Subject are read-only text, then the body, then the three buttons.
- Status messages (opened, copied, blocked) in one polite `role="status"` node inside the preview.
- Colours as the card (R-4 section 8); warnings use the amber pair. 390 px: the preview stacks, the body textarea is full width,
  6 rows, scrolls inside itself; the three buttons wrap, each at least 44 px tall. 1366 px: buttons in one row.

## 8. Acceptance tests (for B6 and B1)

Hooks: `data-action-draft` (button), `data-action-draft-preview`, `data-draft-to`, `data-draft-cc`, `data-draft-subject`,
`data-draft-body`, `data-draft-rule`, `data-draft-warning`, `data-draft-open="gmail|mailto"`, `data-draft-copy`, `data-draft-state="rule|pic|none|truncated|blocked"`.

1. `shared` checks: for each action, `draftActionText` returns the subject prefix above and a body containing the reason verbatim.
2. A reason with `\r\n`, `\n` and `%0ABcc:x@evil.test` yields a body with literal text, and the built Gmail URL, parsed with `new URL`, has exactly the params `view, fs, to, cc, su, body` (plus `authuser`); `su` has no newline.
3. ActionRecipients fixture with `freeze/EC4`, `freeze/*`, `*/EC4`, `*/*`: the four precedence cases pick the right row.
4. An entry `Ryan T <ryan@x>`, `a@b,c@d` in one cell, and `not-an-email` → the valid ones kept, the others in `data-draft-warning`.
5. A 9,000-character reason: Gmail URL length ≤ 7,500, `mailto:` ≤ 1,900, body ends with the clipboard note, the clipboard fake got the full text.
6. Stub `window.open` to return null → `data-draft-state="blocked"`.
7. Opening records one fake `saveDecision`-family call with `kind: 'draft'` and no `@` anywhere in its payload.
8. `__BF_GOOGLE_SERVICES_OFF__`: no `[data-action-draft]` node.
9. Rule 8: no existing check's count drops; `openGmailSearch` behaviour (double-click) unchanged.

## 9. Out of scope

Sending mail, a mail or Chat scope, tickets (research mentions them; no ticket system is named), reading replies, templates edited
in the Config Sheet (v1 templates live in `shared/`), hard-constraint and weight-fix drafts (K8).
