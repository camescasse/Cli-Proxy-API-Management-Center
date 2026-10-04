/**
 * Banked resets: one shape for every provider's spendable quota resets.
 *
 * Claude reports reset grants (several uses each, clearing named windows);
 * Codex reports manual reset credits (one use each). The ledger shows both
 * with the same words, so the provider differences end here.
 */

import type {
  AnthropicResetGrantStatus,
  AnthropicResetWindow,
} from '@/services/api/claudeResetGrants';

/** Which limits a reset clears. 'all' = the provider does not name them. */
export type BankedResetScope = AnthropicResetWindow | 'all';

export interface BankedReset {
  id: string;
  usesLeft: number;
  usesTotal: number;
  clears: BankedResetScope[];
  /** Expiry instant in epoch ms; null when the provider states none. */
  expiresAtMs: number | null;
  paused: boolean;
}

export interface BankedResetSummary {
  uses: number;
  /** Soonest upcoming expiry among resets with uses left. */
  nextExpiryMs: number | null;
}

const parseMs = (value: string | null | undefined): number | null => {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
};

const notExpired = (reset: BankedReset, now: number) =>
  reset.expiresAtMs === null || reset.expiresAtMs > now;

/** Claude reset grants with uses left, soonest expiry first. */
export function claudeBankedResets(
  status: AnthropicResetGrantStatus | null,
  now: number
): BankedReset[] {
  if (!status) return [];
  return sortByExpiry(
    status.grants
      .filter((grant) => grant.resetsLeft > 0)
      .map((grant): BankedReset => ({
        id: grant.id,
        usesLeft: grant.resetsLeft,
        usesTotal: grant.resetsTotal,
        clears: grant.clears.length > 0 ? [...grant.clears] : ['all'],
        expiresAtMs: parseMs(grant.endsAt),
        paused: grant.paused,
      }))
      .filter((reset) => notExpired(reset, now))
  );
}

interface CodexResetsLike {
  status?: string;
  rateLimitResetCredits?: { id?: string; status?: string; expiresAt?: string }[];
}

/** Codex manual reset credits that are still available, soonest expiry first. */
export function codexBankedResets(quota: CodexResetsLike | undefined, now: number): BankedReset[] {
  if (!quota || quota.status !== 'success') return [];
  return sortByExpiry(
    (quota.rateLimitResetCredits ?? [])
      .filter((credit) => credit.status === 'available')
      .map((credit, index): BankedReset => ({
        id: credit.id || `credit-${index}`,
        usesLeft: 1,
        usesTotal: 1,
        clears: ['all'],
        expiresAtMs: parseMs(credit.expiresAt),
        paused: false,
      }))
      .filter((reset) => notExpired(reset, now))
  );
}

function sortByExpiry(resets: BankedReset[]): BankedReset[] {
  return resets.sort((a, b) => {
    if (a.expiresAtMs === b.expiresAtMs) return 0;
    if (a.expiresAtMs === null) return 1;
    if (b.expiresAtMs === null) return -1;
    return a.expiresAtMs - b.expiresAtMs;
  });
}

export function summarizeBankedResets(resets: readonly BankedReset[]): BankedResetSummary {
  let uses = 0;
  let nextExpiryMs: number | null = null;
  for (const reset of resets) {
    uses += reset.usesLeft;
    if (reset.expiresAtMs !== null) {
      nextExpiryMs =
        nextExpiryMs === null ? reset.expiresAtMs : Math.min(nextExpiryMs, reset.expiresAtMs);
    }
  }
  return { uses, nextExpiryMs };
}

/** Expiry this close counts as soon, so the badge can draw attention to it. */
export const RESET_EXPIRY_SOON_MS = 3 * 24 * 60 * 60 * 1000;
