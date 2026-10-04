/**
 * Resets badge for a ledger row: a compact chip (resets left + next expiry)
 * that opens a small panel listing each reset and offering to use one.
 * Every provider uses the same words here. The provider decides which reset
 * a use spends, so the panel has one action rather than one per entry.
 */

import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconRefreshCw, IconTimer } from '@/components/ui/icons';
import { formatInstantShort, formatRelativeInstant } from '@/utils/quota';
import {
  RESET_EXPIRY_SOON_MS,
  summarizeBankedResets,
  type BankedReset,
  type BankedResetScope,
} from '../quotaResetsModel';
import styles from './LedgerResets.module.scss';

const SCOPE_KEYS: Record<BankedResetScope, string> = {
  five_hour: 'quota_management.window_five_hour',
  seven_day: 'quota_management.window_seven_day',
  seven_day_overage_included: 'quota_management.window_seven_day_overage',
  all: 'quota_management.window_all',
};

export type LedgerResetAction = {
  label: string;
  disabled: boolean;
  busy: boolean;
  /** Why the action is unavailable, or the outcome of the last attempt. */
  hint?: string | null;
  /** Opens the provider's confirmation; nothing is spent without it. */
  onUse: () => void;
};

export type LedgerResetsProps = {
  resets: BankedReset[];
  now: number;
  locale?: string;
  action?: LedgerResetAction;
};

export function LedgerResets({ resets, now, locale, action }: LedgerResetsProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const { count, nextExpiryMs } = summarizeBankedResets(resets);
  if (count === 0) return null;
  const isSoon = (ms: number) => ms - now <= RESET_EXPIRY_SOON_MS;
  const title = t('quota_management.resets_title');

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className={styles.chip}
        aria-expanded={open}
        aria-controls={panelId}
        title={title}
        onClick={() => setOpen((value) => !value)}
      >
        <IconTimer size={11} aria-hidden="true" />
        <span className={styles.count}>{t('quota_management.resets_count', { count })}</span>
        {nextExpiryMs !== null && (
          <span
            className={isSoon(nextExpiryMs) ? `${styles.expiry} ${styles.soon}` : styles.expiry}
          >
            {t('quota_management.resets_expires', {
              relative: formatRelativeInstant(nextExpiryMs, now, locale),
            })}
          </span>
        )}
      </button>

      {open && (
        <div id={panelId} className={styles.panel} role="dialog" aria-label={title}>
          <div className={styles.panelTitle}>{title}</div>
          <ul className={styles.list}>
            {resets.map((reset) => (
              <li key={reset.id} className={styles.item}>
                <div className={styles.itemExpiry}>
                  {reset.expiresAtMs === null ? (
                    t('quota_management.resets_no_expiry')
                  ) : (
                    <>
                      {t('quota_management.resets_expires_at', {
                        date: formatInstantShort(reset.expiresAtMs),
                      })}
                      <span
                        className={
                          isSoon(reset.expiresAtMs)
                            ? `${styles.itemRelative} ${styles.soon}`
                            : styles.itemRelative
                        }
                      >
                        {formatRelativeInstant(reset.expiresAtMs, now, locale)}
                      </span>
                    </>
                  )}
                  {reset.paused && (
                    <span className={styles.paused}>{t('quota_management.resets_paused')}</span>
                  )}
                </div>
                <div className={styles.itemClears}>
                  {t('quota_management.resets_clears', {
                    windows: reset.clears.map((scope) => t(SCOPE_KEYS[scope])).join(', '),
                  })}
                </div>
              </li>
            ))}
          </ul>
          {action && (
            <div className={styles.footer}>
              {action.hint && <span className={styles.hint}>{action.hint}</span>}
              <button
                type="button"
                className={styles.useButton}
                disabled={action.disabled}
                onClick={() => {
                  setOpen(false);
                  action.onUse();
                }}
              >
                <IconRefreshCw
                  size={12}
                  aria-hidden="true"
                  className={action.busy ? styles.spinning : undefined}
                />
                {action.label}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
