/**
 * Banked-resets badge for a ledger row: a compact chip (uses left + next
 * expiry) that opens a small panel listing each reset. Read-only; spending a
 * reset stays in the card view. Every provider uses the same words here.
 */

import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconTimer } from '@/components/ui/icons';
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

export type LedgerResetsProps = {
  resets: BankedReset[];
  now: number;
  locale?: string;
};

export function LedgerResets({ resets, now, locale }: LedgerResetsProps) {
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

  const { uses, nextExpiryMs } = summarizeBankedResets(resets);
  if (uses === 0) return null;
  const soon = nextExpiryMs !== null && nextExpiryMs - now <= RESET_EXPIRY_SOON_MS;
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
        <span className={styles.count}>{t('quota_management.resets_count', { count: uses })}</span>
        {nextExpiryMs !== null && (
          <span className={soon ? `${styles.expiry} ${styles.expirySoon}` : styles.expiry}>
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
                <div className={styles.itemHead}>
                  <span className={styles.itemName}>{t('quota_management.resets_item')}</span>
                  <span className={styles.itemUses}>
                    {t('quota_management.resets_uses', {
                      left: reset.usesLeft,
                      total: reset.usesTotal,
                    })}
                  </span>
                </div>
                <div className={styles.itemLine}>
                  {t('quota_management.resets_clears', {
                    windows: reset.clears.map((scope) => t(SCOPE_KEYS[scope])).join(', '),
                  })}
                </div>
                <div className={styles.itemLine}>
                  {reset.expiresAtMs === null ? (
                    t('quota_management.resets_no_expiry')
                  ) : (
                    <>
                      {t('quota_management.resets_expires_at', {
                        date: formatInstantShort(reset.expiresAtMs),
                      })}
                      <span
                        className={
                          reset.expiresAtMs - now <= RESET_EXPIRY_SOON_MS
                            ? `${styles.itemRelative} ${styles.expirySoon}`
                            : styles.itemRelative
                        }
                      >
                        {formatRelativeInstant(reset.expiresAtMs, now, locale)}
                      </span>
                    </>
                  )}
                </div>
                {reset.paused && (
                  <span className={styles.paused}>{t('quota_management.resets_paused')}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
