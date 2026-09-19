import { Client, Connection } from "@temporalio/client";

const TEMPORAL_HOST = process.env.TEMPORAL_HOST ?? "localhost:7233";
const TEMPORAL_NAMESPACE = process.env.TEMPORAL_NAMESPACE ?? "default";

export function getTemporalClient(): Client {
  const connection = Connection.lazy({
    address: TEMPORAL_HOST,
  });

  return new Client({
    connection,
    namespace: TEMPORAL_NAMESPACE,
  });
}
