# Where is my wine, and what can I do next?

Every batch tracks two things: **what step the wine is at** (the stage) and **whether you're still working on it** (the status). Understanding how they work together helps you stay organized.

## Stage vs. status

**Stage** is where the wine is in the process — must prep, primary fermentation, secondary fermentation, stabilization, or bottling. You advance it as the wine progresses.

**Status** is whether the batch is still in play:

- **Active** — work in progress. You can log entries, record readings, and change the stage.
- **Completed** — the wine is done. No more changes.
- **Archived** — a completed batch tucked away to keep your dashboard clean.
- **Abandoned** — a batch you stopped working on (stuck fermentation, contamination, or just didn't work out).

Only active batches accept new readings and stage changes. Once a batch is completed, abandoned, or archived, its timeline is frozen.

## The five stages of winemaking

Each batch starts at **Must Prep** and works forward through the stages in order. You can also jump back if needed (for example, returning to primary fermentation after an unexpected restart).

### Must Prep

Covers receiving fruit or juice, crushing, and preparing the must. This stage includes the activity stages **Receiving**, **Crushing**, and **Must Prep**.

Use this stage while you are adjusting sugar, acid, and sulphite levels before pitching yeast.

### Primary Fermentation

The main fermentation where yeast converts sugar to alcohol. Includes the activity stages **Primary Fermentation** and **Pressing**.

Most gravity and temperature monitoring happens here. Stage suggestions (see below) watch for slowing fermentation and recommend moving to secondary when the gravity drops below 1.020.

### Secondary Fermentation

A quieter phase where fermentation finishes and flavours begin to develop. Includes the activity stages **Secondary Fermentation** and **Malolactic**.

If you are doing malolactic fermentation, it runs during this waypoint. Stage suggestions watch for stable gravity and recommend moving to stabilization when the gravity holds steady for 72 hours.

### Stabilization

Post-fermentation treatments before bottling. This waypoint covers the most ground, with activity stages **Stabilization**, **Fining**, **Bulk Aging**, **Cold Stabilization**, and **Filtering**.

Work through whichever of these steps your wine needs. Not every wine requires all of them.

### Bottling

The final waypoint. Includes the activity stages **Bottling** and **Bottle Aging**.

Once bottled, you can continue tracking bottle aging here before completing the batch.

## Which steps are available at each stage

When you log something, you pick the specific step you're at. The steps available depend on the current stage:

| Waypoint | Allowed activity stages |
|---|---|
| Must Prep | Receiving, Crushing, Must Prep |
| Primary Fermentation | Primary Fermentation, Pressing |
| Secondary Fermentation | Secondary Fermentation, Malolactic |
| Stabilization | Stabilization, Fining, Bulk Aging, Cold Stabilization, Filtering |
| Bottling | Bottling, Bottle Aging |

## Timeline card

The batch detail page includes a **Timeline** card that gives you a visual overview of the winemaking journey. It shows:

- **Current phase**: the stage your wine is in now, with a day counter (for example, "Day 4 of ~14" during primary fermentation) and a progress bar when an estimated duration is available.
- **Projected milestones**: upcoming transitions such as "Secondary Fermentation" and "Stabilization" with relative dates (for example, "in six days" or "in about two months"). Completed milestones appear dimmed, showing a checkmark and the date they occurred.

The timeline milestones are estimates based on your batch's start date and typical winemaking timelines. As your batch progresses and readings come in, the projections adjust.

Stage suggestions also surface through the timeline. When Wine Cellar detects that your gravity readings point to a stage change, the corresponding milestone reflects that recommendation. You can act on the suggestion from the notification or advance manually using **Set Stage**.

## Moving to the next step

Open the batch detail page and use the **Set Stage** dropdown. Pick where the wine is headed and tap **Set Stage**.

A few things to know:

- You can jump to any stage, not just the next one. Need to skip secondary or jump back to an earlier step? The dropdown lets you choose freely.
- Each stage change logs an activity note automatically, so your timeline records when the transition happened.
- Only active batches can change stages. If a batch has been completed or abandoned, you need to reopen it first.

## When the wine is done

When your wine is bottled, labelled, and ready to drink (or age), tap **Complete**. This:

- Sets the status to **Completed** and records the completion date.
- Unassigns any monitoring device attached to the batch, freeing it for use with another batch.
- Prevents further stage changes or new readings.

You can still view all historical readings, activities, and charts on a completed batch.

## When a batch doesn't work out

Sometimes a batch fails — stuck fermentation, off flavours, contamination, or you just decide to dump it. Tap **Abandon** to mark it as a loss. This:

- Sets the status to **Abandoned**.
- Unassigns any monitoring device, just like completing does.
- Unlocks the ability to permanently delete the batch (see below).

Abandon requires confirmation because the action signals that the wine is a loss.

## Keeping your dashboard clean

Once a batch is completed, tap **Archive** to tuck it away. Archived batches:

- Don't clutter your batch list unless you specifically filter for them.
- Keep all their data (readings, activities, charts) and can be viewed any time.

This keeps your dashboard focused on the batches that still need attention.

## Changed your mind?

- **Reopen** a completed or abandoned batch to set it back to **Active**. This clears the completion date and lets you resume logging activities, recording readings, and changing stages. The reopen button appears on the batch detail page for completed and abandoned batches.
- **Unarchive** an archived batch to return it to **Completed** status. From there, you can reopen it to active if needed.

## Deleting a batch for good

You can permanently delete a batch, but only under certain conditions:

- **Abandoned batches** can always be deleted, regardless of whether they have readings or activities. All associated data is removed.
- **Completed or archived batches** can only be deleted if they have no readings and no activities. If they have data, you need to abandon the batch first.

Active batches cannot be deleted. Complete or abandon them first.

Deletion is permanent and cannot be undone. The app asks for confirmation before proceeding.

## What about my RAPT Pill?

When a batch stops being active (whether completed, abandoned, or archived), any device attached to it is automatically freed up so you can use it on your next batch.

If you reopen a batch later, you'll need to reassign the device — it doesn't reconnect automatically.

## Stage suggestions

If you have push notifications enabled and a monitoring device assigned, the alert system analyses your readings and suggests stage transitions:

- **Primary to Secondary**: When gravity drops below 1.020 and the fermentation rate has slowed to less than half its 7-day average, the system suggests moving to secondary fermentation.
- **Secondary to Stabilization**: When gravity holds within a 0.001 range over 72 hours and is either below 1.000 or within 0.002 of your target gravity, the system suggests moving to stabilization.

These suggestions arrive as push notifications. You can act on them directly from the notification or dismiss them from the batch detail page. The system does not make stage changes automatically -- you always decide when to advance.
