import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ActivityType } from "@/types";

export default function DetailFields({ type, details, onChange }: {
  type: ActivityType;
  details: Record<string, string>;
  onChange: (details: Record<string, string>) => void;
}) {
  function set(key: string, value: string) {
    onChange({ ...details, [key]: value });
  }

  switch (type) {
    case "addition":
      return (
        <>
          <div className="space-y-2">
            <Label>What was added?</Label>
            <Input value={details.chemical ?? ""} onChange={(e) => set("chemical", e.target.value)} required />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Amount</Label>
              <Input type="number" step="0.01" value={details.amount ?? ""} onChange={(e) => set("amount", e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label>Unit</Label>
              <Input value={details.unit ?? ""} placeholder="tsp, g, mL" onChange={(e) => set("unit", e.target.value)} required />
            </div>
          </div>
        </>
      );
    case "measurement":
      return (
        <>
          <div className="space-y-2">
            <Label>What are you measuring?</Label>
            <Select value={details.metric ?? ""} onValueChange={(v) => v && set("metric", v)}>
              <SelectTrigger><SelectValue placeholder="Choose a measurement" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="SG">Specific Gravity (SG)</SelectItem>
                <SelectItem value="pH">pH</SelectItem>
                <SelectItem value="TA">Titratable Acidity (TA)</SelectItem>
                <SelectItem value="SO2">Free SO2</SelectItem>
                <SelectItem value="Brix">Brix</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {details.metric === "other" && (
            <div className="space-y-2">
              <Label>Custom metric name</Label>
              <Input value={details.metric_name ?? ""} onChange={(e) => set("metric_name", e.target.value)} required />
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Reading</Label>
              <Input type="number" step="0.001" value={details.value ?? ""} onChange={(e) => set("value", e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label>Unit</Label>
              <Input value={details.unit ?? ""} placeholder={details.metric === "SG" || details.metric === "pH" ? "optional" : "g/L, ppm, etc."} onChange={(e) => set("unit", e.target.value)} />
            </div>
          </div>
        </>
      );
    case "racking":
      return (
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>From Vessel</Label>
            <Input value={details.from_vessel ?? ""} onChange={(e) => set("from_vessel", e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label>To Vessel</Label>
            <Input value={details.to_vessel ?? ""} onChange={(e) => set("to_vessel", e.target.value)} required />
          </div>
        </div>
      );
    case "tasting":
      return (
        <>
          <div className="space-y-2">
            <Label>Aroma</Label>
            <Input value={details.aroma ?? ""} onChange={(e) => set("aroma", e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label>Flavor</Label>
            <Input value={details.flavor ?? ""} onChange={(e) => set("flavor", e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label>Appearance</Label>
            <Input value={details.appearance ?? ""} onChange={(e) => set("appearance", e.target.value)} required />
          </div>
        </>
      );
    case "adjustment":
      return (
        <>
          <div className="space-y-2">
            <Label>What are you adjusting?</Label>
            <Input value={details.parameter ?? ""} onChange={(e) => set("parameter", e.target.value)} required />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Before</Label>
              <Input type="number" step="0.01" value={details.from_value ?? ""} onChange={(e) => set("from_value", e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label>After</Label>
              <Input type="number" step="0.01" value={details.to_value ?? ""} onChange={(e) => set("to_value", e.target.value)} required />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Unit</Label>
            <Input value={details.unit ?? ""} onChange={(e) => set("unit", e.target.value)} required />
          </div>
        </>
      );
    case "note":
      return null;
  }
}
