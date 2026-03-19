export default function ActivitySection({ batchId: _batchId, batchStatus: _batchStatus }: { batchId: string; batchStatus: string }) {
  return <section><h2 className="font-semibold mb-2">Activities</h2><p className="text-sm text-muted-foreground">Loading...</p></section>;
}
