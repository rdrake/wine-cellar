export default function DeviceSection({ batchId: _batchId, batchStatus: _batchStatus, onAssignmentChange: _onAssignmentChange }: { batchId: string; batchStatus: string; onAssignmentChange: () => void }) {
  return <section><h2 className="font-semibold mb-2">Device</h2><p className="text-sm text-muted-foreground">Loading...</p></section>;
}
