# C-14: Scheduler Extraction Guide

## Current Architecture

The scheduler runs inside the Next.js process (`src/lib/scheduler.ts`). On first API
request, `ensureSchedulerStarted()` fires the cron loop. This means:
- Scheduler dies with the web process
- If the server restarts at 3 AM, no jobs run until the first request
- All worker instances race the same cron jobs (mitigated by Redis locks)

## Target Architecture

Extract the scheduler into a standalone worker process:

```
┌─────────────┐     ┌──────────────────┐
│  Next.js     │     │  Scheduler Worker │
│  (web)       │     │  (worker.ts)      │
│              │     │                   │
│  serve reqs  │     │  drainOutbox()    │
│              │     │  expireStale()    │
└──────┬───────┘     │  processRefunds() │
       │             │  hourlyJobs()     │
       │             └────────┬──────────┘
       │                      │
       └──────────┬───────────┘
                  │
          ┌───────▼────────┐
          │   PostgreSQL    │
          │   + Redis       │
          └────────────────┘
```

## Migration Steps

### 1. Create `scripts/worker.ts`

```typescript
import { drainOutbox, processRefundRetries, expireStale, hourlyJobs } from '@/lib/scheduler';
import { logger } from '@/lib/logger';

async function run() {
  logger.info('[worker] scheduler worker started');
  setInterval(() => drainOutbox().catch(...), 30_000);
  setInterval(() => processRefundRetries(50).catch(...), 60_000);
  setInterval(() => expireStale().catch(...), 300_000);
  setInterval(() => hourlyJobs().catch(...), 3_600_000);
}

run();
```

### 2. Run the worker separately in production

```yaml
# docker-compose.yml
services:
  web:
    build: .
    command: bun run start
    ports: ['3000:3000']

  scheduler:
    build: .
    command: bun run scripts/worker.ts
    depends_on: [postgres, redis]
```

### 3. Disable in-process scheduler in the web process

In `src/lib/instrumentation.ts`, skip `ensureSchedulerStarted()` when
`SCHEDULER_DISABLED=1` is set (already supported).

### 4. Health check

Add a liveness endpoint (`GET /healthz`) to the worker and register it
in the orchestrator's health check.
