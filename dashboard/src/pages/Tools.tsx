import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function useField(initial: string) {
  const [value, setValue] = useState(initial);
  const num = parseFloat(value);
  return { value, set: (e: React.ChangeEvent<HTMLInputElement>) => setValue(e.target.value), num, ok: !isNaN(num) && value !== "" };
}

function Result({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="flex justify-between items-baseline">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-semibold tabular-nums">
        {value}
        {unit && <span className="text-xs font-normal text-muted-foreground ml-0.5">{unit}</span>}
      </span>
    </div>
  );
}

function Field({ id, label, step, ...props }: { id: string; label: string; step: string; value: string; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void }) {
  return (
    <div>
      <Label htmlFor={id} className="text-xs">{label}</Label>
      <Input id={id} type="number" step={step} inputMode="decimal" className="mt-0.5" {...props} />
    </div>
  );
}

// ─── ABV Calculator ────────────────────────────────────────────────

function ABVCalculator() {
  const og = useField("1.090");
  const fg = useField("0.996");

  const abv = og.ok && fg.ok ? (og.num - fg.num) * 131.25 : null;
  const att = og.ok && fg.ok && og.num > 1
    ? ((og.num - fg.num) / (og.num - 1)) * 100
    : null;

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <h2 className="font-heading font-semibold">ABV</h2>
        <div className="grid grid-cols-2 gap-3">
          <Field id="abv-og" label="Original Gravity" step="0.001" value={og.value} onChange={og.set} />
          <Field id="abv-fg" label="Final Gravity" step="0.001" value={fg.value} onChange={fg.set} />
        </div>
        {abv !== null && abv >= 0 && (
          <div className="border-t pt-2 space-y-0.5">
            <Result label="ABV" value={abv.toFixed(1)} unit="%" />
            {att !== null && att >= 0 && <Result label="Apparent Attenuation" value={att.toFixed(0)} unit="%" />}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Chaptalization Calculator ─────────────────────────────────────

function ChaptalizationCalculator() {
  const vol = useField("23");
  const current = useField("1.050");
  const target = useField("1.080");

  // ~2.65 g sucrose per liter per gravity point
  const pts = current.ok && target.ok ? (target.num - current.num) * 1000 : null;
  const sugar = pts !== null && pts > 0 && vol.ok ? vol.num * pts * 2.65 : null;

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <h2 className="font-heading font-semibold">Chaptalization</h2>
        <p className="text-xs text-muted-foreground">Sugar addition to raise specific gravity</p>
        <div className="grid grid-cols-3 gap-3">
          <Field id="chap-vol" label="Volume (L)" step="0.1" value={vol.value} onChange={vol.set} />
          <Field id="chap-cur" label="Current SG" step="0.001" value={current.value} onChange={current.set} />
          <Field id="chap-tgt" label="Target SG" step="0.001" value={target.value} onChange={target.set} />
        </div>
        {sugar !== null && (
          <div className="border-t pt-2 space-y-0.5">
            <Result
              label="Table Sugar"
              value={sugar >= 1000 ? (sugar / 1000).toFixed(2) : sugar.toFixed(0)}
              unit={sugar >= 1000 ? "kg" : "g"}
            />
            <Result label="Gravity Points" value={`+${pts!.toFixed(0)}`} />
          </div>
        )}
        {pts !== null && pts <= 0 && (
          <p className="text-xs text-muted-foreground border-t pt-2">
            Target must be higher than current SG.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Sulfite Calculator ────────────────────────────────────────────

function SulfiteCalculator() {
  const vol = useField("23");
  const ph = useField("3.40");
  const target = useField("30");
  const current = useField("0");

  const delta = target.ok && current.ok ? target.num - current.num : null;
  // KMS is 57.6% SO₂ by weight; 1 ppm = 1 mg/L
  const kms = delta !== null && delta > 0 && vol.ok ? (delta * vol.num) / 576 : null;
  // Molecular SO₂ = free SO₂ / (1 + 10^(pH − 1.81))
  const molSO2 = ph.ok && target.ok
    ? target.num / (1 + Math.pow(10, ph.num - 1.81))
    : null;

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <h2 className="font-heading font-semibold">Sulfite Addition</h2>
        <p className="text-xs text-muted-foreground">Potassium metabisulfite (KMS) dosing</p>
        <div className="grid grid-cols-2 gap-3">
          <Field id="so2-vol" label="Volume (L)" step="0.1" value={vol.value} onChange={vol.set} />
          <Field id="so2-ph" label="pH" step="0.01" value={ph.value} onChange={ph.set} />
          <Field id="so2-tgt" label="Target Free SO₂ (ppm)" step="1" value={target.value} onChange={target.set} />
          <Field id="so2-cur" label="Current Free SO₂ (ppm)" step="1" value={current.value} onChange={current.set} />
        </div>
        {kms !== null && (
          <div className="border-t pt-2 space-y-0.5">
            <Result label="KMS to Add" value={kms.toFixed(2)} unit="g" />
            {molSO2 !== null && (
              <>
                <Result label="Molecular SO₂" value={molSO2.toFixed(2)} unit="ppm" />
                <p className="text-xs text-muted-foreground pt-1">
                  Target: 0.5–0.8 ppm molecular SO₂
                </p>
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Hydrometer Temperature Correction ─────────────────────────────

// Standard correction table for sugar solutions, calibrated at 20 °C.
// Values are SG points to add at each temperature.
const TEMP_CORRECTIONS: [number, number][] = [
  [0, -0.0017], [5, -0.0014], [10, -0.0008], [15, -0.0003],
  [20, 0.0000], [25, 0.0011], [30, 0.0025], [35, 0.0041], [40, 0.0060],
];

function tempCorrection(t: number): number {
  if (t <= TEMP_CORRECTIONS[0][0]) return TEMP_CORRECTIONS[0][1];
  if (t >= TEMP_CORRECTIONS[TEMP_CORRECTIONS.length - 1][0]) return TEMP_CORRECTIONS[TEMP_CORRECTIONS.length - 1][1];
  for (let i = 0; i < TEMP_CORRECTIONS.length - 1; i++) {
    const [t0, c0] = TEMP_CORRECTIONS[i];
    const [t1, c1] = TEMP_CORRECTIONS[i + 1];
    if (t >= t0 && t <= t1) return c0 + ((c1 - c0) * (t - t0)) / (t1 - t0);
  }
  return 0;
}

function TempCorrectionCalculator() {
  const sg = useField("1.050");
  const temp = useField("25");
  const cal = useField("20");

  const corrected = sg.ok && temp.ok && cal.ok
    ? sg.num + tempCorrection(temp.num) - tempCorrection(cal.num)
    : null;
  const delta = corrected !== null ? corrected - sg.num : null;

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <h2 className="font-heading font-semibold">Hydrometer Correction</h2>
        <p className="text-xs text-muted-foreground">Correct SG reading for sample temperature</p>
        <div className="grid grid-cols-3 gap-3">
          <Field id="tc-sg" label="Observed SG" step="0.001" value={sg.value} onChange={sg.set} />
          <Field id="tc-temp" label="Sample °C" step="0.5" value={temp.value} onChange={temp.set} />
          <Field id="tc-cal" label="Cal. °C" step="0.5" value={cal.value} onChange={cal.set} />
        </div>
        {corrected !== null && (
          <div className="border-t pt-2 space-y-0.5">
            <Result label="Corrected SG" value={corrected.toFixed(4)} />
            {delta !== null && (
              <Result
                label="Correction"
                value={`${delta >= 0 ? "+" : ""}${(delta * 1000).toFixed(1)}`}
                unit="pts"
              />
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Page ──────────────────────────────────────────────────────────

export default function Tools() {
  return (
    <div className="p-4 max-w-lg mx-auto space-y-4">
      <h1 className="font-heading text-xl font-bold">Tools</h1>
      <ABVCalculator />
      <ChaptalizationCalculator />
      <SulfiteCalculator />
      <TempCorrectionCalculator />
    </div>
  );
}
