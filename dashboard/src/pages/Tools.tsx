import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";

function useField(initial: number, decimals?: number) {
  const [value, setValue] = useState(initial);
  const [text, setText] = useState(decimals != null ? initial.toFixed(decimals) : String(initial));
  function setFromText(e: React.ChangeEvent<HTMLInputElement>) {
    setText(e.target.value);
    const n = parseFloat(e.target.value);
    if (!isNaN(n)) setValue(n);
  }
  function setFromSlider(v: number) {
    setValue(v);
    setText(decimals != null ? v.toFixed(decimals) : String(v));
  }
  return { value, text, setFromText, setFromSlider };
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

function SliderField({ id, label, min, max, step, field }: {
  id: string; label: string; min: number; max: number; step: number;
  field: ReturnType<typeof useField>;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between items-baseline">
        <Label htmlFor={id} className="text-xs">{label}</Label>
        <Input
          id={id} type="number" step={step} inputMode="decimal"
          value={field.text} onChange={field.setFromText}
          className="w-20 h-7 text-xs text-right tabular-nums"
        />
      </div>
      <Slider
        min={min} max={max} step={step}
        value={[field.value]}
        onValueChange={(v) => field.setFromSlider(Array.isArray(v) ? v[0] : v)}
      />
    </div>
  );
}

function CollapsibleCard({ title, description, defaultOpen = false, children }: {
  title: string; description?: string; defaultOpen?: boolean; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card>
      <button
        type="button"
        className="w-full p-4 flex justify-between items-center text-left"
        onClick={() => setOpen(!open)}
      >
        <div>
          <h2 className="font-heading font-semibold">{title}</h2>
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
        </div>
        <span className={cn("text-muted-foreground text-xl transition-transform", open && "rotate-180")}>▾</span>
      </button>
      {open && <CardContent className="p-4 pt-0 space-y-4">{children}</CardContent>}
    </Card>
  );
}

// ─── ABV Calculator ────────────────────────────────────────────────

function ABVCalculator() {
  const og = useField(1.09, 3);
  const fg = useField(0.996, 3);

  const abv = (og.value - fg.value) * 131.25;
  const att = og.value > 1
    ? Math.min(100, ((og.value - fg.value) / (og.value - 1)) * 100)
    : null;

  return (
    <CollapsibleCard title="ABV" defaultOpen={true}>
      <SliderField id="abv-og" label="Original Gravity" min={1.0} max={1.16} step={0.001} field={og} />
      <SliderField id="abv-fg" label="Final Gravity" min={0.98} max={1.06} step={0.001} field={fg} />
      {abv >= 0 && (
        <div className="border-t pt-2 space-y-0.5">
          <Result label="Estimated ABV" value={abv.toFixed(1)} unit="%" />
          {att !== null && att >= 0 && <Result label="Apparent Attenuation" value={att.toFixed(0)} unit="%" />}
        </div>
      )}
    </CollapsibleCard>
  );
}

// ─── Chaptalization Calculator ─────────────────────────────────────

function ChaptalizationCalculator() {
  const vol = useField(23, 1);
  const current = useField(1.05, 3);
  const target = useField(1.08, 3);

  const pts = (target.value - current.value) * 1000;
  const sugar = pts > 0 ? vol.value * pts * 2.65 : null;

  return (
    <CollapsibleCard title="Chaptalization" description="How much sugar to reach your target gravity">
      <SliderField id="chap-vol" label="Batch Volume (L)" min={1} max={100} step={0.5} field={vol} />
      <SliderField id="chap-cur" label="Current SG" min={1.0} max={1.16} step={0.001} field={current} />
      <SliderField id="chap-tgt" label="Target SG" min={1.0} max={1.16} step={0.001} field={target} />
      {sugar !== null && (
        <div className="border-t pt-2 space-y-0.5">
          <Result
            label="Sugar Needed"
            value={sugar >= 1000 ? (sugar / 1000).toFixed(2) : sugar.toFixed(0)}
            unit={sugar >= 1000 ? "kg" : "g"}
          />
          <Result label="Gravity Increase" value={`+${pts.toFixed(0)}`} unit="pts" />
        </div>
      )}
      {pts <= 0 && (
        <p className="text-xs text-muted-foreground border-t pt-2">
          Target must be higher than current SG. Raise the target to calculate a sugar addition.
        </p>
      )}
    </CollapsibleCard>
  );
}

// ─── Sulfite Calculator ────────────────────────────────────────────

function SulfiteCalculator() {
  const vol = useField(23, 1);
  const ph = useField(3.4, 2);
  const target = useField(30);
  const current = useField(0);

  const delta = target.value - current.value;
  const kms = delta > 0 ? (delta * vol.value) / 576 : null;
  const molSO2 = target.value / (1 + Math.pow(10, ph.value - 1.81));

  return (
    <CollapsibleCard title="Sulfite Addition" description="Potassium metabisulfite (KMS) dosing">
      <SliderField id="so2-vol" label="Batch Volume (L)" min={1} max={100} step={0.5} field={vol} />
      <SliderField id="so2-ph" label="pH" min={2.8} max={4.2} step={0.01} field={ph} />
      <SliderField id="so2-tgt" label="Target Free SO₂ (ppm)" min={0} max={100} step={1} field={target} />
      <SliderField id="so2-cur" label="Current Free SO₂ (ppm)" min={0} max={100} step={1} field={current} />
      {kms !== null && (
        <div className="border-t pt-2 space-y-0.5">
          <Result label="KMS to Add" value={kms.toFixed(2)} unit="g" />
          {molSO2 > 0 && (
            <>
              <Result label="Molecular SO₂" value={molSO2.toFixed(2)} unit="ppm" />
              <p className="text-xs text-muted-foreground pt-1">
                Target: 0.5–0.8 ppm molecular SO₂
              </p>
            </>
          )}
        </div>
      )}
    </CollapsibleCard>
  );
}

// ─── Hydrometer Temperature Correction ─────────────────────────────

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
  const sg = useField(1.05, 3);
  const temp = useField(25, 1);
  const cal = useField(20, 1);

  const corrected = sg.value + tempCorrection(temp.value) - tempCorrection(cal.value);
  const delta = corrected - sg.value;

  return (
    <CollapsibleCard title="Hydrometer Correction" description="Get an accurate SG from an off-temperature sample">
      <SliderField id="tc-sg" label="Observed SG" min={0.99} max={1.16} step={0.001} field={sg} />
      <SliderField id="tc-temp" label="Sample °C" min={0} max={40} step={0.5} field={temp} />
      <SliderField id="tc-cal" label="Calibration °C" min={10} max={25} step={0.5} field={cal} />
      <div className="border-t pt-2 space-y-0.5">
        <Result label="Corrected SG" value={corrected.toFixed(4)} />
        <Result
          label="Correction"
          value={`${delta >= 0 ? "+" : ""}${(delta * 1000).toFixed(1)}`}
          unit="pts"
        />
      </div>
    </CollapsibleCard>
  );
}

// ─── Calibration Solution ─────────────────────────────────────────

/** Convert SG to Brix using the standard polynomial approximation. */
function sgToBrix(sg: number): number {
  // NBS C440 polynomial (valid 1.000–1.170)
  return 261.3 * (1 - 1 / sg);
}

function CalibrationSolutionCalculator() {
  const vol = useField(0.5, 1);
  const sg = useField(1.05, 3);

  // Total solution mass (g) = volume (mL) × SG
  const volMl = vol.value * 1000;
  const totalMass = volMl * sg.value;
  const brix = sgToBrix(sg.value);
  const sugarG = totalMass * (brix / 100);

  // Dissolve sugar in less water, then top up to final volume
  // Water to start with ≈ 60–70% of final volume (enough to dissolve sugar)
  const startWaterMl = Math.max(volMl * 0.6, sugarG * 2); // at least 2 mL per g sugar to dissolve

  return (
    <CollapsibleCard title="Calibration Solution" description="Make a reference solution to verify your hydrometer">
      <SliderField id="cal-vol" label="Final Volume (L)" min={0.1} max={2} step={0.1} field={vol} />
      <SliderField id="cal-sg" label="Target SG" min={1.0} max={1.12} step={0.001} field={sg} />
      {sg.value > 1.0 && (
        <>
          <div className="border-t pt-2 space-y-0.5">
            <Result label="Sugar Needed" value={sugarG >= 1000 ? (sugarG / 1000).toFixed(2) : sugarG.toFixed(1)} unit={sugarG >= 1000 ? "kg" : "g"} />
            <Result label="Distilled Water" value={`fill to ${vol.value < 1 ? (volMl).toFixed(0) + " mL" : vol.value.toFixed(1) + " L"}`} />
            <Result label="Brix" value={brix.toFixed(1)} unit="°Bx" />
          </div>
          <div className="border-t pt-2">
            <p className="text-xs font-medium mb-1.5">How to Prepare</p>
            <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
              <li>Weigh <strong>{sugarG.toFixed(1)} g</strong> white granulated sugar</li>
              <li>Add ~{startWaterMl.toFixed(0)} mL distilled water at 20 °C and stir until fully dissolved</li>
              <li>Pour into a graduated vessel and top up to <strong>{volMl.toFixed(0)} mL</strong> with distilled water</li>
              <li>Stir gently, let settle, and verify SG reads {sg.value.toFixed(3)} at 20 °C</li>
            </ol>
          </div>
        </>
      )}
      {sg.value <= 1.0 && (
        <p className="text-xs text-muted-foreground border-t pt-2">
          Target SG must be above 1.000. Raise it above 1.000 to calculate a recipe.
        </p>
      )}
    </CollapsibleCard>
  );
}

// ─── Page ──────────────────────────────────────────────────────────

export default function Tools() {
  return (
    <div className="p-4 max-w-lg lg:max-w-3xl mx-auto space-y-4">
      <h1 className="font-heading text-xl font-bold">Winemaking Calculators</h1>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ABVCalculator />
        <ChaptalizationCalculator />
        <SulfiteCalculator />
        <TempCorrectionCalculator />
        <CalibrationSolutionCalculator />
      </div>
    </div>
  );
}
