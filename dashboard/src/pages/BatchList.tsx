import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/api";
import { useFetch } from "@/hooks/useFetch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import BatchCard from "@/components/BatchCard";
import type { BatchStatus } from "@/types";
import { STATUS_LABELS } from "@/types";

const STATUS_TABS = (["active", "completed", "abandoned", "archived"] as const).map(
  (value) => ({ value, label: STATUS_LABELS[value] }),
);

export default function BatchList() {
  const [status, setStatus] = useState<BatchStatus>("active");
  const { data, loading, error, refetch } = useFetch(
    () => api.batches.list({ status }),
    [status],
  );

  return (
    <div className="p-4 max-w-lg mx-auto">
      <h1 className="text-xl font-bold mb-4">Batches</h1>

      <Tabs value={status} onValueChange={(v) => setStatus(v as BatchStatus)}>
        <TabsList className="w-full">
          {STATUS_TABS.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value} className="flex-1">
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="mt-4 space-y-3">
        {loading && <p className="text-muted-foreground text-sm">Loading...</p>}
        {error && (
          <div className="text-sm text-destructive">
            {error}
            <Button variant="link" size="sm" onClick={refetch}>Retry</Button>
          </div>
        )}
        {data && data.items.length === 0 && (
          <p className="text-muted-foreground text-sm py-8 text-center">
            {status === "active"
              ? "No batches yet. Tap + to start your first batch."
              : `No ${status} batches.`}
          </p>
        )}
        {data?.items.map((batch) => (
          <BatchCard key={batch.id} batch={batch} />
        ))}
      </div>

      <Link to="/batches/new">
        <Button
          size="lg"
          className="fixed bottom-24 right-4 rounded-full w-14 h-14 text-2xl shadow-lg z-40"
        >
          +
        </Button>
      </Link>
    </div>
  );
}
