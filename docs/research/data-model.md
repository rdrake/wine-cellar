# RAPT Pill webhooks, fermentation data models, and winemaking process 
architecture The RAPT Pill uses a **template-based webhook system** where 
you define the JSON payload yourself using `@variable` placeholders — 
there is no fixed payload schema. KegLand exposes nine substitution 
variables covering gravity, temperature, battery, RSSI, device metadata, 
and timestamps. Authentication relies on custom HTTP headers you 
configure yourself (no HMAC or built-in signing). This flexibility means 
you can shape payloads to match any receiving service, but it also means 
you must design your own schema. Combined with established patterns from 
Brewfather, iSpindel, and BeerJSON, plus the 14-stage winemaking process 
model, this gives you everything needed to architect a fermentation 
tracking system. ----- ## RAPT Pill webhook payloads are template-driven, 
not fixed Unlike the iSpindel (which sends a fixed JSON structure), the 
RAPT Portal lets users define the exact webhook payload using variable 
substitution. When telemetry arrives at the RAPT cloud from the Pill, the 
portal replaces `@variable` tokens in your template with actual values, 
then POSTs the result to your URL. ### Available webhook variables 
|Variable |Type |Description |Notes | 
|---------------|-------|---------------------------------------|----------------------| 
|`@device_id` |string |GUID unique device identifier |Must be quoted in 
JSON| |`@device_name` |string |User-assigned device name |Must be quoted 
| |`@device_type` |string |Always `"Hydrometer"` for the Pill |Must be 
quoted | |`@temperature` |numeric|Temperature in **Celsius only** |No 
Fahrenheit option | |`@gravity` |numeric|Specific gravity (e.g., `1.050`)  
|Standard gravity units| |`@battery` |numeric|Battery level as 
**percentage** (0–100)|Not voltage | |`@rssi` |numeric|WiFi signal 
strength (dBm)  |Negative integer | |`@created_date`|string |ISO 
timestamp of telemetry creation |Must be quoted | **The tilt angle is not 
directly exposed.** The Pill measures gravity via accelerometer tilt 
internally but only provides the calculated SG value through the webhook. 
Temperature is **always Celsius** with no conversion option — your 
application must handle unit conversion. ### Recommended comprehensive 
payload template Since you define the structure, here is the most 
complete template for capturing all Pill data: ```json {
  "device_id": "@device_id", "device_name": "@device_name", 
  "device_type": "@device_type", "temperature": @temperature, "gravity": 
  @gravity, "battery": @battery, "rssi": @rssi, "created_date": 
  "@created_date"
} ``` String variables (`@device_id`, `@device_name`, `@device_type`, 
`@created_date`) require quotes. Numeric variables (`@temperature`, 
`@gravity`, `@battery`, `@rssi`) must not be quoted. Getting this wrong 
is the most common cause of malformed JSON in community troubleshooting 
threads. For integration with services like Brewer’s Friend, BierBot 
Bricks, or BrewSpy, community examples embed API keys directly in the 
payload body alongside the telemetry fields. ----- ## Authentication uses 
custom headers, not signatures The RAPT webhook system has **no built-in 
HMAC signature, no shared secret verification, and no cryptographic 
signing** of outbound payloads. Security is handled through three 
mechanisms you configure yourself: **Custom HTTP headers** are the 
primary approach. The webhook configuration UI provides a “Header 
Parameters” section where you add key-value pairs.  You can set 
`Authorization: Bearer <token>`, `X-API-Key: <your-key>`, or any custom 
header your endpoint requires. A “Query String Parameters” section lets 
you append auth tokens to the URL.  Many integrations simply embed API 
keys inside the JSON payload body itself (as BierBot and BrewSpy examples 
demonstrate). Community recommendation for additional security: restrict 
your webhook endpoint to accept POSTs only from RAPT’s IP range, since 
there is no payload signature to verify authenticity. ### The RAPT Cloud 
pull API (separate from webhooks) KegLand also exposes a RESTful API at 
`https://api.rapt.io` for pulling telemetry data.  This uses **JWT Bearer 
tokens** obtained via OAuth2 password grant: ``` POST 
https://id.rapt.io/connect/token Content-Type: 
application/x-www-form-urlencoded 
client_id=rapt-user&grant_type=password&username={email}&password={API_SECRET} 
``` The `password` field takes an **API Secret** (not your login 
password), generated under My Account → API Secrets in the RAPT Portal.  
Tokens expire after **60 minutes**.  The API Secret is hashed on creation 
and cannot be recovered — you must save it when first displayed. Key pull 
API endpoints include `GET /api/Hydrometers/GetHydrometers` (list 
devices), `GET 
/api/Hydrometers/GetTelemetry?hydrometerId={GUID}&startDate={ISO}&endDate={ISO}` 
(historical readings), and a Swagger UI at 
`https://api.rapt.io/index.html`.  **Important caveat:** the GetTelemetry 
endpoint returns gravity as thousandths (e.g., `1050` for SG 1.050), 
requiring division by 1000. KegLand explicitly marks API access as 
unsupported, subject to change, and enforces a fair-use policy with 
**24-hour lockouts** for excessive calls. ----- ## Setting up webhooks 
and configuring telemetry intervals ### Webhook configuration in the RAPT 
Portal Navigate to `https://app.rapt.io` → click your name → 
**Webhooks** → **Create new Web Hook** → **Custom Webhook**.  The 
configuration has four tabs: The **Details** tab sets the webhook name, 
description, target URL (fully qualified, no query string), and HTTP 
method (POST or GET). The **Payload** tab holds your JSON template with 
`@variable` placeholders (POST only).  The **Parameters** tab configures 
Header Parameters and Query String Parameters as key-value pairs. The 
**Devices** tab toggles which registered devices trigger this webhook — 
**you must explicitly enable each device**, a step frequently missed by 
new users. A **Logs** tab shows execution history with success/failure 
status codes for debugging. Brewfather has a native RAPT integration (not 
custom webhook) — you enter an Integration ID and the portal handles 
everything automatically. ### Telemetry frequency |Method |Default 
interval|Minimum |Battery impact | 
|---------|----------------|----------------------|-------------------------| 
|WiFi |**60 minutes** |15 minutes |~6 months at 60 min | |Bluetooth|**60 
seconds** |< 60 seconds (warning)|Multiple years via bridge| 
Configuration requires connecting the Pill to USB-C power, which opens a 
captive portal WiFi AP (“KegLand RAPT Hydrometer”).  Navigate to the 
Settings page to select telemetry method and interval. The captive portal 
auto-closes after 10 minutes.  **Webhooks fire each time new telemetry 
arrives at the RAPT cloud**, so your webhook frequency equals your 
configured telemetry interval. ### Official documentation and community 
resources KegLand maintains docs at `https://docs.rapt.io/` with specific 
pages for custom webhooks, API secrets, the Pill captive portal, and 
Bluetooth operation. Their GitLab wiki at 
`https://gitlab.com/rapt.io/public` documents BLE transmission formats 
and API calls.  Community GitHub projects include `rapt-mqtt-bridge` 
(Python RAPT-to-MQTT bridge), `rapt-ble` (BLE packet parser used in Home 
Assistant), and `ha-rapt-package` (Home Assistant YAML integration).  A 
Python client library `kegland-rapt-api-client` is available on PyPI. 
----- ## Fermentation data models from Brewfather, iSpindel, and BeerJSON 
### Brewfather sets the standard for batch lifecycle modeling 
Brewfather’s API exposes the most comprehensive fermentation data model 
in the homebrewing ecosystem. Its **Batch** entity uses a lifecycle 
status enum: `Planning → Brewing → Fermenting → Conditioning → 
Completed → Archived`. Each batch contains measured gravities 
(`measuredOg`, `measuredFg`), measured volumes, calculated values (ABV, 
attenuation, efficiency), dated milestones (`brewDate`, 
`fermentationStartDate`, `bottlingDate` as Unix milliseconds), and 
ingredient arrays. **The Reading object** — returned by `GET 
/v2/batches/:id/readings` — captures telemetry: ```json {
  "time": 1572383500131, "sg": 1.039, "temp": 5.1, "comment": null, 
  "type": "iSpindel", "pressure": null, "ph": null, "battery": 4.082, 
  "rssi": -75, "angle": 32.80, "id": "GREEN"
} ``` This covers gravity, temperature, device battery/RSSI/tilt angle, 
pH, pressure, freeform comments, the reading source type, and a device 
identifier. For **additives**, Brewfather uses a `Misc` object with a 
`type` enum (`Spice`, `Fining`, `Water Agent`, `Herb`, `Flavor`, `Other`) 
and a `use` enum specifying process timing (`Boil`, `Mash`, `Primary`, 
`Secondary`, `Bottling`, `Sparge`, `Flameout`).  Amounts support flexible 
units: g, mg, ml, tsp, tbsp, pkg, items, drops. An `amountPerL` field 
enables recipe scaling. ### iSpindel provides the reference webhook 
payload format The iSpindel hydrometer sends a **fixed JSON payload** — a 
useful contrast to RAPT’s template approach: ```json {
  "name": "iSpindel000", "ID": 11768341, "token": "optional_auth_token", 
  "angle": 63.315, "temperature": 21.375, "temp_units": "C", "battery": 
  4.771, "gravity": 1.050, "interval": 900, "RSSI": -80
} ``` Key difference from RAPT: iSpindel exposes the **raw tilt angle** 
alongside calculated gravity, sends **battery as voltage** (not 
percentage), includes its **sleep interval** in the payload, and uses a 
simple `token` field for authentication.  The GravityMon successor adds 
`corr-gravity` (temperature-corrected), `gravity-unit` (“G” for SG, “P” 
for Plato), and `run-time`. ### BeerJSON is the modern interchange 
standard **BeerJSON 1.0** supersedes BeerXML with critical improvements 
for fermentation modeling.  Its `FermentationProcedureType` supports 
**unlimited fermentation steps** (BeerXML was limited to three), each 
with `start_temperature`, `end_temperature`, `step_time`, 
`start_gravity`, `end_gravity`, `start_ph`, `end_ph`, `free_rise` 
(boolean for natural temperature changes), and `vessel` reference. A 
**Timing Object** allows any ingredient to be added at any process step 
based on time, temperature, or gravity triggers.  All measurements use 
explicit `{unit, value}` pairs. ### Cross-platform entity patterns Across 
all platforms, **five core entities** recur: **Batch** (the central 
tracking unit with lifecycle state), **Reading** (time-series telemetry 
with gravity, temperature, and device metadata), **Device** 
(sensor/controller with calibration and connection config), **Recipe** 
(ingredients + process steps), and **Addition** (an ingredient applied at 
a specific process stage with amount, unit, and timing). Fermentrack adds 
a useful abstraction: a device-agnostic **GravitySensor** base class with 
Tilt, iSpindel, and Manual as implementations — a pattern worth adopting 
for supporting RAPT alongside other hydrometers. ----- ## The 14 stages 
of small-scale winemaking Winemaking is significantly more complex than 
beer brewing, with more stages, more measurements, and more additives. 
The process varies substantially by source material (kit vs. juice bucket 
vs. fresh grapes), but follows a common arc. ### From grapes to glass: 
the full stage progression **Receiving & Inspection** (hours): Test 
initial Brix (**23–27° for reds**, 20–24° for whites), pH, and titratable 
acidity (TA). For kits, this is just opening the box. **Crushing & 
Destemming** (hours, grapes only): Break skins to release must. Add 
**potassium metabisulfite at 30–50 ppm** and pectic enzyme. For whites, 
press immediately. **Must Preparation** (1–5 days): Adjust sugar 
(chaptalization), acid (tartaric acid at 1 g/L per g/L TA increase), and 
nutrients. Optional **cold soak at 35–45°F for 2–5 days** extracts color 
compounds before fermentation begins. **Primary Fermentation** (5–21 
days): Pitch yeast, monitor SG daily, maintain temperature (**70–85°F for 
reds**, 55–65°F for whites).  Staggered yeast nutrient additions (Fermaid 
K, DAP) at ⅓ and ⅔ sugar depletion. For reds on skins, **punch down the 
cap 2–3 times daily**. **Pressing** (hours, red grapes only): Separate 
free-run wine from press wine when SG reaches ~0.995–1.000. Do not add 
SO₂ if malolactic fermentation is planned. **Secondary Fermentation** 
(1–4 weeks): Rack off gross lees into carboy. Confirm fermentation 
complete at **SG < 0.996 on two consecutive days**. **Malolactic 
Fermentation** (1–6 months): Inoculate with ML bacteria (e.g., VP41). 
Requires free SO₂ < 15 ppm and temperature above 64°F.  **Chromatography 
paper confirms complete malic-to-lactic conversion.** Not recommended for 
kit wines. **Stabilization & Degassing** (1–3 days): Add potassium 
metabisulfite (target **25–40 ppm free SO₂**) and potassium sorbate (if 
back-sweetening). Vigorous degassing is critical — residual CO₂ prevents 
fining agents from working. **Fining & Clarification** (2–4 weeks): Apply 
fining agents — typically a two-part system like kieselsol (negative 
charge, added first) followed by chitosan (positive charge, 24 hours 
later).  Alternatives include bentonite, egg whites, gelatin, or 
Sparkolloid. **Bulk Aging** (1–18 months): Rack every 2–3 months, check 
and adjust free SO₂ at each racking. Oak additions (chips for 1–2 weeks, 
cubes for 1–4 months) during this phase. **Cold Stabilization** (2–4 
weeks, optional): Chill to 28–32°F to precipitate tartrate crystals. 
Primarily for whites and rosés. **Filtering** (hours, optional): Coarse 
(5–10 μm), polish (1–3 μm), or sterile (0.45 μm) filtration. Sterile 
filtering is required for sweet wines without sorbate. **Bottling** 
(hours): Final SO₂ adjustment, back-sweeten if desired (sorbate 
required), fill and cork. Calculate final ABV as (OG − FG) × 131. 
**Bottle Aging** (weeks to years): Store at **55°F, 50–80% humidity**, 
bottles on their side.  Kit wines improve for 6–12 months; grape wines 
can age 1–5+ years. ### Key differences by source material |Aspect |Wine 
Kit |Juice Bucket |Fresh Grapes | 
|--------------------|---------------|-------------------------|---------------------------| 
|Chemistry adjustment|Pre-balanced |May need pH/TA adjustment|Always test 
and adjust | |MLF |Not recommended|Optional for reds |Recommended for 
reds | |Measurements needed |SG only |SG, pH, TA, SO₂ |SG, pH, TA, SO₂, 
malic acid| |Timeline to bottle |**4–8 weeks** |**3–12 months** |**6–24 
months** | |Winemaker decisions |Minimal |Moderate |Maximum | ### Stage 
transitions as a state machine Each transition from one stage to the next 
has a defined trigger: SG thresholds (< 1.010 to rack to secondary, < 
0.996 for two days to confirm dry), chromatography results (MLF 
complete), visual clarity (ready to bottle), SO₂ levels (adequate for 
aging/bottling), and elapsed time. These triggers map directly to a 
software state machine with measurable, automatable conditions — ideal 
for a tracking application that can suggest “time to rack” or “MLF 
appears complete” based on logged readings. ----- ## Conclusion: 
architecture recommendations The RAPT Pill’s template-based webhook 
design gives you complete control over payload shape, but requires you to 
build your own ingestion schema rather than conforming to a fixed format. 
**Design your webhook endpoint to accept a superset of the RAPT variables 
plus iSpindel fields** (adding `angle`, `interval`, and voltage-based 
`battery`) to support multiple hydrometer types with a single endpoint. 
For your data model, Brewfather’s batch lifecycle (`Planning → Brewing 
→ Fermenting → Conditioning → Completed → Archived`) needs extension 
for winemaking. A winemaking-aware system should support **14+ discrete 
stages** with configurable transition triggers based on SG, pH, SO₂, 
chromatography, visual clarity, and elapsed time. BeerJSON’s 
`FermentationProcedureType` with unlimited steps and its Timing Object 
(additions triggered by time, temperature, or gravity) provides the best 
foundation for modeling the complex, multi-month winemaking process.
Model additions as first-class entities rather than batch notes — each with a timestamp, additive type, amount with flexible units, target measurement (e.g., “raise free SO₂ to 35 ppm”), and the stage context in which it was applied. This captures the rich chemical intervention timeline that distinguishes winemaking from brewing and makes the data useful for recipe refinement across vintages.
