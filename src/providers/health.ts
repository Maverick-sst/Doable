/**
 * Per-process circuit breaker. A provider that keeps failing is skipped until
 * its cooldown elapses; the next request is a half-open probe.
 */
interface BreakerState {
  failures: number;
  openedAt: number | null;
}

const states = new Map<string, BreakerState>();

function failureThreshold(): number {
  const parsed = Number.parseInt(
    process.env.MODEL_CIRCUIT_FAILURES ?? "",
    10,
  );
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 3;
}

function cooldownMs(): number {
  const parsed = Number.parseInt(
    process.env.MODEL_CIRCUIT_COOLDOWN_MS ?? "",
    10,
  );
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 60_000;
}

export function isProviderAvailable(
  providerId: string,
  now = Date.now(),
): boolean {
  const state = states.get(providerId);
  if (!state || state.openedAt === null) return true;
  if (now - state.openedAt >= cooldownMs()) {
    // Half-open: allow one probe; success clears, failure re-opens.
    return true;
  }
  return false;
}

export function recordProviderSuccess(providerId: string): void {
  states.delete(providerId);
}

export function recordProviderFailure(
  providerId: string,
  now = Date.now(),
): void {
  const state = states.get(providerId) ?? { failures: 0, openedAt: null };
  state.failures += 1;
  if (state.failures >= failureThreshold()) {
    state.openedAt = now;
  }
  states.set(providerId, state);
}

export function resetProviderHealth(): void {
  states.clear();
}

export interface ProviderHealthSnapshot {
  providerId: string;
  failures: number;
  open: boolean;
  openedAt: string | null;
}

export function providerHealthSnapshot(
  now = Date.now(),
): ProviderHealthSnapshot[] {
  return [...states.entries()].map(([providerId, state]) => ({
    providerId,
    failures: state.failures,
    open:
      state.openedAt !== null && now - state.openedAt < cooldownMs(),
    openedAt:
      state.openedAt === null
        ? null
        : new Date(state.openedAt).toISOString(),
  }));
}
