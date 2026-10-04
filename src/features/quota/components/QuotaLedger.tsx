/**
 * Ledger view: one summary card per provider, then every credential as a row
 * of quota windows grouped by provider.
 *
 * The cards answer "how much is left across all my accounts"; the rows answer
 * "which account, and when does it come back". Loading stays click-driven like
 * the card view: an idle row offers to load, it never fetches on its own.
 */

import { useMemo, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { IconRefreshCw } from '@/components/ui/icons';
import { useNow } from '@/hooks/useNow';
import type {
  AntigravityQuotaState,
  ClaudeQuotaState,
  CodexQuotaState,
  ResolvedTheme,
  XaiQuotaState,
} from '@/types';
import { formatInstantShort, formatRelativeInstant, resolveQuotaErrorMessage } from '@/utils/quota';
import { getQuotaCacheKey } from '@/utils/quota/identity';
import {
  getAuthFileIcon,
  getThemeSurfaceIconBackground,
  getTypeLabel,
  isThemeSurfaceIconProvider,
} from '@/features/authFiles/constants';
import { QUOTA_TAB_ORDER } from '../constants';
import { isQuotaRefreshDisabled, type QuotaFileEntry } from '../logic';
import { QUOTA_ADAPTERS, type QuotaCardState } from '../providers';
import type { QuotaProviderType } from '../providers/types';
import { resolveCodexPlanLabel } from '../providers/codex/data';
import {
  buildLedgerWindows,
  orderLedgerWindows,
  summarizeLedgerProvider,
  type LedgerProviderSummary,
  type LedgerWindow,
  type LedgerWindowTotal,
} from '../quotaLedgerModel';
import { QUOTA_PROGRESS_HIGH_THRESHOLD, QUOTA_PROGRESS_MEDIUM_THRESHOLD } from './QuotaMeter';
import styles from './QuotaLedger.module.scss';

export type QuotaLedgerProps = {
  /** Every credential in the active tab; the summary cards total these. */
  entries: QuotaFileEntry[];
  /** The current page of credentials, drawn as rows. */
  rows: QuotaFileEntry[];
  quotaFor: (entry: QuotaFileEntry) => QuotaCardState | undefined;
  displayNameFor: (entry: QuotaFileEntry) => string;
  resolvedTheme: ResolvedTheme;
  canRefresh: (entry: QuotaFileEntry) => boolean;
  onRefresh: (entry: QuotaFileEntry) => void;
};

const levelClass = (remaining: number | null) => {
  if (remaining === null) return '';
  if (remaining >= QUOTA_PROGRESS_HIGH_THRESHOLD) return styles.fillHigh;
  if (remaining >= QUOTA_PROGRESS_MEDIUM_THRESHOLD) return styles.fillMedium;
  return styles.fillLow;
};

const fillStyle = (remaining: number | null): CSSProperties => ({
  width: `${remaining === null ? 0 : Math.round(remaining * 100) / 100}%`,
});

const percentText = (value: number | null) => (value === null ? '--' : `${Math.round(value)}%`);

const windowLabel = (window: LedgerWindow, t: TFunction) =>
  window.labelKey ? t(window.labelKey, window.labelParams ?? {}) : window.label;

const resolvePlanLabel = (
  type: QuotaProviderType,
  quota: QuotaCardState | undefined,
  t: TFunction
): string | null => {
  if (quota?.status !== 'success') return null;
  if (type === 'claude') {
    const planType = (quota as unknown as ClaudeQuotaState).planType;
    return planType ? t(`claude_quota.${planType}`) : null;
  }
  if (type === 'codex') {
    return resolveCodexPlanLabel((quota as unknown as CodexQuotaState).planType, t);
  }
  if (type === 'antigravity') {
    const subscription = (quota as unknown as AntigravityQuotaState).subscription;
    return subscription?.tierName ?? subscription?.plan ?? null;
  }
  if (type === 'xai') {
    return (quota as unknown as XaiQuotaState).billing?.planLabel ?? null;
  }
  return null;
};

function ResetLine({ atMs, now, locale }: { atMs: number | null; now: number; locale?: string }) {
  const { t } = useTranslation();
  if (atMs === null) {
    return <span className={styles.resetNone}>{t('quota_management.ledger_no_reset')}</span>;
  }
  return (
    <>
      <span className={styles.resetRelative}>{formatRelativeInstant(atMs, now, locale)}</span>
      <span className={styles.resetAbsolute}>{formatInstantShort(atMs)}</span>
    </>
  );
}

function ProviderGlyph({ type, resolvedTheme }: { type: string; resolvedTheme: ResolvedTheme }) {
  const { t } = useTranslation();
  const iconSrc = getAuthFileIcon(type, resolvedTheme);
  const typeLabel = getTypeLabel(t, type);
  return (
    <span
      className={styles.glyph}
      style={
        isThemeSurfaceIconProvider(type)
          ? { background: getThemeSurfaceIconBackground(resolvedTheme) }
          : undefined
      }
      aria-hidden="true"
    >
      {iconSrc ? (
        <img src={iconSrc} alt="" className={styles.glyphImage} />
      ) : (
        <span className={styles.glyphFallback}>{typeLabel.slice(0, 1).toUpperCase()}</span>
      )}
    </span>
  );
}

function SummaryCard({
  summary,
  resolvedTheme,
  now,
  locale,
}: {
  summary: LedgerProviderSummary;
  resolvedTheme: ResolvedTheme;
  now: number;
  locale?: string;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const { headline, others } = summary;
  const reporting = headline !== null && headline.reporting > 0;
  const capacity = reporting ? headline.capacity : summary.credentialCount * 100;
  const extra: LedgerWindowTotal[] = expanded ? others.slice(1) : [];

  return (
    <article className={styles.summaryCard}>
      <header className={styles.summaryHead}>
        <ProviderGlyph type={summary.provider} resolvedTheme={resolvedTheme} />
        <span className={styles.summaryName}>{getTypeLabel(t, summary.provider)}</span>
        <span className={styles.summaryCount}>
          {t('quota_management.ledger_credentials', { count: summary.credentialCount })}
        </span>
      </header>
      <div className={styles.summaryLabel}>
        {headline ? windowLabel(headline.window, t) : t('quota_management.ledger_not_loaded')}
      </div>
      <div className={styles.summaryFigure}>
        <span className={styles.summaryValue}>
          {reporting ? `${Math.round(headline.total)}%` : '--'}
        </span>
        <span className={styles.summaryOf}>
          {t('quota_management.ledger_of', { capacity: `${capacity}%` })}
        </span>
      </div>
      <div className={styles.segments} aria-hidden="true">
        {summary.segments.map((segment) => (
          <span key={segment.key} className={styles.segment}>
            <span
              className={`${styles.segmentFill} ${levelClass(segment.remaining)}`}
              style={fillStyle(segment.remaining)}
            />
          </span>
        ))}
      </div>
      <div className={styles.summaryReset}>
        <ResetLine atMs={summary.nextResetMs} now={now} locale={locale} />
      </div>
      {others.length > 0 && (
        <footer className={styles.summaryFoot}>
          {[others[0], ...extra].map((total) => (
            <div key={total.id} className={styles.summaryOther}>
              <span className={styles.summaryOtherLabel}>{windowLabel(total.window, t)}</span>
              <span className={styles.summaryOtherValue}>{`${Math.round(total.total)}%`}</span>
            </div>
          ))}
          {others.length > 1 && (
            <button
              type="button"
              className={styles.summaryToggle}
              aria-expanded={expanded}
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? t('quota_management.ledger_hide') : t('quota_management.ledger_show')}
            </button>
          )}
        </footer>
      )}
    </article>
  );
}

function WindowCell({
  window,
  now,
  locale,
}: {
  window: LedgerWindow;
  now: number;
  locale?: string;
}) {
  const { t } = useTranslation();
  const label = windowLabel(window, t);
  return (
    <div className={styles.cell}>
      <div className={styles.cellHead}>
        <span className={styles.cellLabel} title={label}>
          {label}
        </span>
        <span className={styles.cellValue}>{percentText(window.remaining)}</span>
      </div>
      <div
        className={styles.track}
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={window.remaining === null ? undefined : Math.round(window.remaining)}
      >
        <span
          className={`${styles.trackFill} ${levelClass(window.remaining)}`}
          style={fillStyle(window.remaining)}
        />
      </div>
      <div className={styles.cellReset}>
        <ResetLine atMs={window.resetAtMs} now={now} locale={locale} />
      </div>
    </div>
  );
}

function LedgerRow({
  entry,
  quota,
  headlineId,
  displayName,
  canRefresh,
  onRefresh,
  now,
  locale,
}: {
  entry: QuotaFileEntry;
  quota: QuotaCardState | undefined;
  headlineId: string | null;
  displayName: string;
  canRefresh: boolean;
  onRefresh: () => void;
  now: number;
  locale?: string;
}) {
  const { t } = useTranslation();
  const adapter = QUOTA_ADAPTERS[entry.type];
  const status = quota?.status ?? 'idle';
  const loading = status === 'loading';
  const windows = useMemo(
    () => orderLedgerWindows(buildLedgerWindows(entry.type, quota), headlineId),
    [entry.type, quota, headlineId]
  );
  const plan = resolvePlanLabel(entry.type, quota, t);

  let body;
  if (status === 'idle') {
    body = (
      <button
        type="button"
        className={styles.loadButton}
        onClick={onRefresh}
        disabled={!canRefresh}
      >
        <IconRefreshCw size={13} aria-hidden="true" />
        {t(`${adapter.i18nPrefix}.idle`)}
      </button>
    );
  } else if (loading) {
    body = (
      <div className={styles.cellsLoading} aria-busy="true">
        <span className={styles.srOnly}>{t(`${adapter.i18nPrefix}.loading`)}</span>
        {[0, 1, 2].map((index) => (
          <span key={index} className={styles.cellSkeleton} aria-hidden="true" />
        ))}
      </div>
    );
  } else if (status === 'error') {
    const message = resolveQuotaErrorMessage(
      t,
      quota?.errorStatus,
      quota?.error || t('common.unknown_error')
    );
    body = (
      <div className={styles.rowError} role="alert">
        {t(`${adapter.i18nPrefix}.load_failed`, { message })}
      </div>
    );
  } else if (windows.length === 0) {
    body = <div className={styles.rowMessage}>{t('quota_management.ledger_no_windows')}</div>;
  } else {
    body = windows.map((window) => (
      <WindowCell key={window.id} window={window} now={now} locale={locale} />
    ));
  }

  return (
    <div className={styles.row} role="listitem">
      <div className={styles.identity}>
        <span className={styles.fileName} title={displayName}>
          {displayName}
        </span>
        {plan && <span className={styles.plan}>{plan}</span>}
      </div>
      <div className={styles.cells}>{body}</div>
      {status !== 'idle' && (
        <button
          type="button"
          className={styles.rowAction}
          onClick={onRefresh}
          disabled={isQuotaRefreshDisabled(canRefresh, loading, false)}
          title={t('auth_files.quota_refresh_hint')}
        >
          <IconRefreshCw size={13} className={loading ? styles.spinning : undefined} />
          {t('auth_files.quota_refresh_single')}
        </button>
      )}
    </div>
  );
}

export function QuotaLedger(props: QuotaLedgerProps) {
  const { entries, rows, quotaFor, displayNameFor, resolvedTheme, canRefresh, onRefresh } = props;
  const { t, i18n } = useTranslation();
  const now = useNow();
  const locale = i18n.resolvedLanguage;

  const summaries = useMemo(
    () =>
      QUOTA_TAB_ORDER.map((type) => {
        const credentials = entries
          .filter((entry) => entry.type === type)
          .map((entry) => ({
            key: getQuotaCacheKey(entry.file),
            windows: buildLedgerWindows(type, quotaFor(entry)),
          }));
        return credentials.length > 0 ? summarizeLedgerProvider(type, credentials, now) : null;
      }).filter((summary): summary is LedgerProviderSummary => summary !== null),
    [entries, quotaFor, now]
  );

  const headlineByType = useMemo(
    () => new Map(summaries.map((summary) => [summary.provider, summary.headline?.id ?? null])),
    [summaries]
  );

  const groups = useMemo(
    () =>
      QUOTA_TAB_ORDER.map((type) => ({
        type,
        rows: rows.filter((entry) => entry.type === type),
      })).filter((group) => group.rows.length > 0),
    [rows]
  );

  return (
    <div className={styles.ledger}>
      {summaries.length > 0 && (
        <section className={styles.summary} aria-label={t('quota_management.ledger_summary')}>
          {summaries.map((summary) => (
            <SummaryCard
              key={summary.provider}
              summary={summary}
              resolvedTheme={resolvedTheme}
              now={now}
              locale={locale}
            />
          ))}
        </section>
      )}

      {groups.map((group) => {
        const typeLabel = getTypeLabel(t, group.type);
        const total = entries.filter((entry) => entry.type === group.type).length;
        return (
          <section key={group.type} className={styles.group} aria-label={typeLabel}>
            <h2 className={styles.groupTitle}>
              {typeLabel}
              <span className={styles.groupCount}>{total}</span>
            </h2>
            <div role="list" className={styles.rows}>
              {group.rows.map((entry) => (
                <LedgerRow
                  key={`${entry.type}:${getQuotaCacheKey(entry.file)}`}
                  entry={entry}
                  quota={quotaFor(entry)}
                  headlineId={headlineByType.get(entry.type) ?? null}
                  displayName={displayNameFor(entry)}
                  canRefresh={canRefresh(entry)}
                  onRefresh={() => onRefresh(entry)}
                  now={now}
                  locale={locale}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
