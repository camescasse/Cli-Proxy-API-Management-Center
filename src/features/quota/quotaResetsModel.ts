/**
 * Banked resets: one shape for every provider's spendable quota resets.
 *
 * Claude reports reset grants (several uses each, clearing named windows);
 * Codex reports manual reset credits (one use each). Each use becomes one
 * entry here, so the ledger shows both providers with the same words.
 */

import {
  anthropicResetGrantBlocker,
  type AnthropicResetGrantStatus,
  type AnthropicResetWindow,
} from '@/services/api/claudeResetGrants';
import { selectResetGrant } from './providers/claude/selectResetGrant';

/** Which limits a reset clears. 'all' = the provider does not name them. */
export type BankedResetScope = AnthropicResetWindow | 'all';

/** One spendable reset (one use). */
export interface BankedReset {
  id: string;
  clears: BankedResetScope[];
  /** Expiry instant in epoch ms; null when the provider states none. */
  expiresAtMs: number | null;
  paused: boolean;
}

export interface BankedResetSummary {
  count: number;
  /** Soonest upcoming expiry. */
  nextExpiryMs: number | null;
}

const parseMs = (value: string | null | undefined): number | null => {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
};

const notExpired = (reset: BankedReset, now: number) =>
  reset.expiresAtMs === null || reset.expiresAtMs > now;

/** Claude reset grants as one entry per use left, soonest expiry first. */
export function claudeBankedResets(
  status: AnthropicResetGrantStatus | null,
  now: number
): BankedReset[] {
  if (!status) return [];
  return sortByExpiry(
    status.grants
      .flatMap((grant) =>
        Array.from(
          { length: Math.max(0, grant.resetsLeft) },
          (_, use): BankedReset => ({
            id: `${grant.id}:${use}`,
            clears: grant.clears.length > 0 ? [...grant.clears] : ['all'],
            expiresAtMs: parseMs(grant.endsAt),
            paused: grant.paused,
          })
        )
      )
      .filter((reset) => notExpired(reset, now))
  );
}

/** Why no Claude reset can be spent now; null when one can. */
export type ClaudeResetBlocker =
  | 'cooldown'
  | 'not_limited'
  | 'paused'
  | 'ineligible'
  | 'not_usable';

export function claudeResetBlocker(
  status: AnthropicResetGrantStatus | null,
  now: number
): ClaudeResetBlocker | null {
  if (!status) return null;
  if (status.cooldownUntil && Date.parse(status.cooldownUntil) > now) return 'cooldown';
  if (selectResetGrant(status, now)) return null;
  const candidate = status.grants.find(
    (grant) => grant.resetsLeft > 0 && (!grant.endsAt || Date.parse(grant.endsAt) > now)
  );
  if (!candidate) return 'not_usable';
  const reason = anthropicResetGrantBlocker(status, candidate.id);
  return reason === 'not_limited' || reason === 'paused' || reason === 'ineligible'
    ? reason
    : 'not_usable';
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
      .map(
        (credit, index): BankedReset => ({
          id: credit.id || `credit-${index}`,
          clears: ['all'],
          expiresAtMs: parseMs(credit.expiresAt),
          paused: false,
        })
      )
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
  let nextExpiryMs: number | null = null;
  for (const reset of resets) {
    if (reset.expiresAtMs !== null) {
      nextExpiryMs =
        nextExpiryMs === null ? reset.expiresAtMs : Math.min(nextExpiryMs, reset.expiresAtMs);
    }
  }
  return { count: resets.length, nextExpiryMs };
}

/** Expiry this close counts as soon, so the badge can draw attention to it. */
export const RESET_EXPIRY_SOON_MS = 3 * 24 * 60 * 60 * 1000;
