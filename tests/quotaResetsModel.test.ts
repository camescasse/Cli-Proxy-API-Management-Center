/**
 * Banked resets: Claude reset grants and Codex manual reset credits become
 * one shape, with expired and spent resets dropped and the soonest expiry first.
 */

import { describe, expect, test } from 'bun:test';
import type { AnthropicResetGrantStatus } from '@/services/api/claudeResetGrants';
import {
  claudeBankedResets,
  codexBankedResets,
  summarizeBankedResets,
} from '@/features/quota/quotaResetsModel';

const NOW = Date.UTC(2026, 9, 4, 12, 0, 0);
const DAY = 24 * 60 * 60 * 1000;
const iso = (ms: number) => new Date(ms).toISOString();

const grant = (overrides: Partial<AnthropicResetGrantStatus['grants'][number]>) => ({
  id: 'grant',
  label: 'Promo',
  resetsTotal: 3,
  resetsLeft: 2,
  startsAt: null,
  endsAt: iso(NOW + 10 * DAY),
  clears: ['five_hour' as const, 'seven_day' as const],
  paused: false,
  usableNow: true,
  useRequiresLimit: true,
  percentUsed: {},
  ...overrides,
});

const status = (grants: AnthropicResetGrantStatus['grants']): AnthropicResetGrantStatus => ({
  eligible: true,
  ineligibleReason: null,
  atLimit: false,
  grants,
  nextGrantId: null,
  weeklyResetsAt: null,
  cooldownUntil: null,
});

describe('claudeBankedResets', () => {
  test('keeps grants with uses left, drops spent and expired ones, soonest first', () => {
    const resets = claudeBankedResets(
      status([
        grant({ id: 'later', endsAt: iso(NOW + 20 * DAY) }),
        grant({ id: 'spent', resetsLeft: 0 }),
        grant({ id: 'expired', endsAt: iso(NOW - DAY) }),
        grant({ id: 'sooner', endsAt: iso(NOW + 2 * DAY), paused: true }),
        grant({ id: 'open-ended', endsAt: null, clears: [] }),
      ]),
      NOW
    );

    expect(resets.map((reset) => reset.id)).toEqual(['sooner', 'later', 'open-ended']);
    expect(resets[0]).toMatchObject({
      usesLeft: 2,
      usesTotal: 3,
      clears: ['five_hour', 'seven_day'],
      expiresAtMs: NOW + 2 * DAY,
      paused: true,
    });
    // A grant that names no window clears whatever the provider decides.
    expect(resets[2]).toMatchObject({ clears: ['all'], expiresAtMs: null });
  });

  test('returns nothing before the grants were read', () => {
    expect(claudeBankedResets(null, NOW)).toEqual([]);
  });
});

describe('codexBankedResets', () => {
  test('keeps available credits as single-use resets for all usage limits', () => {
    const resets = codexBankedResets(
      {
        status: 'success',
        rateLimitResetCredits: [
          { id: 'b', status: 'available', expiresAt: iso(NOW + 25 * DAY) },
          { id: 'used', status: 'consumed', expiresAt: iso(NOW + 5 * DAY) },
          { id: 'a', status: 'available', expiresAt: iso(NOW + 18 * DAY) },
          { id: 'gone', status: 'available', expiresAt: iso(NOW - DAY) },
        ],
      },
      NOW
    );

    expect(resets.map((reset) => [reset.id, reset.usesLeft, reset.clears])).toEqual([
      ['a', 1, ['all']],
      ['b', 1, ['all']],
    ]);
  });

  test('returns nothing until the quota loaded', () => {
    expect(codexBankedResets(undefined, NOW)).toEqual([]);
    expect(codexBankedResets({ status: 'loading' }, NOW)).toEqual([]);
  });
});

describe('summarizeBankedResets', () => {
  test('adds up uses and finds the soonest expiry', () => {
    const resets = claudeBankedResets(
      status([
        grant({ id: 'x', resetsLeft: 2, endsAt: iso(NOW + 9 * DAY) }),
        grant({ id: 'y', resetsLeft: 1, endsAt: iso(NOW + 3 * DAY) }),
        grant({ id: 'z', resetsLeft: 1, endsAt: null }),
      ]),
      NOW
    );
    expect(summarizeBankedResets(resets)).toEqual({ uses: 4, nextExpiryMs: NOW + 3 * DAY });
    expect(summarizeBankedResets([])).toEqual({ uses: 0, nextExpiryMs: null });
  });
});
