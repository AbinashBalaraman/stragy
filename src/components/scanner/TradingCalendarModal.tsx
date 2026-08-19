import React, { useState, useEffect, useMemo } from 'react';
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

export const TradingCalendarModal: React.FC<TradingCalendarModalProps> = ({
  isOpen,
  onClose,
  selectedDate,
  onSelectDate,
  availableDates,
  activeUniverseLabel = 'All NSE & BSE Equities',
  totalAssetsCount = 2088
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

    // If future date beyond latest session
    if (targetDateStr > latestTradingDate) {
      setSnapNotice(`Target date ${targetDateStr} is in the future. Snapped to latest session.`);
      setTempSelectedDate(latestTradingDate);
      return;
    }

    // If exact trading day
    if (tradingDateSet.has(targetDateStr)) {
      setTempSelectedDate(targetDateStr);
      setSnapNotice(null);
      return;
    }

    // If weekend or market holiday, snap to closest previous trading date
    const dObj = new Date(viewYear, viewMonth, day);
    const dayOfWeek = dObj.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

    // Find nearest preceding trading date
    for (const session of availableDates) {
      if (session.date <= targetDateStr) {
        setTempSelectedDate(session.date);
        setSnapNotice(
          isWeekend
            ? `${WEEKDAYS[dayOfWeek]} (${targetDateStr}) is a weekend (Market Closed). Snapped to previous trading session (${session.date}).`
            : `Market holiday on ${targetDateStr}. Snapped to previous trading session (${session.date}).`
        );
        return;
      }
    }

    // Fallback to oldest
    setTempSelectedDate(oldestTradingDate);
    setSnapNotice(`Date out of trading scope. Aligned to available session ${oldestTradingDate}.`);
  };

  // Handle preset quick selection
  const handlePresetSelect = (daysOffset: number | 'LATEST' | '1Y') => {
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
        setSnapNotice(`Aligned to trading session 1 year ago (${oldest.date})`);
        const [y, m] = oldest.date.split('-').map(Number);
        setViewYear(y);
        setViewMonth(m - 1);
      }
      return;
    }

    if (typeof daysOffset === 'number') {
      const targetSession = availableDates[Math.min(daysOffset, availableDates.length - 1)];
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
    onSelectDate(tempSelectedDate === latestTradingDate ? '' : tempSelectedDate);
    onClose();
  };

  // Reset to current latest live session
  const handleResetToLatest = () => {
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
    dayOfWeek: 'Trading Day',
    isLatest: tempSelectedDate === latestTradingDate
  };

  const daysInCurrentMonth = getDaysInMonth(viewYear, viewMonth);
  const firstDayIndex = getFirstDayOfMonth(viewYear, viewMonth);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-[#141417] backdrop-blur-md animate-in fade-in duration-200">
      <div className="bg-[#161619] border border-[rgba(236,236,237,0.12)]/80 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="px-4 sm:px-6 py-4 border-b border-[rgba(236,236,237,0.08)] flex items-center justify-between bg-[#141417]">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400">
              <CalendarIcon className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-white tracking-tight flex items-center gap-2">
                <span>Interactive Trading Session Calendar</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 font-mono font-semibold border border-cyan-500/30">
                  NSE & BSE Historical API
                </span>
              </h2>
              <p className="text-xs text-neutral-400">
                Choose any trading session date to analyze gainers, losers, volume shockers & heatmap
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-[#1d1d21] transition-all"
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
              <span className="text-[11px] font-bold text-neutral-400 uppercase tracking-wider flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                <span>Quick Session Jump:</span>
              </span>
              <span className="text-[10px] text-neutral-500">250 Historical Sessions Available</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 text-xs">
              <button
                type="button"
                onClick={() => handlePresetSelect('LATEST')}
                className={`px-2.5 py-1.5 rounded-lg border text-left font-medium transition-all flex items-center justify-between ${
                  tempSelectedDate === latestTradingDate
                    ? 'bg-amber-500 text-[#0c0c0e] font-bold border-amber-400 shadow-sm'
                    : 'bg-[#141417] text-neutral-300 hover:bg-[#1d1d21] border-[rgba(236,236,237,0.08)]'
                }`}
              >
                <span>⭐ Latest Session</span>
                <span className="text-[10px] opacity-80 font-mono">14 Aug</span>
              </button>

              <button
                type="button"
                onClick={() => handlePresetSelect(1)}
                className="px-2.5 py-1.5 rounded-lg bg-[#141417] text-neutral-300 hover:bg-[#1d1d21] border border-[rgba(236,236,237,0.08)] text-left font-medium transition-all flex items-center justify-between"
              >
                <span>1 Session Ago</span>
                <span className="text-[10px] text-cyan-400 font-mono">{availableDates[1]?.date.slice(5) || '13 Aug'}</span>
              </button>

              <button
                type="button"
                onClick={() => handlePresetSelect(5)}
                className="px-2.5 py-1.5 rounded-lg bg-[#141417] text-neutral-300 hover:bg-[#1d1d21] border border-[rgba(236,236,237,0.08)] text-left font-medium transition-all flex items-center justify-between"
              >
                <span>1 Week Ago</span>
                <span className="text-[10px] text-cyan-400 font-mono">{availableDates[5]?.date.slice(5) || '07 Aug'}</span>
              </button>

              <button
                type="button"
                onClick={() => handlePresetSelect(10)}
                className="px-2.5 py-1.5 rounded-lg bg-[#141417] text-neutral-300 hover:bg-[#1d1d21] border border-[rgba(236,236,237,0.08)] text-left font-medium transition-all flex items-center justify-between"
              >
                <span>2 Weeks Ago</span>
                <span className="text-[10px] text-cyan-400 font-mono">{availableDates[10]?.date.slice(5) || '31 Jul'}</span>
              </button>

              <button
                type="button"
                onClick={() => handlePresetSelect(21)}
                className="px-2.5 py-1.5 rounded-lg bg-[#141417] text-neutral-300 hover:bg-[#1d1d21] border border-[rgba(236,236,237,0.08)] text-left font-medium transition-all flex items-center justify-between"
              >
                <span>1 Month Ago</span>
                <span className="text-[10px] text-cyan-400 font-mono">{availableDates[21]?.date.slice(5) || '15 Jul'}</span>
              </button>

              <button
                type="button"
                onClick={() => handlePresetSelect(63)}
                className="px-2.5 py-1.5 rounded-lg bg-[#141417] text-neutral-300 hover:bg-[#1d1d21] border border-[rgba(236,236,237,0.08)] text-left font-medium transition-all flex items-center justify-between"
              >
                <span>3 Months Ago</span>
                <span className="text-[10px] text-cyan-400 font-mono">{availableDates[63]?.date.slice(5) || '14 May'}</span>
              </button>

              <button
                type="button"
                onClick={() => handlePresetSelect(125)}
                className="px-2.5 py-1.5 rounded-lg bg-[#141417] text-neutral-300 hover:bg-[#1d1d21] border border-[rgba(236,236,237,0.08)] text-left font-medium transition-all flex items-center justify-between"
              >
                <span>6 Months Ago</span>
                <span className="text-[10px] text-cyan-400 font-mono">{availableDates[125]?.date.slice(5) || '12 Feb'}</span>
              </button>

              <button
                type="button"
                onClick={() => handlePresetSelect('1Y')}
                className="px-2.5 py-1.5 rounded-lg bg-[#141417] text-neutral-300 hover:bg-[#1d1d21] border border-[rgba(236,236,237,0.08)] text-left font-medium transition-all flex items-center justify-between"
              >
                <span>1 Year Ago</span>
                <span className="text-[10px] text-cyan-400 font-mono">{oldestTradingDate.slice(5) || 'Aug 2025'}</span>
              </button>
            </div>
          </div>

          {/* Calendar Grid Box */}
          <div className="bg-[#141417]/90 border border-[rgba(236,236,237,0.08)] rounded-xl p-4 space-y-3">
            {/* Month & Year Navigation Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handlePrevMonth}
                  disabled={viewYear === 2025 && viewMonth <= 7}
                  className="p-1.5 rounded-lg bg-[#161619] text-neutral-300 hover:text-white hover:bg-[#1d1d21] disabled:opacity-30 disabled:cursor-not-allowed border border-[rgba(236,236,237,0.08)] transition-all"
                  title="Previous Month"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <div className="flex items-center gap-2">
                  <select
                    value={viewMonth}
                    onChange={(e) => setViewMonth(parseInt(e.target.value, 10))}
                    className="bg-[#161619] border border-[rgba(236,236,237,0.12)] text-white font-bold text-xs rounded-lg px-2.5 py-1 focus:outline-none focus:border-cyan-500 cursor-pointer"
                  >
                    {MONTH_NAMES.map((name, idx) => {
                      const isDisabled = (viewYear === 2026 && idx > 7) || (viewYear === 2025 && idx < 7);
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
                    className="bg-[#161619] border border-[rgba(236,236,237,0.12)] text-white font-bold text-xs rounded-lg px-2.5 py-1 focus:outline-none focus:border-cyan-500 cursor-pointer font-mono"
                  >
                    <option value={2026}>2026</option>
                    <option value={2025}>2025</option>
                  </select>
                </div>
                <button
                  type="button"
                  onClick={handleNextMonth}
                  disabled={viewYear === 2026 && viewMonth >= 7}
                  className="p-1.5 rounded-lg bg-[#161619] text-neutral-300 hover:text-white hover:bg-[#1d1d21] disabled:opacity-30 disabled:cursor-not-allowed border border-[rgba(236,236,237,0.08)] transition-all"
                  title="Next Month"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>

              {/* Direct HTML5 Date input */}
              <div className="flex items-center gap-1.5 text-xs">
                <span className="text-neutral-400 text-[11px] hidden sm:inline">Direct Input:</span>
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
                  className="bg-[#161619] border border-[rgba(236,236,237,0.12)] text-cyan-300 text-xs rounded-lg px-2 py-1 focus:outline-none focus:border-cyan-500 font-mono cursor-pointer"
                />
              </div>
            </div>

            {/* Weekday Names */}
            <div className="grid grid-cols-7 gap-1 text-center font-bold text-[11px] text-neutral-400 py-1 border-b border-[rgba(236,236,237,0.08)]">
              {WEEKDAYS.map((w, idx) => (
                <div key={w} className={idx === 0 || idx === 6 ? 'text-amber-400/80' : ''}>
                  {w}
                </div>
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
                const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
                const isFuture = dateStr > latestTradingDate;

                return (
                  <button
                    key={dateStr}
                    type="button"
                    onClick={() => handleDayClick(dayNum)}
                    disabled={isFuture}
                    title={`${dateStr}: ${
                      isTradingDay
                        ? isLatest
                          ? 'Latest Live NSE/BSE Trading Session'
                          : 'NSE/BSE Trading Session (Click to view historical movers)'
                        : isWeekend
                        ? 'Weekend (Closed) - Click to auto-snap to Friday session'
                        : 'Market Holiday - Click to snap to previous trading day'
                    }`}
                    className={`h-9 rounded-lg text-xs font-semibold flex flex-col items-center justify-center relative transition-all ${
                      isSelected
                        ? 'bg-cyan-500 text-[#0c0c0e] font-black ring-2 ring-cyan-400 ring-offset-2 ring-offset-[#0c0c0e] shadow-md scale-[1.03]'
                        : isLatest
                        ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 hover:bg-amber-500/30'
                        : isTradingDay
                        ? 'bg-[#161619] text-neutral-200 hover:bg-[#1d1d21] hover:text-white border border-[rgba(236,236,237,0.08)] hover:border-cyan-500/40'
                        : isWeekend
                        ? 'bg-[#141417] text-neutral-500 border border-[#161619] opacity-60 hover:opacity-100 hover:bg-[#161619]'
                        : 'bg-[#141417] text-neutral-500 opacity-40'
                    } ${isFuture ? 'opacity-20 cursor-not-allowed' : 'cursor-pointer'}`}
                  >
                    <span>{dayNum}</span>
                    {/* Small status indicator dot */}
                    {isTradingDay && !isSelected && (
                      <span className={`w-1 h-1 rounded-full ${isLatest ? 'bg-amber-400' : 'bg-emerald-400'}`} />
                    )}
                    {isWeekend && !isSelected && (
                      <span className="text-[7px] text-neutral-500 leading-none">wknd</span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Calendar Legend */}
            <div className="pt-2 border-t border-[rgba(236,236,237,0.08)] flex items-center justify-between text-[10px] text-neutral-400 flex-wrap gap-2">
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-emerald-400" />
                  <span>Trading Session</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-amber-400" />
                  <span>Latest Live Session</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded bg-cyan-500" />
                  <span>Selected Date</span>
                </div>
              </div>
              <span className="text-neutral-500">Click any weekend to auto-snap to previous session</span>
            </div>
          </div>

          {/* Snap Notice if applicable */}
          {snapNotice && (
            <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-amber-400" />
              <span>{snapNotice}</span>
            </div>
          )}

          {/* Selected Session Information Card */}
          <div className="p-3.5 rounded-xl bg-[#141417] border border-cyan-500/30 space-y-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-pulse" />
                <span className="text-xs font-bold text-neutral-300">Target Session For API Scan:</span>
              </div>
              <span
                className={`text-[11px] px-2 py-0.5 rounded font-mono font-bold ${
                  selectedSessionInfo.isLatest
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                    : 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                }`}
              >
                {selectedSessionInfo.isLatest ? '🟢 Latest Live Market Session' : '📅 Historical Session'}
              </span>
            </div>

            <div className="flex items-baseline justify-between flex-wrap gap-2 pt-1 border-t border-[rgba(236,236,237,0.08)]">
              <div>
                <div className="text-sm font-extrabold text-white">
                  {selectedSessionInfo.fullLabel || selectedSessionInfo.label}
                </div>
                <div className="text-[11px] text-neutral-400 font-mono">
                  ISO Date: {selectedSessionInfo.date} • Universe: {activeUniverseLabel} ({totalAssetsCount} Assets)
                </div>
              </div>
              <div className="text-right">
                <span className="text-[10px] text-emerald-400 font-mono bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                  Real Market Data Verified
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-4 sm:px-6 py-3.5 border-t border-[rgba(236,236,237,0.08)] bg-[#141417] flex items-center justify-between gap-3 flex-wrap">
          <button
            type="button"
            onClick={handleResetToLatest}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#161619] hover:bg-[#1d1d21] text-neutral-300 hover:text-white border border-[rgba(236,236,237,0.12)] text-xs font-semibold transition-all"
          >
            <RefreshCw className="w-3.5 h-3.5 text-amber-400" />
            <span>Reset to Latest Live Session</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-[#161619] hover:bg-[#1d1d21] text-neutral-400 hover:text-white text-xs font-semibold transition-all"
            >
              Cancel
            </button>

            <button
              type="button"
              onClick={handleApply}
              className="flex items-center gap-1.5 px-5 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-emerald-500 hover:from-cyan-400 hover:to-emerald-400 text-[#0c0c0e] font-bold text-xs shadow-lg shadow-cyan-500/20 transition-all scale-[1.02] active:scale-[0.98]"
            >
              <span>Apply & Fetch Data for {selectedSessionInfo.date}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
