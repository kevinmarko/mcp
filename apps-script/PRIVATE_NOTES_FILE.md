# Private VVD notes file: contract shared by Booking Flash and VPT

Kevin, 2026-10-27 (ADR-040): private notes must show in both apps and stay private. Both apps run as the person using them ("Execute as: User accessing the web app"), so each person's private notes live in **one Google Sheet in their own Drive**, created on their first private note and shared with no one. Both apps read and write that same file. **Any change here must be made in both repos** (`kevinmarko/vessel-planning-tool`: `new Build/src/SharedNotes.js`; `kevinmarko/booking-flash-report`: `apps-script/TeamSheet.gs`).

## Finding the file

Drive API v3 (`Drive.Files.list`, advanced service), as the person:

```
q       = 'me' in owners and trashed = false and mimeType = 'application/vnd.google-apps.spreadsheet'
          and properties has { key='bfrPrivateNotes' and value='1' }
fields  = files(id,modifiedTime,createdTime)
orderBy = createdTime
```

Several matches: use the **first (oldest)**. None: the person has no private notes yet.

Use `properties` (visible to every app), **not** `appProperties` (private to the Google Cloud project of the app that wrote them; the two apps are different projects).

## Creating the file (on the first private save only)

1. `SpreadsheetApp.create('Booking Flash private notes (only you)')`.
2. First tab renamed **`Private Notes`**, row 1 = `VVD | Note | Updated At | Source`, row 1 frozen.
3. `Drive.Files.update({ properties: { bfrPrivateNotes: '1' }, description: 'Your private VVD notes from Booking Flash and Vessel Planning. Only you can see this file; do not share it.' }, id)`.
4. Search again. If the oldest match is not the file just created (the other app created one at the same moment), write to the oldest and move the new one to the trash.
5. **After every write, search once more** (the other app's tag may land after step 4). If the oldest match is not the file just written to, write the same VVD row (or delete it, for an empty note) in the oldest too; move the file written first to the trash **only if this save created it** (never trash a file you did not create).

Never share the file, never add editors, never move it out of the person's Drive.

## Rows

Tab `Private Notes` (if it is missing, use the first tab). One row per VVD:

| Column | Value |
|---|---|
| A `VVD` | upper case, must match `/^[A-Z0-9][A-Z0-9 ._\/-]{1,39}$/` |
| B `Note` | at most 1000 characters after trim |
| C `Updated At` | ISO timestamp of the save (`new Date().toISOString()`) |
| D `Source` | `BFR` or `VPT`, the app that last wrote the row; blank reads as `BFR` |

- Save: update B:D of the VVD's row, or append a row. Empty text deletes the VVD's row(s).
- Every written string goes through `sheetText_` (a leading apostrophe for text Sheets would read as a formula, number, date, time or boolean, **and for text that itself starts with an apostrophe**, which Sheets would otherwise swallow), the same rule as the team Sheet.
- Tab `Private Notes` missing: use the first tab **only if its row 1 is the header above** (VVD, Note, Updated At, Source); otherwise do not read or write (private notes unavailable).
- Before writing or deleting a row, check that column A of that row still holds the VVD (the other app may have moved rows since you read them); if not, read the rows again.
- A failure while creating the file after `SpreadsheetApp.create` (the tagging call): move the new file to the trash before reporting the error.
- Read with `getDisplayValues()`; skip rows with an invalid VVD or an empty note.
- Hold `LockService.getUserLock()` around the whole save (find, create, write, search again): VPT uses `tryLock(5000)` and replies `busy` when it is not free, like a public save. The user lock is per script, so it only queues one app's own requests (two tabs); a race with the other app is settled by step 5 of "Creating the file".
- Update: write the first row of the VVD and delete any other rows of that VVD bottom-up (one row per VVD).
- Only when the app runs as the person: if `Session.getEffectiveUser().getEmail()` (lower-cased) is not the active user's e-mail (a deployment with "Execute as: Me"), private notes are off (`privateAvailable: false`, a private save replies `private-unavailable`), since Drive would act as the owner.

## Caching (each app keeps its own)

- Cache `{id, modifiedTime, notes}` in `CacheService.getUserCache()` (per person). VPT: key `vpt:bfpriv:1`, 30 minutes.
- When a person **opens notes** (an explicit read), check the file: one `Drive.Files.get(id, {fields: 'modifiedTime,trashed'})`. Re-read the rows only when `modifiedTime` changed; search again when the file is trashed or the cache holds no file. This is how a note written in the other app shows up.
- After a save, store the new rows and the new `modifiedTime` (another `Drive.Files.get`), so the next check does not re-read.

## Moving existing private notes (Booking Flash only)

Booking Flash kept private notes in its user properties (`bfrPrivVvdNote:<VVD>` -> `{"note","updatedAt","source"}`). The first time a person's private notes are read or saved after the change, copy those into the file (keep the newer one when the file already has that VVD), then delete the properties. VPT never shipped user-property private notes, so it has nothing to move.

## Reply fields

Both apps return each private note as `{vvd, note, author: <the person's email>, updatedAt, source, visibility: 'private'}`.
