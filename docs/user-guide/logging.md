# Recording what you did

Every action you take on a batch — adding sulfite, checking gravity, racking to a new vessel — can be logged with all the details that matter. Over time, these entries build a complete record of your winemaking process, and SG measurements feed directly into the fermentation chart.

This guide covers how to log, backdate, edit, and delete entries, and explains what each type records.

## Logging something

Open a batch's detail page and tap **+ Log Activity**. The form has four fields that appear every time, plus extra fields that change based on the type you pick.

**Common fields:**

| Field | Description |
|-------|-------------|
| Stage | The winemaking stage this activity belongs to (see [available stages](#cant-find-the-stage-you-need) below) |
| Type | One of six activity types: Addition, Measurement, Racking, Tasting, Adjustment, or Note |
| Title | A short description, such as "Pitched EC-1118" or "Post-MLF pH check" |
| Recorded At | When the activity happened — defaults to now, but you can backdate it |

Fill in the fields and tap **Log Activity** to save.

## What you can log

### Addition

Record when you add a substance to the wine.

**Detail fields:**

| Field | Description |
|-------|-------------|
| What was added? | The name of the chemical, nutrient, or additive (e.g., "K2S2O5", "Go-Ferm", "oak chips") |
| Amount | Numeric quantity |
| Unit | The unit of measure (tsp, g, mL, etc.) |

**Example entries:**

- *Title:* "Added potassium metabisulfite" / *Chemical:* K2S2O5 / *Amount:* 0.5 / *Unit:* tsp
- *Title:* "Pitched yeast nutrient" / *Chemical:* Fermaid-O / *Amount:* 3 / *Unit:* g
- *Title:* "Added oak cubes" / *Chemical:* Medium toast French oak / *Amount:* 30 / *Unit:* g

### Measurement

Record a lab or hydrometer reading. Choose from several built-in metrics, or select "Other" and enter a custom metric name.

**Detail fields:**

| Field | Description |
|-------|-------------|
| What are you measuring? | SG, pH, Titratable Acidity (TA), Free SO2, Brix, or Other |
| Custom metric name | Only shown when "Other" is selected |
| Reading | The numeric value |
| Unit | Optional for SG and pH; enter g/L, ppm, etc. for other metrics |

**Which measurements show up on the fermentation chart?**

Only **SG (specific gravity)** readings appear on the gravity chart and update the snapshot stats (current SG, ABV, attenuation, velocity). When you log an SG measurement, Wine Cellar adds a data point to the chart at that timestamp.

All other metrics — pH, TA, Free SO2, Brix, and custom metrics — are saved in your activity log but don't appear on the chart.

**Example entries:**

- *Title:* "Day 3 gravity check" / *Metric:* SG / *Reading:* 1.055 — This value appears on the fermentation chart as a manual reading.
- *Title:* "Pre-bottling SO2" / *Metric:* Free SO2 / *Reading:* 28 / *Unit:* ppm — Recorded in the activity log only.
- *Title:* "Post-MLF acidity" / *Metric:* TA / *Reading:* 5.8 / *Unit:* g/L
- *Title:* "Initial Brix reading" / *Metric:* Brix / *Reading:* 24.5

### Racking

Record when you transfer wine from one vessel to another.

**Detail fields:**

| Field | Description |
|-------|-------------|
| From Vessel | The vessel you are transferring out of (e.g., "Primary fermenter") |
| To Vessel | The vessel you are transferring into (e.g., "6-gallon carboy") |

**Example entries:**

- *Title:* "Racked off primary lees" / *From:* Primary fermenter / *To:* 23 L carboy
- *Title:* "Racked for bulk aging" / *From:* 23 L carboy / *To:* 54 L oak barrel

### Tasting

Record sensory evaluation notes.

**Detail fields:**

| Field | Description |
|-------|-------------|
| Aroma | What you smell (e.g., "Fruity, slight H2S") |
| Flavour | What you taste (e.g., "Tart, thin body, needs time") |
| Appearance | What you see (e.g., "Hazy, deep ruby") |

**Example entries:**

- *Title:* "2-week tasting" / *Aroma:* Dark fruit, slight reduction / *Flavour:* Dry, moderate tannin / *Appearance:* Opaque, dark purple
- *Title:* "Pre-bottling tasting" / *Aroma:* Clean, cherry and spice / *Flavour:* Balanced acid, soft tannins / *Appearance:* Clear, ruby red

### Adjustment

Record when you intentionally change a measurable parameter, capturing both the before and after values.

**Detail fields:**

| Field | Description |
|-------|-------------|
| What are you adjusting? | The parameter name (e.g., "pH", "Free SO2", "Temperature") |
| Before | The value before the adjustment |
| After | The value after the adjustment |
| Unit | The unit of measure |

**Example entries:**

- *Title:* "Acid adjustment with tartaric" / *Parameter:* pH / *Before:* 3.72 / *After:* 3.55 / *Unit:* pH
- *Title:* "Sulfite top-up" / *Parameter:* Free SO2 / *Before:* 18 / *After:* 35 / *Unit:* ppm
- *Title:* "Cold crash" / *Parameter:* Temperature / *Before:* 18 / *After:* 2 / *Unit:* C

### Note

Record observations, reminders, or anything that does not fit the other types.

**Detail fields:**

| Field | Description |
|-------|-------------|
| Note | Free-form text area for your observations |

**Example entries:**

- *Title:* "Fermentation observation" / *Note:* "Vigorous bubbling started around 8 AM, cap forming well. Punched down twice today."
- *Title:* "Reminder" / *Note:* "Check SO2 levels before next racking. Order more carboys."

## Backdating

The **Recorded At** field defaults to the current date and time. To log something after the fact, change this field to the date and time the activity actually happened.

Backdating is common when you forget to log an activity at the time, or when you prefer to do all your record-keeping in one sitting at the end of the day. The timestamp you enter determines where the activity appears in the timeline and, for SG measurements, where the data point appears on the fermentation chart.

## Fixing a mistake

Tap **Edit** on any entry in the timeline. You can change:

- **Title** — Update the description
- **Recorded At** — Correct the timestamp
- **Detail fields** — Modify any of the type-specific values

The activity type and stage cannot be changed after creation. If you need to change either, delete the activity and create a new one.

When you edit an SG measurement activity, the linked reading on the fermentation chart updates automatically to reflect the new value and timestamp.

## Removing an entry

Tap **Delete** on any entry. You'll be asked to confirm because this can't be undone.

If the entry was an SG measurement, its data point is also removed from the fermentation chart and snapshot calculations.

## Can't find the stage you need?

Each entry needs a stage, and the stages available depend on where your batch is in the process. This keeps things organized — you won't accidentally log a bottling entry on a batch that hasn't been stabilized yet.

| Waypoint | Available stages |
|----------|-----------------|
| Must Preparation | Receiving and Inspection, Crushing and Destemming, Must Preparation |
| Primary Fermentation | Primary Fermentation, Pressing |
| Secondary Fermentation | Secondary Fermentation, Malolactic Fermentation |
| Stabilization | Stabilization and Degassing, Fining and Clarification, Bulk Aging, Cold Stabilization, Filtering |
| Bottling | Bottling, Bottle Aging |

If the stage you need isn't listed, first move the batch to the right step using the **Set Stage** dropdown on the batch detail page.

## Seeing your work on the chart

Every entry shows up as a dashed vertical line on the fermentation chart, colour-coded by type. This makes it easy to see how your actions (an addition, a racking) line up with changes in the gravity curve.

Only SG measurements add actual data points to the chart. If you use a RAPT Pill, device readings appear as a solid line, while your manual SG entries appear as a dashed line with dots.
