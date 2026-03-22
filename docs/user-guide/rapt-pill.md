# RAPT Pill hydrometer setup

The RAPT Pill is a wireless floating hydrometer made by KegLand. Drop it in your fermenter and it measures specific gravity and temperature every 15 minutes — no more opening the lid to take a reading.

Once connected to Wine Cellar, your RAPT Pill's readings show up automatically on your batch's fermentation chart. No manual logging needed.

## Connecting your RAPT Pill

You only need to do this once. The RAPT Pill sends readings to the RAPT Portal cloud service, and a webhook forwards them to Wine Cellar. Here's how to set it up:

1. Log in to the RAPT Portal at [app.rapt.io](https://app.rapt.io).
2. Navigate to the webhook settings for your device.
3. Set the webhook URL to:

   ```
   https://<your-api-domain>/webhook/rapt
   ```

   Replace `<your-api-domain>` with your Wine Cellar API address.

4. Add a security header so Wine Cellar can verify the readings are genuine: set the header name to `X-Webhook-Token` and the value to the shared secret token provided by your Wine Cellar administrator.
5. Save the webhook configuration.

The RAPT Portal will now send each reading to Wine Cellar as it arrives.

## Waiting for the first reading

After saving the webhook, give it up to 15 minutes for the RAPT Pill to send its next reading. Wine Cellar picks up the device automatically the first time data arrives — you don't need to create anything manually.

If the Sensors section in Settings still shows "No sensors registered" after 15 minutes, the webhook hasn't connected yet. Check the troubleshooting section below.

## Claiming your device

When the first reading arrives, Wine Cellar registers the device but doesn't know who it belongs to yet. Claiming it links it to your account.

1. Open Wine Cellar and go to the **Settings** page.
2. Scroll to the **Claim Device** section.
3. Enter the device ID shown in the RAPT Portal (for example, `pill-abc-123`).
4. Tap **Claim**.

Once claimed, the device appears in your Sensors list. Claiming also links any readings the device has already sent to your account.

## Telling it which batch to watch

After claiming, the device shows as "Idle" in your Sensors list. To start getting automatic readings on a batch:

1. In the **Sensors** section, tap **Assign** next to your device.
2. In the dialog that appears, select an active batch from the dropdown.
3. Tap **Assign** to confirm.

New readings will now be linked to that batch automatically. The batch detail page will show gravity and temperature on its chart, and the snapshot section will update with the latest values.

### You won't lose earlier readings

Didn't assign the device right away? No problem. When you assign it, Wine Cellar goes back and attaches any readings the device sent since the batch's start date. So if you started the batch on Monday and assigned the device on Wednesday, you still get Monday and Tuesday's data.

Readings from before the batch's start date are left out, since they belong to a different fermentation.

## Moving a device between batches

A single RAPT Pill can only monitor one batch at a time. To move it to a different batch:

1. In the **Sensors** section of Settings, tap **Unassign** next to the device.
2. The device returns to "Idle" status. Readings already linked to the previous batch stay linked.
3. Tap **Assign** and select the new batch.

Any unlinked readings recorded after the new batch's start date will be backfilled to it.

## Understanding device indicators

Each device card in Settings shows its latest sensor data.

### Battery level

The battery percentage shows how much charge remains in the RAPT Pill. The colour changes based on the level:

- **Green** (above 50%) — Healthy charge.
- **Yellow** (20% to 50%) — Consider charging soon.
- **Red** (below 20%) — Charge the device before it stops transmitting.

### Signal strength

Signal strength reflects the Wi-Fi connection quality between the RAPT Pill's Bluetooth gateway and your network. Readings are shown as a label:

- **Excellent** — Strong, reliable connection.
- **Good** — Normal operation, no issues expected.
- **Fair** — Weaker signal. Readings may occasionally be delayed.
- **Weak** — Poor connection. Consider moving the device or its gateway closer to your router.

### Last reading time

The timestamp shows how long ago the most recent reading arrived. Under normal operation, you should see a new reading roughly every 15 minutes.

## When a batch is done

When you complete or abandon a batch, Wine Cellar automatically frees the device so you can use it on your next batch. It goes back to "Idle" and stops linking readings to the old batch.

If you reopen a batch later, you'll need to reassign the device — reopening doesn't restore the previous assignment.

## Troubleshooting

### Device does not appear in Settings

- **The webhook has not delivered a reading yet.** Wine Cellar only registers a device when it receives the first reading. Verify that the webhook URL and token are correct in the RAPT Portal.
- **The device is registered but not claimed.** Unclaimed devices do not appear in your Sensors list. Use the Claim Device section with the correct device ID.

### No new readings are arriving

- **Check the RAPT Portal.** Confirm that your RAPT Pill is online and sending readings to the portal.
- **Verify the webhook URL.** Ensure the URL points to your Wine Cellar API and includes the `/webhook/rapt` path.
- **Check the webhook token.** The `X-Webhook-Token` header value in the RAPT Portal must match the token configured on the Wine Cellar server exactly, including capitalization and spacing.
- **Battery may be depleted.** Check the last known battery level. If the Pill's battery is dead, it will stop transmitting entirely.

### Claiming fails with "Device not found"

- **The device has not sent a reading yet.** The Pill must have delivered at least one reading before you can claim it. Wait for the first reading to arrive.
- **Another user already claimed it.** Each device can only be claimed by one user. If someone else claimed it first, the device will not appear as available.
- **Check the device ID.** Make sure you are entering the exact ID shown in the RAPT Portal, including any hyphens or special characters.

### Readings are not showing on my batch

- **The device is not assigned to the batch.** Check the Sensors section in Settings and assign the device if it shows as "Idle."
- **Readings arrived before assignment.** Readings that arrived while the device was unassigned are backfilled when you assign it, but only those recorded on or after the batch's start date. If your batch start date is later than when the readings were taken, they will not be linked.

### Alerts are not firing

For alerts to work, all of the following must be true:

- The device is claimed (linked to your account).
- The device is assigned to an active batch.
- Push notifications are enabled in Settings.
