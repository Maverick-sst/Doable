# Temporal Local Development

This directory contains the Temporal client, worker, workflows, and activities for the Doable pilot integration.

## Quick Start

This is a **slim Postgres-only** Temporal stack (no Elasticsearch). It is suitable for local development and the current pilot. Elasticsearch can be added later when advanced visibility is required.

Estimated RAM usage: **400–700 MB** (Temporal server + Postgres).

### 1. Start Temporal (Docker)

From the project root:

```bash
docker compose -f docker-compose.temporal.yml up -d
```

Wait for the services to be healthy (~30-60 seconds):

```bash
docker compose -f docker-compose.temporal.yml ps
```

Services:
- Temporal gRPC endpoint: `localhost:7233`
- Temporal Web UI: http://localhost:8233
- Namespace: `default`

### 2. Configure environment

Ensure your `.env.local` includes:

```env
TEMPORAL_HOST=localhost:7233
TEMPORAL_NAMESPACE=default
TEMPORAL_TASK_QUEUE=pilot-queue
```

`TEMPORAL_TASK_QUEUE` is optional and defaults to `pilot-queue` for the pilot trigger route.

### 3. Start the Temporal worker

```bash
bun run temporal:worker
```

This starts a worker that listens for workflows on the configured task queue.

### 4. Run the trivial "hello" workflow

In another terminal:

```bash
bun run temporal:hello
```

Expected output:

```
Hello, World from Temporal!
```

### 5. Run the Doable pilot workflow

The pilot workflow updates a Doable `Execution` record idempotently. You can trigger it in two ways.

#### A. Direct script (no Clerk auth required)

Edit `scripts/run-pilot-workflow.ts` with real Doable IDs, then:

```bash
bun scripts/run-pilot-workflow.ts
```

#### B. Via the API route (Clerk auth required)

Make sure your app is running:

```bash
bun dev
```

Then send an authenticated `POST` request to:

```
POST http://localhost:3000/api/temporal/pilot
```

Request body:

```json
{
  "projectId": "<doable-project-id>",
  "workflowId": "<doable-workflow-id>",
  "executionId": "<doable-execution-id>",
  "nodeId": "<optional-doable-node-id>",
  "taskId": "<optional-task-id>"
}
```

Expected response (201):

```json
{
  "temporalWorkflowId": "pilot-<doable-execution-id>",
  "temporalRunId": "<temporal-run-id>",
  "doableExecutionId": "<doable-execution-id>",
  "status": "started"
}
```

## Stopping Temporal

```bash
docker compose -f docker-compose.temporal.yml down
```

To remove volumes as well:

```bash
docker compose -f docker-compose.temporal.yml down -v
```

## Scripts Reference

| Script | Purpose |
|--------|---------|
| `bun run temporal:worker` | Start the Temporal worker |
| `bun run temporal:hello` | Run the trivial greet workflow |
| `bun scripts/run-pilot-workflow.ts` | Run the Doable pilot workflow directly |

## Architecture

See `src/temporal/contracts/README.md` for the full contract between Temporal and Doable's Postgres state.
