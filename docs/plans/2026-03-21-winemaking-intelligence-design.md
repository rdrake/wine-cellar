# Winemaking Intelligence Layer

Three interconnected capabilities layered onto the existing batch management system: stage-aware guidance, projected timelines with alerts, richer batch metadata, and data-informed cellaring intelligence.

## Implementation phases

1. **Batch metadata + activity enrichment** — data foundation
2. **Nudge engine + smart timeline** — read-only intelligence
3. **Timeline-driven alerts** — active intelligence
4. **Cellaring intelligence** — completed batches

## Winemaking knowledge module

All domain knowledge lives in `api/src/lib/winemaking/` as pure functions with no database access. The API consumes these to generate nudges, timeline projections, and cellaring estimates. No winemaking logic in the frontend.

## Data model changes

### New batch fields

| Field | Type | Purpose |
|-------|------|---------|
| `yeast_strain` | text, nullable | e.g. "RC212", "EC-1118", "71B" |
| `oak_type` | text, nullable | "none", "american", "french", "hungarian" |
| `oak_format` | text, nullable | "barrel", "chips", "cubes", "staves", "spiral" |
| `oak_duration_days` | integer, nullable | Days of oak contact |
| `mlf_status` | text, nullable | "not_planned", "pending", "in_progress", "complete" |
| `bottled_at` | text, nullable | ISO timestamp, set when completed from bottling stage |

All optional. No batch creation friction. `bottled_at` is set automatically by the API when a batch is completed while in the `bottling` stage — this anchors cellaring intelligence to actual bottling rather than arbitrary completion.

### Smarter activity details

No schema change. The `details` JSON column already stores flexible data. Changes are in API validation and dashboard forms. Extends existing field conventions rather than replacing them (back-compatible with historical data):

- **Addition activities**: keep existing `chemical`/`amount`/`unit` fields. The API tracks cumulative SO2 across a batch's additions by summing activities where `chemical` matches SO2-related substances.
- **Tasting activities**: add structured sensory fields (`appearance`, `aroma`, `palate`, `finish`, `overall_score` 1-5) alongside existing `flavor` field. All optional.
- **Measurement activities**: extend the metric options to include `free_so2`, `total_so2`, `ta`, `ph` alongside the existing `SG`. Only `SG` measurements auto-create linked readings (existing behaviour preserved).

## Stage-aware nudges

### How they work

When the API returns a batch detail, it runs the batch through a nudge engine that evaluates current state and returns relevant guidance. Nudges are computed on the fly, not stored in the database.

### Nudge structure

```ts
{
  id: string,          // deterministic, so the UI can track dismissals
  priority: "info" | "warning" | "action",
  message: string,     // "Punch down the cap twice daily"
  detail?: string,     // "Morning and evening. Extracts color and tannin..."
  stage: string,       // which stage it applies to
}
```

Dismissals stored client-side in localStorage. Nudges are tips, not alerts.

### Example nudges (red from fresh grapes)

| Stage | Priority | Nudge |
|-------|----------|-------|
| must_prep | action | "Add SO2 at crushing - {dose}mg for your {volume}L batch" |
| must_prep | info | "Take Brix, TA, and pH readings before pitching yeast" |
| primary | info | "Punch down the cap at least twice daily" |
| primary | warning | "Temp is {temp}C - stay under 29C to avoid killing yeast" (data-driven) |
| primary | action | "Consider pressing when SG reaches ~1.010" (when SG is close) |
| secondary | info | "MLF not started - consider inoculating if you want softer acidity" (if mlf_status is pending/null) |
| stabilization | action | "Add SO2 before racking - {dose}mg for your volume and pH" |
| bottling | action | "Final checks: SG below 0.998, free SO2 at 25-35 ppm, taste is clean" |

The nudge engine is a series of small functions, each evaluating one condition and returning a nudge or null.

## Smart timeline

### How it works

A projection engine takes the batch's current state (stage, readings history, wine type, source material, MLF status, activities) and generates upcoming milestones with estimated dates.

### Milestone structure

```ts
{
  label: string,           // "First racking"
  estimated_date: string,  // ISO date
  basis: string,           // "~3 weeks after primary ends"
  confidence: "firm" | "estimated" | "rough",
  completed?: boolean,     // true if a matching activity exists
}
```

### Projection logic (fall-harvest red from fresh grapes)

Starting from current stage and working forward:

- **End of primary**: Extrapolate from gravity velocity. If no readings, use typical duration (5-10 days for reds).
- **Pressing**: Same day as end of primary, or end of extended maceration window.
- **MLF completion**: If in progress, 4-8 weeks after inoculation. If not planned, skip.
- **First racking**: After secondary completes (~2-3 weeks after fermentation ends for kits, late Oct/Nov for fall harvest).
- **Second racking**: 2-3 months after first.
- **Third racking**: 3 months after second.
- **Earliest bottling**: 3 months after last racking for light whites, 6-12 months for full reds.

As activities get logged, milestones flip to `completed` and downstream dates recalculate.

### UI

A vertical timeline section in the batch detail view, below the readings chart.

## Timeline-driven alerts

The cron job computes timeline milestones and fires alerts when dates arrive. Alert messages are embedded in `context.message` for push notification rendering.

### Alert identity

Milestone-based alerts use numbered alert types to distinguish sequential milestones within the same category (e.g. `racking_due_1`, `racking_due_2`, `racking_due_3`). This fits the existing `(user, batch, alert_type)` dedup model without schema changes.

### Alert types

| Alert Type | Trigger | Auto-resolves when |
|------------|---------|-------------------|
| `racking_due_1` | First racking date reached | Racking activity logged |
| `racking_due_2` | Second racking date reached | Second racking activity logged |
| `racking_due_3` | Third racking date reached | Third racking activity logged |
| `mlf_check` | 4 weeks after MLF inoculation activity | `mlf_status` set to "complete" |
| `bottling_ready` | Earliest bottling date reached | Batch completed with `bottled_at` set |
| `so2_due` | 6 weeks since last SO2 addition or since last racking with no SO2 logged | SO2 addition activity logged |

Same mechanics as existing alerts: dismissible, one active per (user, batch, alert_type), auto-resolves when condition clears.

### Schema change

The `alert_type` CHECK constraint in `alert_state` must be updated to accept the new types. Migration adds: `racking_due_1`, `racking_due_2`, `racking_due_3`, `mlf_check`, `bottling_ready`, `so2_due`.

## Cellaring intelligence

### When it activates

Once a batch has `bottled_at` set (not just `completed` status). A "Cellaring" card appears on the batch detail view replacing the readings chart and timeline.

### What it shows

- **Drink window**: "2027-2031" (ready to enjoy through past peak)
- **Current status**: "Aging - will be drinking well in ~14 months"
- **Storage note**: "Store on side at 12-16C, dark and still"

### Base window by profile

| Profile | Ready | Peak | Past Peak |
|---------|-------|------|-----------|
| Kit white/rose | 1 mo | 3-6 mo | 12 mo |
| Kit red | 3 mo | 6-12 mo | 24 mo |
| Juice bucket white | 2 mo | 6-12 mo | 18 mo |
| Fresh grape white, no oak | 3 mo | 6-12 mo | 24 mo |
| Fresh grape white, oaked | 6 mo | 12-24 mo | 36 mo |
| Fresh grape light red | 6 mo | 12-36 mo | 60 mo |
| Fresh grape full red, oaked | 12 mo | 24-60 mo | 120+ mo |

### Data-informed adjustments

Adjustments shift the window multiplicatively:

- **Low total SO2** (< 30 ppm at bottling): shorten by 25%
- **High pH** (> 3.6): shorten by 20%
- **Oak aging > 6 months**: extend by 20%
- **MLF completed**: extend by 15% for reds
- **High attenuation + low final gravity**: slight extension

The app shows the adjusted window and a one-line explanation of the biggest factor: "Shortened slightly - pH was 3.7 at bottling, keep an eye on it."
