# Learn from past batches and keep your records

## Comparing fermentation curves

The **Compare** page lets you overlay fermentation curves from up to five
batches on a single chart so you can spot differences at a glance.

### Selecting batches

Open the Compare page from the navigation menu. Every active and completed batch
appears as a selectable badge. Tap a badge to add that batch to the chart; tap it
again to remove it. You can select up to five batches at a time. If you need to
swap one out, deselect it first to free a slot.

### How the chart works

Each batch starts its curve at hour zero, regardless of when fermentation
actually began. The system takes every reading for a batch, sorts them by
timestamp, and measures the elapsed hours from the first reading. This
normalization lets you compare a batch that started in September against one from
January on the same horizontal axis.

The vertical axis shows specific gravity (SG). Each batch gets its own colour so
you can trace individual curves through the overlay.

### Archived batches

Archived batches do not appear on the Compare page. The batch list excludes them
by default to keep the selector manageable.

If you need to compare against an archived batch, open that batch's detail page
and change its status back to completed (unarchive it). It will then appear in
the comparison selector. You can re-archive it when you are done.

## Understanding the comparison stats

Below the chart, a table summarizes key metrics for each selected batch. Here is
what each row means and why it matters.

### OG (original gravity)

The first gravity reading recorded for the batch. In winemaking, OG reflects the
sugar concentration of your must and determines the potential alcohol of the
finished wine. Comparing OG across batches tells you whether starting sugar
levels were consistent from year to year.

### Current SG (specific gravity)

The most recent gravity reading. During active fermentation this number drops as
yeast converts sugar to alcohol. For completed batches it represents the final
gravity.

### Estimated ABV

Alcohol by volume, calculated as (OG - SG) x 131.25. This provides a
quick estimate for wines fermenting to dryness. The result may differ slightly
from a lab analysis, but it is reliable for day-to-day monitoring.

### Attenuation

The percentage of available sugar that has been consumed, calculated as
(OG - SG) / (OG - 1.000) x 100. An attenuation near 100% means the wine
fermented to dryness. Lower values can indicate residual sugar, which may be
intentional (off-dry style) or a sign of a stuck fermentation.

### Gravity change (48-hour)

The rate at which gravity dropped over the most recent 48-hour window, shown in
points per day. A negative value means gravity dropped (normal during active
fermentation). A value near zero on a batch that has not reached dryness can
signal a stall.

### Days fermenting

The number of days since the batch's start date. Comparing this across batches
helps you calibrate expectations: if last year's Riesling took 14 days and this
year's has been going for 21, that warrants investigation.

### Estimated days to dry

A projection based on the current 48-hour velocity and a target gravity of
0.996. The system divides the remaining gravity points by the current daily drop
rate. If velocity has slowed or the batch has already reached the target, this
column shows a dash instead.

### Temperature range

The minimum and maximum temperatures recorded across all readings for the batch,
in degrees Celsius. Comparing temperature ranges helps you assess whether
fermentation environment differed between batches, which can explain differences
in fermentation speed or flavour profile.

### Readings

The total number of gravity readings collected for the batch. A batch with very
few readings may have less reliable velocity and projection values.

## Getting your data out

Each batch detail page has a **Download CSV** button. Tap it to get up
to two spreadsheet-ready files — one for readings and one for activities.

### Readings file

The readings file is named `{batch-name}-readings.csv` and contains one row per
gravity reading, sorted oldest to newest.

| Column | Description |
|---|---|
| Timestamp | UTC date and time of the reading |
| Gravity | Specific gravity value |
| Temperature_C | Temperature in Celsius (blank if not recorded) |
| Source | Where the reading came from (for example, `tilt` or `manual`) |

### Activities file

The activities file is named `{batch-name}-activities.csv` and contains one row
per logged activity, sorted oldest to newest.

| Column | Description |
|---|---|
| Timestamp | UTC date and time the activity was recorded |
| Stage | Fermentation stage when the activity occurred |
| Type | Activity type (for example, `addition`, `note`, or `measurement`) |
| Title | Short description of the activity |
| Details | Additional structured data as JSON (blank if none) |

### File format

Both files use standard comma-separated values with a header row. Fields that
contain commas, quotes, or line breaks are enclosed in double quotes. The files
open directly in Excel, Google Sheets, Numbers, or any spreadsheet application.

## When to use comparison

**Vintage review.** After bottling, compare this year's batch against the same
wine from previous years. Overlaying the curves reveals whether fermentation
followed a similar trajectory or diverged. Differences in OG, velocity, or days
to dry can prompt you to revisit your process notes.

**Troubleshooting a slow fermentation.** If a batch seems sluggish, select it
alongside a batch of the same variety that fermented normally. The overlay makes
it easy to see where the curves diverge. Check the temperature range and velocity
columns for clues: a cooler fermentation environment or a steep velocity drop
often explains the difference.

**Comparing varieties or treatments.** If you split a lot into two fermenters
with different yeast strains or nutrient regimens, the comparison chart shows the
effect side by side.

## When to use export

**Record-keeping.** Download your readings and activity logs at the end of each
batch to keep an offline archive. The CSV files serve as a permanent record that
does not depend on the application.

**Sharing data.** If you want to discuss a fermentation curve with another
winemaker or a supplier, the CSV gives them the raw numbers. They can chart it in
a spreadsheet without needing access to your account.

**Further analysis.** Import the CSV into a spreadsheet or statistics tool to run
calculations that go beyond what the dashboard provides, such as plotting gravity
against temperature or computing custom velocity windows.
