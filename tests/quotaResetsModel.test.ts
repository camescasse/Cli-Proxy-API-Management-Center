/**
 * Banked resets: Claude reset grants and Codex manual reset credits become
 * one entry per use, with expired and spent resets dropped and the soonest
 * expiry first. Also covers why a Claude reset cannot be used.
 */

import { describe, expect, test } from 'bun:test';
import type { AnthropicResetGrantStatus } from '@/services/api/claudeResetGrants';
import {
  claudeBankedResets,
  claudeResetBlocker,
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
  test('lists one entry per use left, drops spent and expired grants, soonest first', () => {
    const resets = claudeBankedResets(
      status([
        grant({ id: 'later', resetsLeft: 1, endsAt: iso(NOW + 20 * DAY) }),
        grant({ id: 'spent', resetsLeft: 0 }),
        grant({ id: 'expired', endsAt: iso(NOW - DAY) }),
        grant({ id: 'sooner', resetsLeft: 2, endsAt: iso(NOW + 2 * DAY), paused: true }),
        grant({ id: 'open-ended', resetsLeft: 1, endsAt: null, clears: [] }),
      ]),
      NOW
    );

    expect(resets.map((reset) => reset.id)).toEqual([
      'sooner:0',
      'sooner:1',
      'later:0',
      'open-ended:0',
    ]);
    expect(resets[0]).toEqual({
      id: 'sooner:0',
      clears: ['five_hour', 'seven_day'],
      expiresAtMs: NOW + 2 * DAY,
      paused: true,
    });
    // A grant that names no window clears whatever the provider decides.
    expect(resets[3]).toMatchObject({ clears: ['all'], expiresAtMs: null });
  });

  test('returns nothing before the grants were read', () => {
    expect(claudeBankedResets(null, NOW)).toEqual([]);
  });
});

describe('claudeResetBlocker', () => {
  test('allows a use when a grant is usable and the account is at a limit', () => {
    expect(claudeResetBlocker({ ...status([grant({})]), atLimit: true }, NOW)).toBeNull();
  });

  test('explains why no reset can be used', () => {
    expect(claudeResetBlocker(status([grant({})]), NOW)).toBe('not_limited');
    expect(
      claudeResetBlocker(
        { ...status([grant({})]), atLimit: true, cooldownUntil: iso(NOW + DAY) },
        NOW
      )
    ).toBe('cooldown');
    expect(claudeResetBlocker({ ...status([grant({ paused: true })]), atLimit: true }, NOW)).toBe(
      'paused'
    );
    expect(claudeResetBlocker({ ...status([grant({})]), eligible: false }, NOW)).toBe('ineligible');
    expect(claudeResetBlocker(status([grant({ resetsLeft: 0 })]), NOW)).toBe('not_usable');
    expect(claudeResetBlocker(null, NOW)).toBeNull();
  });
});

describe('codexBankedResets', () => {
  test('keeps available credits as one entry each, for all usage limits', () => {
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

    expect(resets.map((reset) => [reset.id, reset.clears])).toEqual([
      ['a', ['all']],
      ['b', ['all']],
    ]);
  });

  test('returns nothing until the quota loaded', () => {
    expect(codexBankedResets(undefined, NOW)).toEqual([]);
    expect(codexBankedResets({ status: 'loading' }, NOW)).toEqual([]);
  });
});

describe('summarizeBankedResets', () => {
  test('counts the resets and finds the soonest expiry', () => {
    const resets = claudeBankedResets(
      status([
        grant({ id: 'x', resetsLeft: 2, endsAt: iso(NOW + 9 * DAY) }),
        grant({ id: 'y', resetsLeft: 1, endsAt: iso(NOW + 3 * DAY) }),
        grant({ id: 'z', resetsLeft: 1, endsAt: null }),
      ]),
      NOW
    );
    expect(summarizeBankedResets(resets)).toEqual({ count: 4, nextExpiryMs: NOW + 3 * DAY });
    expect(summarizeBankedResets([])).toEqual({ count: 0, nextExpiryMs: null });
  });
});
