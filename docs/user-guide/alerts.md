# Alerts

Wine Cellar watches your active batches and warns you when something needs attention. Alerts show up on the dashboard and, if you have push notifications enabled, on your phone or desktop.

Your batches are checked every 15 minutes. When a problem is detected, you get a single alert. When the problem resolves on its own, the alert disappears automatically.

## Alert types

### Stalled fermentation

**What it means:** Gravity has stopped dropping, but your wine has not finished fermenting.

**When it triggers:** The system looks at your last 48 hours of readings and compares them to the last 7 days. A stall alert fires when the current gravity is above 1.005 and either:

- Gravity has barely moved in 48 hours (less than 0.0005 specific gravity per day), or
- The rate of gravity change over the last 48 hours has dropped below 20% of the 7-day average

The batch needs at least 10 readings before stall detection kicks in, so you will not get false alarms from a handful of early data points.

**When it clears:** The alert resolves on its own once fermentation resumes (velocity picks back up) or gravity drops to 1.005 or below.

**What to do:**

- Check the temperature of your fermenter. Cold temperatures are the most common cause of a stall.
- Gently swirl the carboy or bucket to resuspend yeast.
- Consider adding yeast nutrients if you suspect a nutrient deficiency.
- If the batch is stuck well above your target gravity, you may need to pitch fresh yeast.

### Missing readings

**What it means:** Your wireless hydrometer has not sent data in a while.

**When it triggers:** More than 48 hours have passed since the last reading from a batch that has an assigned device (such as a RAPT Pill).

**When it clears:** The alert resolves as soon as a new reading arrives.

**What to do:**

- Check that your hydrometer is still floating and not stuck against the side of the vessel.
- Verify the device has battery life remaining. You can see battery level on the Settings page.
- Make sure the device is within Bluetooth or Wi-Fi range of your network.
- If the device has been removed from the batch intentionally, unassign it on the Settings page to stop the alert.

### High temperature

**What it means:** The latest temperature reading is above the safe range for fermentation.

**When it triggers:** Temperature reaches 30 degrees C or higher.

**When it clears:** The alert resolves once the next reading shows a temperature below 30 degrees C.

**What to do:**

- Move the fermenter to a cooler location or wrap it with a wet towel.
- Consider using a fermentation chamber, ice bath, or air conditioning.
- High temperatures can produce off-flavours and stress the yeast. Act quickly.

### Low temperature

**What it means:** The latest temperature reading is below the safe range for active fermentation.

**When it triggers:** Temperature drops to 8 degrees C or lower.

**When it clears:** The alert resolves once the next reading shows a temperature above 8 degrees C.

**What to do:**

- Move the fermenter to a warmer area or use a heating belt or brew pad.
- Cold temperatures slow yeast activity significantly and can cause a stall.
- If you are deliberately cold-crashing or cold-stabilizing, you can dismiss this alert.

### Stage suggestion

**What it means:** Based on the gravity trend, the system thinks your batch may be ready to move to the next stage.

There are two stage suggestions:

**Primary to secondary:** Fires when gravity drops below 1.020 and the rate of change over the last 48 hours is less than half the 7-day average. In plain terms, fermentation has slowed noticeably and most of the sugar is gone.

**Secondary to stabilization:** Fires when the gravity readings over the last 72 hours vary by less than 0.001 and either gravity is below 1.000 or it is within 0.002 of your target gravity. In plain terms, fermentation has finished.

Both require at least 10 readings before they activate.

**When they clear:** The alert resolves when you advance the batch to the suggested stage, or if conditions change (for example, fermentation speeds back up).

**What to do:**

- Review the gravity chart on the batch detail page to confirm the trend.
- If you agree, tap **Set Stage** on the batch detail page and advance to the next stage.
- If you are not ready to move on (for example, waiting for a diacetyl rest), dismiss the alert.

## How quickly you'll know

Your batches are checked every 15 minutes, so in the worst case there's a 15-minute delay before a new alert appears or a resolved issue clears.

When you open or refresh the app, alerts show up right away. Push notifications are sent the moment a new alert fires.

## Dismissing alerts

Tapping the dismiss button (the X on the dashboard, or "Dismiss" on a push notification) hides the alert from your view. A dismissed alert will not reappear as long as the underlying condition persists.

If the condition resolves and then triggers again later (for example, temperature drops back to normal and then spikes again), the system treats it as a new event and fires a fresh alert.

Dismissing is useful when you are already aware of a situation and taking action, or when you have intentionally created the condition (such as a cold crash triggering a low-temperature alert).

## Getting alerts on your phone

Push notifications deliver alerts to your phone or desktop even when Wine Cellar is not open. Turn them on in Settings under **Push Notifications**.

Every alert type sends a push notification when it first fires. The notification shows the batch name, what's wrong, and a short description. Tap it to jump straight to the batch.

### Stage suggestion action buttons

Stage suggestion notifications include two quick-action buttons:

- **Advance Now** -- Opens the batch and immediately advances to the suggested stage.
- **Dismiss** -- Dismisses the alert without opening the app.

Other alert types open the batch detail page when tapped, where you can review the situation and take action.
