import { Client, Connection } from "@temporalio/client";

let cachedClient: Client | null = null;
let cachedConnection: Connection | null = null;

export function getTemporalHost(): string {
  return process.env.TEMPORAL_HOST ?? "127.0.0.1:7233";
}

export function getTemporalNamespace(): string {
  return process.env.TEMPORAL_NAMESPACE ?? "default";
}

export function getTemporalTaskQueue(): string {
  return process.env.TEMPORAL_TASK_QUEUE ?? "pilot-queue";
}

/**
 * A single lazy connection per process. Routes and workers must go through
 * this boundary instead of constructing their own clients.
 */
export function getTemporalClient(): Client {
  if (cachedClient) return cachedClient;

  cachedConnection = Connection.lazy({
    address: getTemporalHost(),
    ...(process.env.TEMPORAL_TLS === "true" ? { tls: true } : {}),
    ...(process.env.TEMPORAL_API_KEY
      ? { apiKey: process.env.TEMPORAL_API_KEY }
      : {}),
  });

  cachedClient = new Client({
    connection: cachedConnection,
    namespace: getTemporalNamespace(),
  });

  return cachedClient;
}

export async function ensureTemporalConnected(): Promise<void> {
  getTemporalClient();
  if (!cachedConnection) throw new Error("Temporal connection was not created");
  await cachedConnection.ensureConnected();
}

export async function closeTemporalClient(): Promise<void> {
  if (cachedConnection) {
    await cachedConnection.close();
    cachedConnection = null;
    cachedClient = null;
  }
}