/**
 * Quota ledger: one window shape for every provider, plus the per-provider
 * summary the ledger view shows above its rows.
 *
 * Pure functions over cached quota states — no React, no clock of its own
 * (`now` is always passed in), so every case here is directly testable.
 * Read structurally per provider, like quotaTimelineModel, because the state
 * shapes disagree about where a window lives and what its percentage means.
 */

import type { QuotaProviderType } from './providers/types';

/** One quota window of one credential. */
export interface LedgerWindow {
  /** Stable within a provider, so the same window lines up across credentials. */
  id: string;
  /** Display label as stored; prefer `labelKey` when present (language may change). */
  label: string;
  labelKey?: string;
  labelParams?: Record<string, string | number>;
  /** Remaining percent, 0..100; null when the payload reported none. */
  remaining: number | null;
  resetAtMs: number | null;
  periodHours: number | null;
}

/** Windows at least this long count as the provider's capacity, not a burst limit. */
export const LEDGER_LONG_WINDOW_HOURS = 24;

const clampPercent = (value: number) => Math.min(100, Math.max(0, value));

const finiteOrNull = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const remainingFromUsed = (used: unknown): number | null => {
  const value = finiteOrNull(used);
  return value === null ? null : clampPercent(100 - value);
};

interface PercentWindowLike {
  id?: string;
  label?: string;
  labelKey?: string;
  labelParams?: Record<string, string | number>;
  usedPercent?: number | null;
  resetAtMs?: number | null;
  periodHours?: number | null;
}

/**
 * Normalize one credential's quota into ledger windows, in the provider's own order.
 * Anything other than a successful state yields no windows.
 */
export function buildLedgerWindows(
  provider: QuotaProviderType,
  quota: { status?: string } | undefined
): LedgerWindow[] {
  if (!quota || quota.status !== 'success') return [];

  if (provider === 'claude' || provider === 'codex') {
    return ((quota as { windows?: PercentWindowLike[] }).windows ?? []).map((window, index) => ({
      id: window.id ?? `window-${index}`,
      label: window.label ?? '',
      labelKey: window.labelKey,
      labelParams: window.labelParams,
      // Claude and Codex store percent USED.
      remaining: remainingFromUsed(window.usedPercent),
      resetAtMs: finiteOrNull(window.resetAtMs),
      periodHours: finiteOrNull(window.periodHours),
    }));
  }

  if (provider === 'devin') {
    const windows =
      (
        quota as {
          windows?: {
            id: string;
            remainingPercent: number | null;
            resetAtMs: number | null;
            periodHours: number;
          }[];
        }
      ).windows ?? [];
    return windows.map((window) => ({
      id: window.id,
      label: window.id,
      labelKey: `devin_quota.${window.id}`,
      remaining:
        finiteOrNull(window.remainingPercent) === null
          ? null
          : clampPercent(window.remainingPercent as number),
      resetAtMs: finiteOrNull(window.resetAtMs),
      periodHours: finiteOrNull(window.periodHours),
    }));
  }

  if (provider === 'xai') {
    const billing = (
      quota as {
        billing?: {
          periodType?: string;
          usagePercent?: number | null;
          resetAtMs?: number | null;
          periodHours?: number | null;
        } | null;
      }
    ).billing;
    // Only the weekly limit is a quota window; the monthly figure is a billing cycle.
    if (!billing || billing.periodType !== 'weekly') return [];
    return [
      {
        id: 'weekly',
        label: '7-day limit',
        labelKey: 'xai_quota.weekly_limit',
        remaining: remainingFromUsed(billing.usagePercent),
        resetAtMs: finiteOrNull(billing.resetAtMs),
        periodHours: finiteOrNull(billing.periodHours) ?? 24 * 7,
      },
    ];
  }

  if (provider === 'antigravity') {
    const groups =
      (
        quota as {
          groups?: {
            buckets?: {
              id?: string;
              label?: string;
              remainingFraction?: number | null;
              resetAtMs?: number | null;
              periodHours?: number | null;
            }[];
          }[];
        }
      ).groups ?? [];
    // Antigravity reports the fraction REMAINING.
    return groups
      .flatMap((group) => group.buckets ?? [])
      .map((bucket, index) => {
        const fraction = finiteOrNull(bucket.remainingFraction);
        return {
          id: bucket.id ?? `bucket-${index}`,
          label: bucket.label ?? '',
          remaining: fraction === null ? null : clampPercent(Math.round(fraction * 100)),
          resetAtMs: finiteOrNull(bucket.resetAtMs),
          periodHours: finiteOrNull(bucket.periodHours),
        };
      });
  }

  if (provider === 'kimi') {
    const rows =
      (
        quota as {
          rows?: {
            id: string;
            label?: string;
            labelKey?: string;
            labelParams?: Record<string, string | number>;
            used: number;
            limit: number;
            resetAtMs?: number | null;
            periodHours?: number | null;
          }[];
        }
      ).rows ?? [];
    // Kimi reports raw counts; remaining is derived.
    return rows.map((row) => ({
      id: row.id,
      label: row.label ?? '',
      labelKey: row.labelKey,
      labelParams: row.labelParams,
      remaining:
        row.limit > 0 ? clampPercent(Math.round(((row.limit - row.used) / row.limit) * 100)) : null,
      resetAtMs: finiteOrNull(row.resetAtMs),
      periodHours: finiteOrNull(row.periodHours),
    }));
  }

  if (provider === 'meta') {
    const windows =
      (
        quota as {
          data?: {
            windows?: {
              id: 'window' | 'weekly';
              usedPercent: number | null;
              resetAt?: number;
              durationMinutes?: number;
            }[];
          };
        }
      ).data?.windows ?? [];
    return windows.map((window) => {
      // The upstream weekly bucket has no duration field; its scope defines seven days.
      const minutes = window.id === 'weekly' ? 7 * 24 * 60 : finiteOrNull(window.durationMinutes);
      const resetAt = finiteOrNull(window.resetAt);
      return {
        id: window.id,
        label: window.id,
        labelKey: `meta_quota.${window.id}`,
        remaining: remainingFromUsed(window.usedPercent),
        // Unix seconds from the upstream Meta contract.
        resetAtMs: resetAt === null ? null : resetAt * 1000,
        periodHours: minutes === null ? null : minutes / 60,
      };
    });
  }

  return [];
}

/* --------------------------------------------------------------- summary */

/** One window id totalled across a provider's credentials. */
export interface LedgerWindowTotal {
  id: string;
  window: LedgerWindow;
  /** Sum of remaining percent over credentials that report a value. */
  total: number;
  /** 100 × credentials that report a value. */
  capacity: number;
  reporting: number;
}

/** One credential's share of the headline window, for the segmented bar. */
export interface LedgerSegment {
  key: string;
  remaining: number | null;
}

export interface LedgerProviderSummary {
  provider: QuotaProviderType;
  credentialCount: number;
  headline: LedgerWindowTotal | null;
  segments: LedgerSegment[];
  /** Soonest upcoming reset of the headline window across credentials. */
  nextResetMs: number | null;
  /** Other long windows, most constrained first. */
  others: LedgerWindowTotal[];
}

export interface LedgerCredentialInput {
  key: string;
  windows: LedgerWindow[];
}

const isLong = (window: LedgerWindow) =>
  window.periodHours === null || window.periodHours >= LEDGER_LONG_WINDOW_HOURS;

const averageOf = (total: LedgerWindowTotal) =>
  total.reporting > 0 ? total.total / total.reporting : Number.POSITIVE_INFINITY;

/**
 * Codex can report model-scoped windows with the same period as the account
 * window. Keep the headline on the account window, as the timeline does.
 */
const PREFERRED_HEADLINE: Partial<Record<QuotaProviderType, string>> = {
  codex: 'weekly',
};

/** Total every window id across credentials, in first-seen order. */
export function totalLedgerWindows(credentials: readonly LedgerCredentialInput[]) {
  const totals = new Map<string, LedgerWindowTotal>();
  for (const credential of credentials) {
    for (const window of credential.windows) {
      let total = totals.get(window.id);
      if (!total) {
        total = { id: window.id, window, total: 0, capacity: 0, reporting: 0 };
        totals.set(window.id, total);
      }
      if (window.remaining !== null) {
        total.total += window.remaining;
        total.capacity += 100;
        total.reporting += 1;
      }
    }
  }
  return [...totals.values()];
}

/**
 * The window a provider is judged by: its most constrained long window.
 *
 * Short windows (5-hour) refill on their own within the day, so they only
 * headline when a provider has nothing longer.
 */
export function pickHeadlineWindow(
  provider: QuotaProviderType,
  totals: readonly LedgerWindowTotal[]
): LedgerWindowTotal | null {
  if (totals.length === 0) return null;
  const preferredId = PREFERRED_HEADLINE[provider];
  const preferred = preferredId
    ? totals.find((total) => total.id === preferredId && total.reporting > 0)
    : undefined;
  if (preferred) return preferred;

  const long = totals.filter((total) => isLong(total.window));
  const pool = long.length > 0 ? long : totals;
  const reporting = pool.filter((total) => total.reporting > 0);
  if (reporting.length === 0) return pool[0];
  // Lowest average remaining; source order breaks a tie.
  return reporting.reduce((best, total) => (averageOf(total) < averageOf(best) ? total : best));
}

export function summarizeLedgerProvider(
  provider: QuotaProviderType,
  credentials: readonly LedgerCredentialInput[],
  now: number
): LedgerProviderSummary {
  const totals = totalLedgerWindows(credentials);
  const headline = pickHeadlineWindow(provider, totals);

  const segments = credentials.map((credential) => ({
    key: credential.key,
    remaining: headline
      ? (credential.windows.find((window) => window.id === headline.id)?.remaining ?? null)
      : null,
  }));

  let nextResetMs: number | null = null;
  if (headline) {
    for (const credential of credentials) {
      const resetAtMs = credential.windows.find((window) => window.id === headline.id)?.resetAtMs;
      if (typeof resetAtMs === 'number' && resetAtMs > now) {
        nextResetMs = nextResetMs === null ? resetAtMs : Math.min(nextResetMs, resetAtMs);
      }
    }
  }

  const others = totals
    .filter((total) => total !== headline && isLong(total.window) && total.reporting > 0)
    .sort((a, b) => averageOf(a) - averageOf(b));

  return {
    provider,
    credentialCount: credentials.length,
    headline,
    segments,
    nextResetMs,
    others,
  };
}

/** Row column order: the provider's headline window first, then the payload order. */
export function orderLedgerWindows(
  windows: readonly LedgerWindow[],
  headlineId: string | null
): LedgerWindow[] {
  if (!headlineId) return [...windows];
  const headline = windows.find((window) => window.id === headlineId);
  return headline ? [headline, ...windows.filter((window) => window !== headline)] : [...windows];
}

/* --------------------------------------------------------------- masking */

const EMAIL_PATTERN = /([A-Za-z0-9._%+]+)@([A-Za-z0-9-]+)((?:\.[A-Za-z0-9-]+)+)/g;
const MASK = '•••';

/**
 * Hide the email inside a credential name, keeping just enough to tell
 * credentials apart: `claude-team@example.dev.json` → `claude-t•••@e•••.dev.json`.
 */
export function maskEmails(name: string): string {
  return name.replace(
    EMAIL_PATTERN,
    (_match, local: string, domain: string, rest: string) =>
      `${local.slice(0, 1)}${MASK}@${domain.slice(0, 1)}${MASK}${rest}`
  );
}
