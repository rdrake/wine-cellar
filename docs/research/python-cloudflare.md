# Python on Cloudflare Workers in 2026: a practical architecture guide 
**Python Workers remain in open beta but are remarkably capable — Durable 
Objects, D1, Queues, and Cron Triggers all work with Python and are 
available on the free tier.** The Pyodide-based runtime supports Python 
3.12+, FastAPI runs natively, and since May 2025, you can write Durable 
Objects entirely in Python.  The biggest practical constraint is the 
**10ms CPU limit on the free plan**, which is tight for Python’s 
overhead; the $5/month paid plan removes this bottleneck with 30-second 
(configurable to 5-minute) CPU limits.  For a sensor-monitoring system 
with webhook ingestion, state-machine logic in Durable Objects, and 
SQLite storage via D1, Cloudflare’s platform is well-suited — with some 
important caveats. ----- ## Python Workers: capable beta with Pyodide 
under the hood Python support on Cloudflare Workers launched in **open 
beta in April 2024** and received a major update on **December 8, 2025** 
(“Python Workers redux”), but it is **not yet GA**. You must set the 
`python_workers` compatibility flag in your Wrangler configuration. The 
runtime uses **Pyodide** — CPython compiled to WebAssembly via Emscripten 
— running inside V8 isolates. Your Python code is interpreted by Pyodide 
within the same `workerd` runtime that powers JavaScript Workers.  This 
architecture provides a **Foreign Function Interface (FFI)** between 
Python and JavaScript, giving Python Workers direct access to all 
Cloudflare bindings (D1, KV, R2, Queues, Durable Objects). **Cold starts 
average ~1.03 seconds** with packages like FastAPI loaded — 2.4× faster 
than AWS Lambda and 3× faster than Google Cloud Run.  Cloudflare achieves 
this through **memory snapshots**: at deploy time, a V8 isolate boots 
Pyodide, imports your packages, executes top-level code, and snapshots 
the WebAssembly memory.  At request time, this snapshot is restored 
instantly, avoiding the ~10-second startup that would otherwise occur. 
The **full Python standard library** is available with minor exceptions:  
modules requiring OS-level threading, multiprocessing, raw sockets, or 
terminal I/O don’t work in the WebAssembly sandbox.  For third-party 
packages, **all pure Python PyPI packages** and **Pyodide-bundled 
packages** (NumPy, Pandas, Pillow, matplotlib, etc.) are supported.  
Dependencies go in `pyproject.toml` and are managed by the `pywrangler` 
CLI (built on `uv`).  The critical restriction: **only async HTTP 
libraries work** — `httpx` and `aiohttp` are supported, but the 
`requests` library does not function. ### Framework compatibility 
**FastAPI is a first-class citizen.** The Workers runtime provides a 
built-in ASGI server (via `import asgi`) that replaces uvicorn.  A 
minimal FastAPI Worker looks like this: ```python from fastapi import 
FastAPI from workers import WorkerEntrypoint import asgi app = FastAPI() 
@app.get("/") async def root():
    return {"message": "FastAPI on Workers"} class 
Default(WorkerEntrypoint):
    async def fetch(self, request):
        return await asgi.fetch(app, request.js_object, self.env) ``` 
Django has **experimental community support** via the `django-on-workers` 
package, which provides WSGI-to-Workers translation and D1 integration. 
However, it doesn’t support the full Django ORM feature set.  Flask 
requires adaptation through Quart (its async equivalent).  **No 
Cloudflare-specific Python framework exists** — FastAPI is the 
recommended choice. ----- ## Durable Objects fully support Python since 
May 2025 As of **May 16, 2025**, Cloudflare officially supports writing 
Durable Objects in Python.  This was a significant milestone — 
previously, Python Workers could only call JS/TS Durable Objects via the 
FFI. Now you can define DO classes directly in Python using the 
`workers.DurableObject` base class, with full access to **SQLite storage, 
the Alarm API, and WebSockets**. Each Durable Object gets its own private 
**SQLite database** (the recommended storage backend for all new DO 
classes).  You access it via `ctx.storage.sql.exec()` for SQL queries, or 
through a key-value API (`ctx.storage.get/put/delete`). SQLite-backed DOs 
support up to **10 GB storage per object** on the paid plan and are 
limited to **5 GB total per account** on free. **Durable Objects became 
available on the Workers Free plan in April 2025**, but only 
SQLite-backed DOs (not KV-backed).  This means you can prototype and run 
production workloads with DOs at zero cost, subject to daily limits: **5 
million rows read/day**, **100,000 rows written/day**, and **100,000 
requests/day**. ### State machines are a natural fit for Durable Objects 
The single-threaded execution model eliminates race conditions, 
persistent co-located storage removes network round-trips, and the Alarm 
API enables scheduled state transitions — all properties that make DOs 
ideal for modeling entity lifecycle state machines like fermentation 
batches. **The recommended pattern is one Durable Object per entity** 
(e.g., `idFromName("batch-2026-001")`). Each batch’s state machine lives 
entirely within its DO: ```python from workers import DurableObject 
import time HOURS_48_MS = 48 * 60 * 60 * 1000 class 
FermentationBatch(DurableObject):
    def __init__(self, ctx, env):
        super().__init__(ctx, env) 
        ctx.blockConcurrencyWhile(self._init_schema)
    async def _init_schema(self):
        self.ctx.storage.sql.exec("""
            CREATE TABLE IF NOT EXISTS batch (
                id TEXT PRIMARY KEY, stage TEXT, stage_started INTEGER, 
                temperature REAL, notes TEXT
            )
        """)
    async def start_secondary(self):
        now = int(time.time() * 1000) self.ctx.storage.sql.exec(
            "UPDATE batch SET stage='secondary', stage_started=?", now
        ) self.ctx.storage.setAlarm(now + HOURS_48_MS)
    async def alarm(self):
        row = self.ctx.storage.sql.exec("SELECT stage FROM batch").one() 
        if row.stage == 'secondary':
            await self.transition_to('conditioning') # Send notification 
            via external API
``` **The Alarm API has one key constraint: each DO supports only one 
alarm at a time.** To handle multiple scheduled events (e.g., “check 
temperature in 4 hours” and “transition stage in 48 hours”), store all 
upcoming events in SQLite, set the alarm to the earliest event, and in 
the `alarm()` handler, process all due events then reschedule for the 
next one. Alarms fire with **millisecond granularity**, retry 
automatically up to 6 times with exponential backoff, and guarantee 
**at-least-once execution**. For coordinating multiple batches, use a 
**parent-child pattern**: a “BreweryManager” DO tracks all active batch 
IDs, while each batch DO manages its own state independently. The parent 
creates children via `idFromName()` and can call their RPC methods 
through bindings. ----- ## Free tier is generous enough to prototype — 
paid plan needed for production The free tier covers an impressive range 
of services, though Python’s CPU overhead makes the **10ms per-invocation 
CPU limit** the most constraining factor: |Service |Free Plan |Paid Plan 
($5/month)  | 
|----------------------|----------------------|------------------------------| 
|**Worker requests** |100,000/day |10M/month included | |**Worker CPU 
time** |10ms/invocation |30s default, up to 5 min | |**Worker bundle 
size**|3 MB compressed |10 MB compressed | |**Durable Objects** 
|SQLite-backed only |Both SQLite and KV-backed | |**DO rows read** 
|5M/day |25B/month included | |**DO rows written** |100K/day |50M/month 
included | |**D1 storage** |5 GB (500 MB/database)|5 GB included (10 
GB/database)| |**D1 rows read** |5M/day |25B/month included | |**Queues 
operations** |10,000/day |1M/month included | |**Cron Triggers** |5 per 
account |250 per account | |**Memory per isolate**|128 MB |128 MB | 
**Cron Triggers have surprisingly generous CPU limits** even on the free 
plan: **30 seconds** for intervals under 1 hour, and **15 minutes** for 
hourly-or-longer intervals. This makes scheduled Python Workers practical 
for batch processing on free tier. Cloudflare Queues became available on 
the free plan as of **February 4, 2026**, with 10,000 operations/day (a 
typical message lifecycle costs 3 operations). Message retention on free 
is **24 hours** (non-configurable), versus up to 14 days on paid. ----- 
## D1 is GA and Python-accessible — ideal for starting with SQLite **D1 
reached general availability in April 2024** and is production-ready.  
It’s a managed, serverless SQL database built on SQLite semantics with 
automatic read replication (public beta), point-in-time recovery (last 7 
days on free, 30 days on paid), and zero egress charges. Python Workers 
access D1 through the standard binding system — add a `[[d1_databases]]` 
binding in your Wrangler config and query via 
`self.env.DB.prepare("SELECT ...").bind(params)`.  An official tutorial 
exists at 
`developers.cloudflare.com/d1/examples/query-d1-from-python-workers/`. 
D1’s main architectural constraint is that **each database is backed by a 
single Durable Object**, making it single-threaded. Throughput scales 
with query speed (~1,000 QPS for 1ms queries).  For high-throughput 
scenarios, Cloudflare recommends a **per-tenant or per-entity database 
pattern** — horizontal scale-out across many smaller databases rather 
than one large one. The **10 GB per-database cap** is hard and cannot be 
raised. ----- ## Webhook ingestion and alerting patterns that work well 
For sensor data arriving every 15–60 minutes, the volume is low enough 
that each webhook can be processed directly without queuing. The 
recommended pattern has three layers: **Authentication** uses the Web 
Crypto API (`crypto.subtle`) for HMAC-SHA256 signature verification, 
which works in both Python and JavaScript Workers. Store webhook secrets 
via `wrangler secret put` and access them through `self.env`. For simpler 
setups, API key validation in the `Authorization` header works. 
Cloudflare also offers a **built-in Rate Limiting API** as a Worker 
binding — configured in `wrangler.toml` with customizable limits and 
periods, it runs with near-zero latency since counters are cached on the 
same machine. **Processing** should acknowledge the webhook immediately 
(return 200) and use `ctx.waitUntil()` for background work. For reliable 
multi-step processing (validate → store → check thresholds → alert), 
**Cloudflare Workflows** (Python-supported since November 2025) provide 
durable execution with per-step retry.  For buffering high-volume data 
before storage, Queues batch up to 100 messages with configurable wait 
times. **For time-series sensor telemetry**, Cloudflare’s **Analytics 
Engine** is purpose-built — it handles millions of events per second, 
supports SQL queries, and uses the canonical IoT sensor monitoring use 
case in its documentation.  It complements D1, which stores structured 
metadata and configuration, while Analytics Engine handles high-volume 
readings. **Idempotency** is handled by storing processed webhook event 
IDs in KV (with TTL-based expiration) or D1, checking for duplicates 
before processing. ----- ## Nine gotchas that will shape your 
architecture decisions The **10ms CPU limit on the free plan** is the 
most impactful constraint.  Python’s Pyodide overhead means even simple 
operations consume more CPU than equivalent JavaScript. Basic request 
handling may work, but any computation pushes past 10ms quickly. The 
$5/month paid plan (30-second CPU) is essentially required for Python in 
production. **The ~1-second cold start** is unavoidable with Python 
Workers — JavaScript Workers have near-zero cold starts. For webhook 
endpoints receiving data every 15–60 minutes, expect cold starts on most 
requests unless traffic is consistent enough to keep isolates warm. 
Cloudflare mitigates this with request routing to existing instances 
(“sharding”), but it’s not guaranteed. **128 MB memory per isolate** 
includes Pyodide’s own overhead.  Heavy data processing (large 
DataFrames, image manipulation) will hit this limit. Stream data through 
`TransformStream` rather than loading entire payloads into memory. **Only 
async HTTP libraries function** — the synchronous `requests` library 
fails silently or errors. Use `httpx` (with `async` client) or `aiohttp` 
for all outbound HTTP calls. **Package compatibility is limited to pure 
Python and Pyodide-bundled packages.** C extensions not pre-compiled in 
Pyodide won’t work.  No GPU, threading, multiprocessing, or green thread 
support. The `pywrangler` toolchain requires both `uv` (Python) and 
Node.js/npm installed, adding development environment complexity. **PRNGs 
cannot run during module initialization** because top-level code executes 
at deploy-time snapshot creation, not request time. Random seeds are only 
applied at runtime — this breaks certain initialization patterns. **One 
alarm per Durable Object** means you must implement your own event 
scheduling table for multiple timers. Each `setAlarm()` call replaces the 
previous alarm. **D1 is single-threaded per database** — concurrent 
request overload returns “overloaded” errors. Design for horizontal 
sharding across databases rather than one monolithic DB. **Python Workers 
are still beta.** While functional and improving rapidly (major updates 
in December 2025 and throughout 2025), expect rough edges, evolving APIs, 
and the `python_workers` compatibility flag requirement. Cloudflare 
Workflows for Python are an additional beta layer on top.  For production 
reliability today, a hybrid approach — Python for webhook handling and 
business logic, JavaScript/TypeScript for performance-critical Durable 
Objects — provides a pragmatic middle ground, though the all-Python path 
is increasingly viable. ## Conclusion Cloudflare’s Python support has 
matured significantly through 2025, crossing a key threshold with 
**native Python Durable Objects** (May 2025)  and **comprehensive package 
support** (December 2025).  The platform offers a remarkably complete 
serverless stack on a single provider: Workers for compute, Durable 
Objects for stateful coordination, D1 for SQL storage, Queues for 
messaging, Analytics Engine for telemetry, and Cron Triggers for 
scheduling — all accessible from Python and mostly available on the free 
tier.
For a fermentation-monitoring system, the architecture maps cleanly: a Python/FastAPI Worker receives sensor webhooks, routes data to per-batch Durable Objects that manage state-machine transitions via the Alarm API, stores structured data in D1, and writes telemetry to Analytics Engine. The $5/month paid plan is the practical entry point for production use,  unlocking the CPU headroom Python needs. The primary risk is betting on a beta runtime — but with Cloudflare’s visible investment trajectory and the December 2025 improvements, GA appears to be a matter of when, not if.
