import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";

function useField(initial: number) {
  const [value, setValue] = useState(initial);
  const [text, setText] = useState(String(initial));
  function setFromText(e: React.ChangeEvent<HTMLInputElement>) {
    setText(e.target.value);
    const n = parseFloat(e.target.value);
    if (!isNaN(n)) setValue(n);
  }
  function setFromSlider(v: number) {
    setValue(v);
    setText(String(v));
  }
  return { value, text, setFromText, setFromSlider, ok: !isNaN(value) };
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

function SliderField({ id, label, min, max, step, value, text, onSlider, onInput }: {
  id: string; label: string; min: number; max: number; step: number;
  value: number; text: string;
  onSlider: (v: number) => void;
  onInput: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between items-baseline">
        <Label htmlFor={id} className="text-xs">{label}</Label>
        <Input
          id={id} type="number" step={step} inputMode="decimal"
          value={text} onChange={onInput}
          className="w-20 h-7 text-xs text-right tabular-nums"
        />
      </div>
      <Slider
        min={min} max={max} step={step}
        value={[value]}
        onValueChange={(v) => onSlider(Array.isArray(v) ? v[0] : v)}
      />
    </div>
  );
}

// ─── ABV Calculator ────────────────────────────────────────────────

function ABVCalculator() {
  const og = useField(1.09);
  const fg = useField(0.996);

  const abv = og.ok && fg.ok ? (og.value - fg.value) * 131.25 : null;
  const att = og.ok && fg.ok && og.value > 1
    ? Math.min(100, ((og.value - fg.value) / (og.value - 1)) * 100)
    : null;

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <h2 className="font-heading font-semibold">ABV</h2>
        <SliderField id="abv-og" label="Original Gravity" min={1.0} max={1.16} step={0.001}
          value={og.value} text={og.text} onSlider={og.setFromSlider} onInput={og.setFromText} />
        <SliderField id="abv-fg" label="Final Gravity" min={0.98} max={1.06} step={0.001}
          value={fg.value} text={fg.text} onSlider={fg.setFromSlider} onInput={fg.setFromText} />
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
  const vol = useField(23);
  const current = useField(1.05);
  const target = useField(1.08);

  const pts = current.ok && target.ok ? (target.value - current.value) * 1000 : null;
  const sugar = pts !== null && pts > 0 && vol.ok ? vol.value * pts * 2.65 : null;

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <h2 className="font-heading font-semibold">Chaptalization</h2>
        <p className="text-xs text-muted-foreground -mt-2">Sugar addition to raise specific gravity</p>
        <SliderField id="chap-vol" label="Volume (L)" min={1} max={100} step={0.5}
          value={vol.value} text={vol.text} onSlider={vol.setFromSlider} onInput={vol.setFromText} />
        <SliderField id="chap-cur" label="Current SG" min={1.0} max={1.16} step={0.001}
          value={current.value} text={current.text} onSlider={current.setFromSlider} onInput={current.setFromText} />
        <SliderField id="chap-tgt" label="Target SG" min={1.0} max={1.16} step={0.001}
          value={target.value} text={target.text} onSlider={target.setFromSlider} onInput={target.setFromText} />
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
  const vol = useField(23);
  const ph = useField(3.4);
  const target = useField(30);
  const current = useField(0);

  const delta = target.ok && current.ok ? target.value - current.value : null;
  const kms = delta !== null && delta > 0 && vol.ok ? (delta * vol.value) / 576 : null;
  const molSO2 = ph.ok && target.ok
    ? target.value / (1 + Math.pow(10, ph.value - 1.81))
    : null;

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <h2 className="font-heading font-semibold">Sulfite Addition</h2>
        <p className="text-xs text-muted-foreground -mt-2">Potassium metabisulfite (KMS) dosing</p>
        <SliderField id="so2-vol" label="Volume (L)" min={1} max={100} step={0.5}
          value={vol.value} text={vol.text} onSlider={vol.setFromSlider} onInput={vol.setFromText} />
        <SliderField id="so2-ph" label="pH" min={2.8} max={4.2} step={0.01}
          value={ph.value} text={ph.text} onSlider={ph.setFromSlider} onInput={ph.setFromText} />
        <SliderField id="so2-tgt" label="Target Free SO₂ (ppm)" min={0} max={100} step={1}
          value={target.value} text={target.text} onSlider={target.setFromSlider} onInput={target.setFromText} />
        <SliderField id="so2-cur" label="Current Free SO₂ (ppm)" min={0} max={100} step={1}
          value={current.value} text={current.text} onSlider={current.setFromSlider} onInput={current.setFromText} />
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
  const sg = useField(1.05);
  const temp = useField(25);
  const cal = useField(20);

  const corrected = sg.ok && temp.ok && cal.ok
    ? sg.value + tempCorrection(temp.value) - tempCorrection(cal.value)
    : null;
  const delta = corrected !== null ? corrected - sg.value : null;

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <h2 className="font-heading font-semibold">Hydrometer Correction</h2>
        <p className="text-xs text-muted-foreground -mt-2">Correct SG reading for sample temperature</p>
        <SliderField id="tc-sg" label="Observed SG" min={0.99} max={1.16} step={0.001}
          value={sg.value} text={sg.text} onSlider={sg.setFromSlider} onInput={sg.setFromText} />
        <SliderField id="tc-temp" label="Sample °C" min={0} max={40} step={0.5}
          value={temp.value} text={temp.text} onSlider={temp.setFromSlider} onInput={temp.setFromText} />
        <SliderField id="tc-cal" label="Calibration °C" min={10} max={25} step={0.5}
          value={cal.value} text={cal.text} onSlider={cal.setFromSlider} onInput={cal.setFromText} />
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
