# JTBD Copy Audit — Wine Cellar Dashboard

Audit date: 2026-03-20
Reviewed by: Codex (gpt-5.4) on 2026-03-20

All UI copy across the dashboard was reviewed through a Jobs to Be Done lens,
then validated against the actual source code by a second reviewer.

## Files Audited

- `dashboard/src/pages/ActivityNew.tsx` + `dashboard/src/components/DetailFields.tsx`
- `dashboard/src/pages/BatchDetail.tsx` + `ExportButton.tsx` + `BatchStats.tsx`
- `dashboard/src/pages/BatchList.tsx`
- `dashboard/src/pages/Dashboard.tsx`
- `dashboard/src/pages/Setup.tsx`
- `dashboard/src/pages/Tools.tsx`
- `dashboard/src/components/BatchCard.tsx`
- `dashboard/src/components/ActivityItem.tsx`

### Not Audited (gaps to cover separately)

- `dashboard/src/pages/BatchNew.tsx` + `dashboard/src/pages/BatchEdit.tsx` (via `BatchForm.tsx`)
- `dashboard/src/pages/Devices.tsx`
- `dashboard/src/pages/BatchComparison.tsx`
- `dashboard/src/components/Layout.tsx`

---

## Priority 1 — Shared Error Handling & Destructive Actions

The biggest UX gaps are generic errors with no recovery path and destructive dialogs with vague confirmation buttons. Fix these systemically.

### Systemic error pattern

The generic `"Something went wrong"` originates in `useFetch.ts:19` and is reused across
Dashboard, ActivityNew, BatchForm, and Devices. Fix at the source or wrap at each call site.

| File | Current | Suggested |
|------|---------|-----------|
| useFetch.ts:19 | `"Something went wrong"` | Consider returning the actual error message or a structured error object so call sites can display contextual copy |
| ActivityNew.tsx:66 | `"Something went wrong"` | `Couldn't save this activity. Check your connection and try again.` |
| BatchForm.tsx:56 | `"Something went wrong"` | `Couldn't save batch. Check your connection and try again.` |
| Dashboard.tsx:117 | `{error}` (raw string, no retry) | Add a Retry button + wrap: `Couldn't load your dashboard. {error}` |
| ExportButton.tsx:30 | `"Export failed"` | `Couldn't download data. Please try again.` |
| Devices.tsx | Raw error passthrough | Wrap with contextual message |

**Note:** Dashboard error state needs a real retry button/action, not just better wording.

### Destructive confirmation dialogs (BatchDetail.tsx)

| Current | Suggested | Why |
|---------|-----------|-----|
| `Confirm` button | Use the specific action verb: `Delete`, `Abandon` | Generic "Confirm" forces re-reading the dialog title |
| `...` loading state | Use verb in progress: `Deleting...`, `Abandoning...` | Bare ellipsis gives no feedback |
| `Delete batch?` dialog title | `Permanently delete this batch?` | Adds weight to irreversible action |

## Priority 2 — Activity Entry Vocabulary

The activity form labels expose database internals. These are the clearest JTBD wins.

| File | Current | Suggested | Why |
|------|---------|-----------|-----|
| DetailFields.tsx:20 | `Chemical` | `What was added?` | Not all additions are chemicals (oak chips, yeast, fruit) |
| DetailFields.tsx:60 | `Value` | `Reading` | Winemakers take "readings", not "values" |
| DetailFields.tsx:104 | `Parameter` | `What are you adjusting?` | Engineering jargon → natural prompt |
| DetailFields.tsx:109, 113 | `From Value` / `To Value` | `Before` / `After` | Natural language pair |
| DetailFields.tsx:39 | `Metric` | `What are you measuring?` | "Metric" is ambiguous (metric vs imperial?) |
| ActivityNew.tsx:102 | Title field (no placeholder) | Add placeholder: `e.g., Added yeast nutrient` | Example-driven guidance reduces hesitation |

**Important:** Keep create and edit flows in sync — if you change labels in ActivityNew, update the inline edit dialog in ActivitySection.tsx:160 too.

### Labels to keep as-is

| Item | Why |
|------|-----|
| `Log Activity` heading | Consistent with `+ Log` button in ActivitySection. Changing to "Record" is churn. |
| `Stage` label | Clear, standard — question-style adds no value here |
| `Recorded At` label | Already clear for the audience |

## Priority 3 — Missed Core Labels

Issues caught in code review that the initial audit missed.

| File | Current | Suggested | Why |
|------|---------|-----------|-----|
| Layout.tsx:23 | `Logout` | `Disconnect` or `Reset Connection` | It clears local API config, not an account logout — misleading |
| BatchForm.tsx:120 | `Target Vol (L)` | `Target Volume (L)` | Abbreviated inconsistently with other labels |
| BatchList.tsx:52 | `Tap + to start your first batch` | `Press + to start your first batch` | "Tap" is touch-only but the UI has desktop layouts |
| Dashboard.tsx:127 | `No active batches.` | `No active batches yet. Press + to start your first batch.` | Dead-end empty state |
| ActivityItem.tsx:46 | `?` (vessel fallback) | `Unknown vessel` | Bare `?` is cryptic; say what's missing |

## Priority 4 — Dashboard & Batch Detail Scanability

Small copy tightening that improves at-a-glance comprehension.

| File | Current | Suggested | Why |
|------|---------|-----------|-----|
| Dashboard.tsx:69 | `Stall` badge | `Stalled` | Status, not a concept |
| Dashboard.tsx:85 | `no readings` | `no readings yet` | Signals temporary state |
| Dashboard.tsx:143 | `No activities logged yet.` | `No activities yet. Log your first action to start tracking.` | Add action + benefit. **Note:** don't mention "readings" — this section only shows activities. |
| BatchStats.tsx:41 | `Velocity (48h)` | `Gravity change (48h)` | Domain language over physics jargon |
| BatchStats.tsx:47 | `Est. days to 0.996` | `Est. days to dry (0.996)` | Adds outcome context |
| BatchDetail.tsx:219 | `Volume` | `Current volume` | Distinguishes from target |
| BatchDetail.tsx:224 | `Target` | `Target volume` | Removes ambiguity |
| BatchList.tsx:53 | `No ${status} batches.` | `No ${status} batches yet.` | Optimistic framing |

### Keep as-is

| Item | Why |
|------|-----|
| `OG → SG` in BatchStats | Winemakers know these abbreviations; spelling out is worse |
| Bare verbs on batch actions (`Edit`, `Archive`, `Reopen`) | On a batch detail page the context is obvious; longer labels bloat mobile |
| `Compare` button in BatchList | The comparison page is broader than curves; `Compare Batches` is acceptable but `Compare Curves` is inaccurate |
| `start your first batch` in empty state | "Batch" is the app's core object — don't replace with "wine" |

## Priority 5 — Tools Page

Rename the page heading. Be selective with calculator descriptions — avoid marketing-y rewrites.

| Current | Suggested | Why |
|---------|-----------|-----|
| `Tools` (page heading + nav) | `Calculators` (nav) / `Winemaking Calculators` (page heading) | It's calculators, not generic "tools" |
| `Testing...` button (Setup.tsx) | `Connecting...` | Matches user mental model |

### Calculator descriptions — apply selectively

| Current | Suggested | Notes |
|---------|-----------|-------|
| `Sugar addition to raise specific gravity` | `How much sugar to reach your target gravity` | Good — outcome framing |
| `Correct SG reading for sample temperature` | `Get an accurate SG from an off-temperature sample` | Good — outcome framing |
| `Sugar-water solution at a known SG` | `Make a reference solution to verify your hydrometer` | Good — outcome framing |
| `Potassium metabisulfite (KMS) dosing` | Keep or lightly revise | Proposed rewrite reads too marketing-y |

### Loading states — apply across all pages

| File | Current | Suggested |
|------|---------|-----------|
| Dashboard.tsx | `Loading...` | `Loading your batches...` |
| BatchDetail.tsx | `Loading...` | `Loading batch details...` |
| BatchList.tsx | `Loading...` | `Fetching your batches...` |
| ActivityNew.tsx (batch load) | `Loading...` | `Loading batch...` |
| ActivityNew.tsx (save) | `Saving...` | `Saving activity...` |

### Export → Download (ExportButton.tsx)

| Current | Suggested |
|---------|-----------|
| `Export CSV` | `Download CSV` |
| `Exporting...` | `Preparing download...` |
| Toast: `Exported {n} readings, {n} activities` | `Downloaded {n} readings and {n} activities` |

## Low-Impact / Nice-to-Have

- **Tools** — Add `Batch` prefix to ambiguous `Volume (L)` slider labels
- **Tools:131** — Validation: add "Raise the target to calculate a sugar addition."
- **Tools:261** — Validation: add "Raise it above 1.000 to calculate a recipe."
- **Tools:97** — `ABV` result label → `Estimated ABV`
- **Tools:123, 246** — `Table Sugar` / `White Sugar` → `Sugar Needed`
- **Tools:127** — `Gravity Points` → `Gravity Increase`
- **Tools:252** — `Method` → `How to Prepare`
- **Tools:256** — Restate target SG in final method step
- **BatchDetail:50** — `Temp range` → `Temperature range`
- **BatchDetail:56** — `Readings` → `Total readings`
- Missing placeholders: tasting note fields, racking vessel fields, adjustment parameter field

## Rejected Suggestions

These were proposed in the initial audit but rejected during code review.

| Suggestion | Why rejected |
|------------|--------------|
| `Connect to your API` → `Start tracking your batches` | Setup screen is explicitly about API config; hiding that is confusing |
| `Log Activity` → `Record Activity` | Inconsistent with `+ Log` button in ActivitySection |
| `Recorded At` → `When did this happen?` | Already clear; question-style adds no value |
| `Stage` → question-style label | Already clear |
| `Delete` → `Remove` on ActivityItem | Confirmation dialog already exists in ActivitySection; "Remove" is less honest about the action |
| `Compare` → `Compare Curves` | Comparison page includes more than curves |
| `start your first batch` → `start tracking your first wine` | "Batch" is the core domain object |
| `OG → SG` → `Original → Current gravity` | Winemakers know these abbreviations |
| `Pull to refresh` in error messages | No such affordance exists in the UI |
| Blanket `[verb] [object]` on all batch actions | Context is obvious on batch detail; bloats mobile buttons |

## Already Good — No Changes Needed

- Domain labels: SG, pH, pts/d, attenuation, aroma/flavor/appearance
- Wine type and stage badges/labels throughout
- Tab labels (Active / Completed / Abandoned / Archived)
- Tasting note vocabulary (Aroma, Flavor, Appearance)
- From Vessel / To Vessel labels (racking)
- FAB `+` buttons (universal mobile affordance)
- BatchCard — nearly all copy is data-display, already well-suited
- Status descriptors: dropping/rising/stable
- Arrow symbols for transfers and gravity range
- Cancel button in dialogs
- Irreversibility warning: "This action cannot be undone."
- `OG → SG` in BatchStats
