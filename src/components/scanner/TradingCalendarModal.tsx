import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Clock,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  RefreshCw,
  X,
  ArrowRight,
  TrendingUp,
  SlidersHorizontal,
  CalendarDays
} from 'lucide-react';

export interface TradingSessionDate {
  date: string;
  label: string;
  fullLabel?: string;
  dayOfWeek?: string;
  isLatest: boolean;
}

interface TradingCalendarModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedDate: string;
  onSelectDate: (date: string) => void;
  availableDates: TradingSessionDate[];
  activeUniverseLabel?: string;
  totalAssetsCount?: number;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "2026-11-16" -> "16 Nov 2026". */
function longSessionDate(iso: string | undefined): string {
  if (!iso) return 'No date';
  const date = new Date(iso + 'T00:00:00Z');
  return Number.isFinite(date.getTime())
    ? date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })
    : iso;
}

/** "2026-11-14" -> "14 Nov"; never the ambiguous MM-DD slice. */
function shortSessionDate(iso: string | undefined): string {
  if (!iso) return 'Unavailable';
  const date = new Date(iso + 'T00:00:00Z');
  return Number.isFinite(date.getTime())
    ? date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' })
    : iso;
}

export const TradingCalendarModal: React.FC<TradingCalendarModalProps> = ({
  isOpen,
  onClose,
  selectedDate,
  onSelectDate,
  availableDates,
  activeUniverseLabel = 'Selected universe',
  totalAssetsCount
}) => {
  // Earliest and latest dates available
  const oldestTradingDate = useMemo(() => {
    return availableDates[availableDates.length - 1]?.date || '';
  }, [availableDates]);

  const latestTradingDate = useMemo(() => {
    return availableDates[0]?.date || '';
  }, [availableDates]);

  const minBounds = useMemo(() => {
    if (oldestTradingDate) {
      const [y, m] = oldestTradingDate.split('-').map(Number);
      return { year: y, month: m - 1 };
    }
    const d = new Date();
    return { year: d.getFullYear() - 1, month: d.getMonth() };
  }, [oldestTradingDate]);

  const maxBounds = useMemo(() => {
    if (latestTradingDate) {
      const [y, m] = latestTradingDate.split('-').map(Number);
      return { year: y, month: m - 1 };
    }
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
  }, [latestTradingDate]);

  // Current latest trading date reference
  const latestDateObj = useMemo(() => {
    const latestStr = latestTradingDate || '';
    if (latestStr) {
      const [y, m, d] = latestStr.split('-').map(Number);
      return new Date(y, m - 1, d);
    }
    return new Date();
  }, [latestTradingDate]);

  // Active view year and month in calendar grid
  const [viewYear, setViewYear] = useState<number>(() => {
    if (selectedDate) {
      return parseInt(selectedDate.split('-')[0], 10) || new Date().getFullYear();
    }
    if (availableDates[0]?.date) {
      return parseInt(availableDates[0].date.split('-')[0], 10);
    }
    return new Date().getFullYear();
  });

  const [viewMonth, setViewMonth] = useState<number>(() => {
    if (selectedDate) {
      return (parseInt(selectedDate.split('-')[1], 10) - 1) || new Date().getMonth();
    }
    if (availableDates[0]?.date) {
      return (parseInt(availableDates[0].date.split('-')[1], 10) - 1);
    }
    return new Date().getMonth();
  });

  const [tempSelectedDate, setTempSelectedDate] = useState<string>(selectedDate);
  const [snapNotice, setSnapNotice] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef(onClose);

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const restoreTo = previous && previous !== document.body && document.contains(previous) ? previous : null;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const panel = panelRef.current;
    const focusable = () => panel
      ? Array.from(panel.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'))
      : [];
    focusable()[0]?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = originalOverflow;
      restoreTo?.focus();
    };
  }, [isOpen]);

  // Sync state when opened
  useEffect(() => {
    if (isOpen) {
      const active = selectedDate || availableDates[0]?.date || '';
      setTempSelectedDate(active);
      if (active) {
        const [y, m] = active.split('-').map(Number);
        if (y && m) {
          setViewYear(y);
          setViewMonth(m - 1);
        }
      } else if (latestTradingDate) {
        const [y, m] = latestTradingDate.split('-').map(Number);
        if (y && m) {
          setViewYear(y);
          setViewMonth(m - 1);
        }
      }
      setSnapNotice(null);
    }
  }, [isOpen, selectedDate, availableDates, latestTradingDate]);

  // Set of valid trading dates strings for quick lookup
  const tradingDateSet = useMemo(() => {
    return new Set(availableDates.map(d => d.date));
  }, [availableDates]);

  // Helper: Get days in month
  const getDaysInMonth = (year: number, month: number) => {
    return new Date(year, month + 1, 0).getDate();
  };

  // Helper: Get first day index of month (0 = Sunday, 1 = Monday, ...)
  const getFirstDayOfMonth = (year: number, month: number) => {
    return new Date(year, month, 1).getDay();
  };

  const canGoPrev = viewYear > minBounds.year || (viewYear === minBounds.year && viewMonth > minBounds.month);
  const canGoNext = viewYear < maxBounds.year || (viewYear === maxBounds.year && viewMonth < maxBounds.month);

  // Handle month navigation
  const handlePrevMonth = () => {
    if (!canGoPrev) return;
    if (viewMonth === 0) {
      setViewYear(viewYear - 1);
      setViewMonth(11);
    } else {
      setViewMonth(viewMonth - 1);
    }
  };

  const handleNextMonth = () => {
    if (!canGoNext) return;
    if (viewMonth === 11) {
      setViewYear(viewYear + 1);
      setViewMonth(0);
    } else {
      setViewMonth(viewMonth + 1);
    }
  };

  // Handle day click
  const handleDayClick = (day: number) => {
    const mm = String(viewMonth + 1).padStart(2, '0');
    const dd = String(day).padStart(2, '0');
    const targetDateStr = `${viewYear}-${mm}-${dd}`;

    if (!latestTradingDate) return;
    // A date after the cutoff has no available observation.
    if (targetDateStr > latestTradingDate) {
      setSnapNotice(`No observation for ${targetDateStr}; selected latest available session (${latestTradingDate}).`);
      setTempSelectedDate(latestTradingDate);
      return;
    }

    // If exact trading day
    if (tradingDateSet.has(targetDateStr)) {
      setTempSelectedDate(targetDateStr);
      setSnapNotice(null);
      return;
    }

    // Missing data does not establish an exchange holiday.

    // Find nearest preceding trading date
    for (const session of availableDates) {
      if (session.date <= targetDateStr) {
        setTempSelectedDate(session.date);
        setSnapNotice(`No observation for ${targetDateStr}; selected previous available session (${session.date}).`);
        return;
      }
    }

    // Fallback to oldest
    setTempSelectedDate(oldestTradingDate);
    setSnapNotice(`Date out of trading scope. Aligned to available session ${oldestTradingDate}.`);
  };

  // Handle preset quick selection
  const handlePresetSelect = (daysOffset: number | 'LATEST' | '1Y') => {
    if (!latestTradingDate) return;
    if (daysOffset === 'LATEST') {
      setTempSelectedDate(latestTradingDate);
      setSnapNotice(null);
      const [y, m] = latestTradingDate.split('-').map(Number);
      setViewYear(y);
      setViewMonth(m - 1);
      return;
    }

    if (daysOffset === '1Y') {
      const oldest = availableDates[availableDates.length - 1];
      if (oldest) {
        setTempSelectedDate(oldest.date);
        setSnapNotice(`Selected oldest available session (${oldest.date})`);
        const [y, m] = oldest.date.split('-').map(Number);
        setViewYear(y);
        setViewMonth(m - 1);
      }
      return;
    }

    if (typeof daysOffset === 'number') {
      const targetSession = availableDates[daysOffset];
      if (targetSession) {
        setTempSelectedDate(targetSession.date);
        setSnapNotice(`Jumped ${daysOffset} trading sessions back to ${targetSession.date}`);
        const [y, m] = targetSession.date.split('-').map(Number);
        setViewYear(y);
        setViewMonth(m - 1);
      }
    }
  };

  // Confirm selection and apply to API
  const handleApply = () => {
    if (!tradingDateSet.has(tempSelectedDate || latestTradingDate)) return;
    onSelectDate(tempSelectedDate === latestTradingDate ? '' : tempSelectedDate);
    onClose();
  };

  // Reset to current latest live session
  const handleResetToLatest = () => {
    if (!latestTradingDate) return;
    setTempSelectedDate(latestTradingDate);
    onSelectDate('');
    onClose();
  };

  if (!isOpen) return null;

  // Selected date info
  const selectedSessionInfo = availableDates.find(d => d.date === tempSelectedDate) || {
    date: tempSelectedDate || latestTradingDate,
    label: tempSelectedDate || latestTradingDate,
    fullLabel: tempSelectedDate || latestTradingDate,
    dayOfWeek: 'Session unavailable',
    isLatest: Boolean(latestTradingDate) && tempSelectedDate === latestTradingDate
  };

  const daysInCurrentMonth = getDaysInMonth(viewYear, viewMonth);
  const firstDayIndex = getFirstDayOfMonth(viewYear, viewMonth);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 backdrop-blur-sm sm:p-4">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="trading-calendar-title"
        aria-describedby="trading-calendar-description"
        className="bg-[#171719] border border-[rgba(236,236,237,0.12)]/80 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]"
      >
        {/* Header */}
        <div className="px-4 sm:px-6 py-4 border-b border-[rgba(236,236,237,0.08)] flex items-center justify-between bg-[#151517]">
          <div className="min-w-0">
            <h2 id="trading-calendar-title" className="text-base font-semibold tracking-tight text-[var(--text-1)] sm:text-lg">
              Pick a date
            </h2>
            <p id="trading-calendar-description" className="mt-0.5 text-xs text-neutral-400">
              Dates reflect available data, not a verified exchange holiday calendar.
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close calendar"
            className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-[#1e1e21] transition-all"
            title="Close calendar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-5 flex-1">
          {/* Quick-Jump Presets */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] text-[var(--text-3)]">Jump to</span>
              <span className="text-[10px] text-neutral-500">{availableDates.length} days with data</span>
            </div>
            <div className="flex flex-wrap gap-1.5 text-xs">
              {([
                { key: 'latest', label: `Latest (${shortSessionDate(latestTradingDate)})`, offset: 'LATEST' as const, disabled: !latestTradingDate },
                { key: '1w', label: '1 week ago', offset: 5, disabled: !availableDates[5] },
                { key: '1m', label: '1 month ago', offset: 21, disabled: !availableDates[21] },
                { key: '3m', label: '3 months ago', offset: 63, disabled: !availableDates[63] },
                { key: '6m', label: '6 months ago', offset: 125, disabled: !availableDates[125] },
              ]).map(chip => (
                <button
                  key={chip.key}
                  type="button"
                  onClick={() => handlePresetSelect(chip.offset)}
                  disabled={chip.disabled}
                  className={'rounded-[var(--r-btn)] border border-[var(--line)] px-2.5 py-1 text-xs transition-colors hover:bg-white/[0.04] disabled:cursor-not-allowed disabled:text-[var(--text-disabled)] ' + (chip.key === 'latest' && tempSelectedDate === latestTradingDate ? 'bg-white/[0.06] text-[var(--text-1)]' : 'text-[var(--text-2)]')}
                >
                  {chip.label}
                </button>
              ))}
            </div>
          </div>

          {/* Calendar Grid Box */}
          <div className="bg-[#151517]/90 border border-[rgba(236,236,237,0.08)] rounded-xl p-4 space-y-3">
            {/* Month & Year Navigation Header */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handlePrevMonth}
                  disabled={!latestTradingDate || !canGoPrev}
                  className="rounded-lg border border-white/10 bg-[#171719] p-1.5 text-neutral-300 transition-colors hover:bg-white/[0.05] disabled:cursor-not-allowed disabled:opacity-30"
                  title="Previous Month"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <div className="flex items-center gap-2">
                  <select
                    value={viewMonth}
                    onChange={(e) => setViewMonth(parseInt(e.target.value, 10))}
                    className="cursor-pointer rounded-lg border border-white/12 bg-[#171719] px-2.5 py-1 text-xs font-medium text-neutral-100 focus:border-[#a8c7fa]/60 focus:outline-none"
                  >
                    {MONTH_NAMES.map((name, idx) => {
                      const isDisabled = !latestTradingDate || (viewYear === maxBounds.year && idx > maxBounds.month) || (viewYear === minBounds.year && idx < minBounds.month);
                      return (
                        <option key={name} value={idx} disabled={isDisabled}>
                          {name}
                        </option>
                      );
                    })}
                  </select>

                  <select
                    value={viewYear}
                    onChange={(e) => setViewYear(parseInt(e.target.value, 10))}
                    className="cursor-pointer rounded-lg border border-white/12 bg-[#171719] px-2.5 py-1 font-mono text-xs font-medium text-neutral-100 focus:border-[#a8c7fa]/60 focus:outline-none"
                  >
                    {Array.from({length:maxBounds.year-minBounds.year+1},(_,i)=>maxBounds.year-i).map(year=><option key={year} value={year}>{year}</option>)}
                  </select>
                </div>
                <button
                  type="button"
                  onClick={handleNextMonth}
                  disabled={!latestTradingDate || !canGoNext}
                  className="rounded-lg border border-white/10 bg-[#171719] p-1.5 text-neutral-300 transition-colors hover:bg-white/[0.05] disabled:cursor-not-allowed disabled:opacity-30"
                  title="Next Month"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>

              {/* Direct HTML5 Date input */}
              <div className="flex w-full items-center justify-end gap-1.5 text-xs sm:w-auto">
                <span className="hidden text-[11px] text-neutral-400 sm:inline">Date</span>
                <input
                  type="date"
                  value={tempSelectedDate || latestTradingDate}
                  min={oldestTradingDate}
                  max={latestTradingDate}
                  onChange={(e) => {
                    if (e.target.value) {
                      setTempSelectedDate(e.target.value);
                      const [y, m] = e.target.value.split('-').map(Number);
                      if (y && m) {
                        setViewYear(y);
                        setViewMonth(m - 1);
                      }
                    }
                  }}
                  className="w-full cursor-pointer rounded-lg border border-white/12 bg-[#171719] px-2 py-1 font-mono text-xs text-neutral-100 focus:border-[#a8c7fa]/60 focus:outline-none sm:w-auto"
                />
              </div>
            </div>

            {/* Weekday Names */}
            <div className="grid grid-cols-7 gap-1 text-center font-bold text-[11px] text-neutral-400 py-1 border-b border-[rgba(236,236,237,0.08)]">
              {WEEKDAYS.map((w, idx) => (
                <div key={w}>{w}</div>
              ))}
            </div>

            {/* Days Grid */}
            <div className="grid grid-cols-7 gap-1">
              {/* Empty leading padding slots */}
              {Array.from({ length: firstDayIndex }).map((_, idx) => (
                <div key={`empty_${idx}`} className="h-9 rounded-lg opacity-10 pointer-events-none" />
              ))}

              {/* Month Days */}
              {Array.from({ length: daysInCurrentMonth }).map((_, idx) => {
                const dayNum = idx + 1;
                const mm = String(viewMonth + 1).padStart(2, '0');
                const dd = String(dayNum).padStart(2, '0');
                const dateStr = `${viewYear}-${mm}-${dd}`;
                const isSelected = tempSelectedDate === dateStr;
                const isLatest = dateStr === latestTradingDate;
                const isTradingDay = tradingDateSet.has(dateStr);
                const dayOfWeek = new Date(viewYear, viewMonth, dayNum).getDay();
                const isFuture = dateStr > latestTradingDate;

                return (
                  <button
                    key={dateStr}
                    type="button"
                    onClick={() => handleDayClick(dayNum)}
                    disabled={!latestTradingDate || isFuture || dateStr < oldestTradingDate}
                    title={`${dateStr}: ${
                      isTradingDay
                        ? isLatest
                          ? 'Latest available data session'
                          : 'Available data session (click to select)'
                        : isFuture || !latestTradingDate
                        ? 'After latest available session; no observation available'
                        : 'No observation for this date; select previous available session'
                    }`}
                    className={`flex h-9 items-center justify-center rounded-[var(--r-btn)] text-xs transition-colors ${
                      isSelected
                        ? 'bg-[#a8c7fa] font-medium text-[#101012]'
                        : isTradingDay
                        ? 'text-[var(--text-1)] hover:bg-[var(--surface-2)]'
                        : 'text-[var(--text-disabled)] hover:bg-white/[0.02]'
                    } ${isFuture || dateStr < oldestTradingDate ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                  >
                    {dayNum}
                  </button>
                );
              })}
            </div>

            <p className="border-t border-[var(--line)] pt-2 text-[11px] text-[var(--text-3)]">Dimmed days have no data.</p>
          </div>

          {/* Snap Notice if applicable */}
          {snapNotice && (
            <div className="flex items-center gap-2 rounded-lg border border-amber-400/25 bg-amber-400/[0.05] px-3 py-2 text-xs text-amber-100/90">
              <AlertCircle className="h-3.5 w-3.5 shrink-0 text-amber-300" />
              <span>{snapNotice}</span>
            </div>
          )}

          <p className="st-meta text-[var(--text-2)]">
            {longSessionDate(selectedSessionInfo.date)} · {activeUniverseLabel.replace(/\s*\([^)]*\)/g, '')}
          </p>
        </div>

        {/* Footer Actions */}
        <div className="px-4 sm:px-6 py-3.5 border-t border-[rgba(236,236,237,0.08)] bg-[#151517] flex items-center justify-between gap-3 flex-wrap">
          <button
            type="button"
            onClick={handleResetToLatest}
            disabled={!latestTradingDate}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/12 px-3 py-2 text-xs text-neutral-300 transition-colors hover:bg-white/[0.04]"
          >
            <span>Latest</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-xs font-medium text-neutral-400 transition-colors hover:text-neutral-100"
            >
              Cancel
            </button>

            <button
              type="button"
              onClick={handleApply}
              disabled={!tradingDateSet.has(tempSelectedDate || latestTradingDate)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#a8c7fa] px-4 py-2 text-xs font-semibold text-[#101012] transition-colors hover:bg-[#c7dbff] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <span>Use {shortSessionDate(selectedSessionInfo.date)}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
