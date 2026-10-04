/**
 * Ledger view model: per-provider window normalization, the provider summary
 * (headline window, totals, segments, next reset) and email masking.
 */

import { describe, expect, test } from 'bun:test';
import {
  buildLedgerWindows,
  maskEmails,
  orderLedgerWindows,
  pickHeadlineWindow,
  summarizeLedgerProvider,
  totalLedgerWindows,
  type LedgerWindow,
} from '@/features/quota/quotaLedgerModel';

const NOW = Date.UTC(2026, 9, 4, 12, 0, 0);
const HOUR = 60 * 60 * 1000;

const window = (overrides: Partial<LedgerWindow> & { id: string }): LedgerWindow => ({
  label: overrides.id,
  remaining: 100,
  resetAtMs: null,
  periodHours: 168,
  ...overrides,
});

describe('buildLedgerWindows', () => {
  test('returns nothing until the quota loaded successfully', () => {
    expect(buildLedgerWindows('claude', undefined)).toEqual([]);
    expect(buildLedgerWindows('claude', { status: 'loading' })).toEqual([]);
    expect(buildLedgerWindows('claude', { status: 'error' })).toEqual([]);
  });

  test('turns Claude and Codex percent used into percent remaining', () => {
    const windows = buildLedgerWindows('claude', {
      status: 'success',
      windows: [
        {
          id: 'five-hour',
          label: '5-hour limit',
          labelKey: 'claude_quota.five_hour',
          usedPercent: 25,
          resetAtMs: NOW + HOUR,
          periodHours: 5,
        },
        { id: 'seven-day', label: '7-day limit', usedPercent: 140, resetAtMs: null },
        { id: 'seven-day-opus', label: '7-day Opus', usedPercent: null },
      ],
    } as never);

    expect(windows.map((w) => [w.id, w.remaining, w.resetAtMs, w.periodHours])).toEqual([
      ['five-hour', 75, NOW + HOUR, 5],
      ['seven-day', 0, null, null],
      ['seven-day-opus', null, null, null],
    ]);
    expect(windows[0].labelKey).toBe('claude_quota.five_hour');
  });

  test('keeps only the weekly xAI limit, never the monthly billing cycle', () => {
    expect(
      buildLedgerWindows('xai', {
        status: 'success',
        billing: { periodType: 'monthly', usagePercent: 10, resetAtMs: NOW + HOUR },
      } as never)
    ).toEqual([]);

    const [weekly] = buildLedgerWindows('xai', {
      status: 'success',
      billing: { periodType: 'weekly', usagePercent: 40, resetAtMs: NOW + HOUR },
    } as never);
    expect(weekly).toMatchObject({ id: 'weekly', remaining: 60, periodHours: 168 });
  });

  test('reads Antigravity fractions, Kimi counts and Meta reset seconds', () => {
    const antigravity = buildLedgerWindows('antigravity', {
      status: 'success',
      groups: [{ buckets: [{ id: 'pro', label: 'Pro', remainingFraction: 0.375 }] }],
    } as never);
    expect(antigravity[0]).toMatchObject({ id: 'pro', remaining: 38 });

    const kimi = buildLedgerWindows('kimi', {
      status: 'success',
      rows: [
        { id: 'weekly', label: 'Weekly', used: 30, limit: 120 },
        { id: 'broken', label: 'Broken', used: 1, limit: 0 },
      ],
    } as never);
    expect(kimi.map((w) => w.remaining)).toEqual([75, null]);

    const meta = buildLedgerWindows('meta', {
      status: 'success',
      data: {
        windows: [
          { id: 'window', usedPercent: 10, resetAt: 1_800_000_000, durationMinutes: 300 },
          { id: 'weekly', usedPercent: 50, resetAt: 1_800_000_000 },
        ],
      },
    } as never);
    expect(meta.map((w) => [w.id, w.remaining, w.resetAtMs, w.periodHours])).toEqual([
      ['window', 90, 1_800_000_000_000, 5],
      ['weekly', 50, 1_800_000_000_000, 168],
    ]);
  });
});

describe('pickHeadlineWindow', () => {
  test('headlines the most constrained long window, not the 5-hour burst', () => {
    const totals = totalLedgerWindows([
      {
        key: 'a',
        windows: [
          window({ id: 'five-hour', remaining: 10, periodHours: 5 }),
          window({ id: 'seven-day', remaining: 90 }),
          window({ id: 'seven-day-fable', remaining: 60 }),
        ],
      },
      {
        key: 'b',
        windows: [
          window({ id: 'five-hour', remaining: 20, periodHours: 5 }),
          window({ id: 'seven-day', remaining: 80 }),
          window({ id: 'seven-day-fable', remaining: 70 }),
        ],
      },
    ]);
    expect(pickHeadlineWindow('claude', totals)?.id).toBe('seven-day-fable');
  });

  test('keeps Codex on the account weekly window over a lower model window', () => {
    const totals = totalLedgerWindows([
      {
        key: 'a',
        windows: [
          window({ id: 'weekly', remaining: 80 }),
          window({ id: 'spark-weekly', remaining: 5 }),
        ],
      },
    ]);
    expect(pickHeadlineWindow('codex', totals)?.id).toBe('weekly');
  });

  test('falls back to a short window when the provider has nothing longer', () => {
    const totals = totalLedgerWindows([
      { key: 'a', windows: [window({ id: 'window', remaining: 40, periodHours: 5 })] },
    ]);
    expect(pickHeadlineWindow('meta', totals)?.id).toBe('window');
  });

  test('returns the first long window when no credential reports a value', () => {
    const totals = totalLedgerWindows([
      { key: 'a', windows: [window({ id: 'weekly', remaining: null })] },
    ]);
    expect(pickHeadlineWindow('xai', totals)?.id).toBe('weekly');
    expect(pickHeadlineWindow('xai', [])).toBeNull();
  });
});

describe('summarizeLedgerProvider', () => {
  test('totals the headline window across credentials that report it', () => {
    const summary = summarizeLedgerProvider(
      'claude',
      [
        {
          key: 'a',
          windows: [
            window({ id: 'seven-day', remaining: 58, resetAtMs: NOW + 30 * HOUR }),
            window({ id: 'seven-day-opus', remaining: 90 }),
            window({ id: 'five-hour', remaining: 100, periodHours: 5 }),
          ],
        },
        {
          key: 'b',
          windows: [
            window({ id: 'seven-day', remaining: 100, resetAtMs: NOW + 4 * 24 * HOUR }),
            window({ id: 'seven-day-opus', remaining: 95 }),
          ],
        },
        // Not loaded yet: an empty segment, and no share of the capacity.
        { key: 'c', windows: [] },
      ],
      NOW
    );

    expect(summary.credentialCount).toBe(3);
    expect(summary.headline).toMatchObject({ id: 'seven-day', total: 158, capacity: 200 });
    expect(summary.segments).toEqual([
      { key: 'a', remaining: 58 },
      { key: 'b', remaining: 100 },
      { key: 'c', remaining: null },
    ]);
    expect(summary.nextResetMs).toBe(NOW + 30 * HOUR);
    // Short windows never appear among the other totals.
    expect(summary.others.map((total) => [total.id, total.total])).toEqual([
      ['seven-day-opus', 185],
    ]);
  });

  test('ignores resets that already passed', () => {
    const summary = summarizeLedgerProvider(
      'codex',
      [
        { key: 'a', windows: [window({ id: 'weekly', remaining: 50, resetAtMs: NOW - HOUR })] },
        { key: 'b', windows: [window({ id: 'weekly', remaining: 50, resetAtMs: NOW + HOUR })] },
      ],
      NOW
    );
    expect(summary.nextResetMs).toBe(NOW + HOUR);
  });
});

describe('orderLedgerWindows', () => {
  test('moves the headline window first and keeps the rest in payload order', () => {
    const windows = [window({ id: 'a' }), window({ id: 'b' }), window({ id: 'c' })];
    expect(orderLedgerWindows(windows, 'c').map((w) => w.id)).toEqual(['c', 'a', 'b']);
    expect(orderLedgerWindows(windows, 'missing').map((w) => w.id)).toEqual(['a', 'b', 'c']);
    expect(orderLedgerWindows(windows, null).map((w) => w.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('maskEmails', () => {
  test('keeps the first letter of the local part and the domain', () => {
    expect(maskEmails('claude-team@example.dev.json')).toBe('claude-t•••@e•••.dev.json');
    expect(maskEmails('claude-4ad90f84-jane.doe@example.com.json')).toBe(
      'claude-4ad90f84-j•••@e•••.com.json'
    );
    expect(maskEmails('codex-e5d7523d-j.doe@mail.example.org-prolite.json')).toBe(
      'codex-e5d7523d-j•••@m•••.example.org-prolite.json'
    );
  });

  test('leaves names without an email alone', () => {
    expect(maskEmails('kimi-oauth.json')).toBe('kimi-oauth.json');
  });
});
