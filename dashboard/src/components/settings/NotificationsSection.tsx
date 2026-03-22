import { useState, useEffect } from "react";
import { api } from "@/api";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export function NotificationsSection() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);

  // Check current subscription state on mount
  useEffect(() => {
    async function check() {
      try {
        if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
          setEnabled(false);
          setLoading(false);
          return;
        }
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        setEnabled(!!sub);
      } catch {
        setEnabled(false);
      }
      setLoading(false);
    }
    check();
  }, []);

  async function toggle() {
    if (enabled === null) return;
    setLoading(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      if (enabled) {
        // Unsubscribe
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          await api.push.unsubscribe(sub.endpoint);
          await sub.unsubscribe();
        }
        setEnabled(false);
        toast.success("Notifications disabled");
      } else {
        // Subscribe
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          toast.error("Notification permission denied");
          setLoading(false);
          return;
        }
        const { key } = await api.push.vapidKey();
        // Decode base64url to Uint8Array for applicationServerKey
        const raw = key.replace(/-/g, "+").replace(/_/g, "/");
        const pad = raw.length % 4 === 0 ? "" : "=".repeat(4 - (raw.length % 4));
        const binary = atob(raw + pad);
        const keyBytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: keyBytes,
        });
        const json = sub.toJSON();
        await api.push.subscribe({
          endpoint: sub.endpoint,
          keys: {
            p256dh: json.keys!.p256dh!,
            auth: json.keys!.auth!,
          },
        });
        setEnabled(true);
        toast.success("Notifications enabled");
      }
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Couldn't update notification settings");
    }
    setLoading(false);
  }

  const supported = "serviceWorker" in navigator && "PushManager" in window;

  return (
    <div className="flex flex-col gap-2">
      {!supported ? (
        <p className="text-xs text-muted-foreground">
          Push notifications are not supported in this browser.
        </p>
      ) : (
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm">Push Notifications</p>
            <p className="text-xs text-muted-foreground">
              Get alerts for fermentation stalls, temperature issues, and stage suggestions.
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            {enabled && (
              <Button
                size="sm"
                variant="outline"
                disabled={loading}
                onClick={async () => {
                  try {
                    await api.push.test();
                    toast.success("Test notification sent");
                  } catch {
                    toast.error("Couldn't send test notification");
                  }
                }}
              >
                Test
              </Button>
            )}
            <Button
              size="sm"
              variant={enabled ? "outline" : "default"}
              disabled={loading}
            onClick={toggle}
          >
            {loading ? "..." : enabled ? "Disable" : "Enable"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
