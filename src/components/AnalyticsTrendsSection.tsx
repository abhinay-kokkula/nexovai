import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import type { Appointment, CallLog, Doctor, Slot } from '../types/clinic';

interface AnalyticsTrendsSectionProps {
  appointments: Appointment[];
  callLogs: CallLog[];
  doctors: Doctor[];
  slots: Slot[];
}

interface TooltipState {
  visible: boolean;
  x: number;
  y: number;
  title: string;
  lines: string[];
}

function formatDateShort(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((dt.getTime() - today.getTime()) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function classifyOutcome(outcome: string): 'Booked' | 'Cancelled' | 'Inquiry' {
  const lower = outcome.toLowerCase();
  if (lower.includes('booked')) return 'Booked';
  if (lower.includes('cancelled') || lower.includes('canceled')) return 'Cancelled';
  return 'Inquiry';
}

export const AnalyticsTrendsSection: React.FC<AnalyticsTrendsSectionProps> = ({
  appointments,
  callLogs,
  doctors,
  slots,
}) => {
  const [bookingView, setBookingView] = useState<'date' | 'specialty'>('date');
  const callChartContainerRef = useRef<HTMLDivElement | null>(null);
  const bookingChartContainerRef = useRef<HTMLDivElement | null>(null);
  const [callWidth, setCallWidth] = useState(460);
  const [bookingWidth, setBookingWidth] = useState(460);

  const [callTooltip, setCallTooltip] = useState<TooltipState>({
    visible: false,
    x: 0,
    y: 0,
    title: '',
    lines: [],
  });
  const [bookingTooltip, setBookingTooltip] = useState<TooltipState>({
    visible: false,
    x: 0,
    y: 0,
    title: '',
    lines: [],
  });

  // Track container widths responsively
  useEffect(() => {
    const observers: ResizeObserver[] = [];
    if (callChartContainerRef.current) {
      const ro = new ResizeObserver((entries) => {
        for (const entry of entries) {
          if (entry.contentRect.width > 120) {
            setCallWidth(Math.floor(entry.contentRect.width));
          }
        }
      });
      ro.observe(callChartContainerRef.current);
      observers.push(ro);
    }
    if (bookingChartContainerRef.current) {
      const ro = new ResizeObserver((entries) => {
        for (const entry of entries) {
          if (entry.contentRect.width > 120) {
            setBookingWidth(Math.floor(entry.contentRect.width));
          }
        }
      });
      ro.observe(bookingChartContainerRef.current);
      observers.push(ro);
    }
    return () => observers.forEach((o) => o.disconnect());
  }, []);

  const callData = useMemo(() => {
    return [...callLogs]
      .slice(0, 10)
      .reverse()
      .map((log, idx) => ({
        id: log.id,
        label: log.id.replace('CALL-', '#'),
        index: idx + 1,
        durationSeconds: Math.max(1, log.durationSeconds),
        turns: log.transcript.filter((t) => t.speaker !== 'tool').length,
        category: classifyOutcome(log.outcome),
        outcome: log.outcome,
        callerPhone: log.callerPhone || 'No phone',
      }));
  }, [callLogs]);

  const callSummary = useMemo(() => {
    const counts = { Booked: 0, Cancelled: 0, Inquiry: 0 };
    let totalSec = 0;
    for (const c of callLogs) {
      counts[classifyOutcome(c.outcome)] += 1;
      totalSec += c.durationSeconds;
    }
    const avgSec = callLogs.length > 0 ? Math.round(totalSec / callLogs.length) : 0;
    return { ...counts, avgSec, total: callLogs.length };
  }, [callLogs]);

  const bookingSeries = useMemo(() => {
    if (bookingView === 'date') {
      const uniqueDates = Array.from(new Set(slots.map((s) => s.date))).sort();
      return uniqueDates.map((date) => {
        const daySlots = slots.filter((s) => s.date === date);
        const confirmed = appointments.filter(
          (a) => a.date === date && a.status === 'Confirmed'
        ).length;
        const cancelled = appointments.filter(
          (a) => a.date === date && a.status === 'Cancelled'
        ).length;
        const open = daySlots.filter((s) => !s.isBooked).length;
        return {
          key: date,
          label: formatDateShort(date),
          confirmed,
          cancelled,
          open,
        };
      });
    }

    const docSpecialtyMap = new Map<string, string>();
    for (const d of doctors) docSpecialtyMap.set(d.id, d.specialty);
    const specialties = Array.from(new Set(doctors.map((d) => d.specialty)));

    return specialties.map((spec) => {
      const specSlots = slots.filter((s) => docSpecialtyMap.get(s.doctorId) === spec);
      const confirmed = appointments.filter(
        (a) => a.specialty === spec && a.status === 'Confirmed'
      ).length;
      const cancelled = appointments.filter(
        (a) => a.specialty === spec && a.status === 'Cancelled'
      ).length;
      const open = specSlots.filter((s) => !s.isBooked).length;
      return {
        key: spec,
        label: spec.replace('General ', 'Gen. '),
        confirmed,
        cancelled,
        open,
      };
    });
  }, [appointments, bookingView, doctors, slots]);

  // Render D3 Call Patterns Chart (bars for duration + smooth trend line)
  useEffect(() => {
    const container = callChartContainerRef.current;
    if (!container) return;

    const svgEl = container.querySelector('svg');
    if (!svgEl) return;

    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();

    const height = 220;
    const margin = { top: 18, right: 16, bottom: 32, left: 42 };
    const innerWidth = Math.max(120, callWidth - margin.left - margin.right);
    const innerHeight = height - margin.top - margin.bottom;

    svg.attr('viewBox', `0 0 ${callWidth} ${height}`);

    const g = svg
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const maxDuration = Math.max(60, d3.max(callData, (d) => d.durationSeconds) || 60);

    const x = d3
      .scaleBand<string>()
      .domain(callData.length > 0 ? callData.map((d) => d.label) : ['#1', '#2', '#3'])
      .range([0, innerWidth])
      .padding(0.36);

    const y = d3.scaleLinear().domain([0, maxDuration]).nice().range([innerHeight, 0]);

    // Subtle horizontal grid lines
    g.append('g')
      .attr('class', 'grid')
      .call(
        d3
          .axisLeft(y)
          .ticks(4)
          .tickSize(-innerWidth)
          .tickFormat(() => '')
      )
      .call((sel) => sel.select('.domain').remove())
      .selectAll('line')
      .attr('stroke', '#E2E8F0')
      .attr('stroke-dasharray', '3,3');

    // Y Axis (seconds)
    g.append('g')
      .call(
        d3
          .axisLeft(y)
          .ticks(4)
          .tickFormat((val) => `${val}s`)
      )
      .call((sel) => sel.select('.domain').attr('stroke', '#CBD5E1'))
      .selectAll('text')
      .attr('fill', '#64748B')
      .style('font-size', '11px')
      .style('font-family', 'JetBrains Mono, monospace');

    // X Axis
    g.append('g')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(d3.axisBottom(x).tickSizeOuter(0))
      .call((sel) => sel.select('.domain').attr('stroke', '#CBD5E1'))
      .selectAll('text')
      .attr('fill', '#64748B')
      .style('font-size', '11px')
      .style('font-family', 'JetBrains Mono, monospace');

    if (callData.length === 0) {
      g.append('text')
        .attr('x', innerWidth / 2)
        .attr('y', innerHeight / 2)
        .attr('text-anchor', 'middle')
        .attr('fill', '#94A3B8')
        .style('font-size', '12px')
        .text('Start a call to plot live call patterns & duration');
      return;
    }

    const colorByCategory: Record<'Booked' | 'Cancelled' | 'Inquiry', string> = {
      Booked: '#0F766E',
      Cancelled: '#DC2626',
      Inquiry: '#0284C7',
    };

    g.selectAll('.call-bar')
      .data(callData)
      .join('rect')
      .attr('class', 'call-bar')
      .attr('x', (d) => x(d.label) || 0)
      .attr('width', x.bandwidth())
      .attr('y', (d) => y(d.durationSeconds))
      .attr('height', (d) => Math.max(3, innerHeight - y(d.durationSeconds)))
      .attr('rx', 5)
      .attr('fill', (d) => colorByCategory[d.category])
      .attr('opacity', 0.9)
      .style('cursor', 'pointer')
      .on('mouseenter', function (_event, d) {
        d3.select(this).attr('opacity', 1);
        const barX = (x(d.label) || 0) + margin.left + x.bandwidth() / 2;
        const barY = y(d.durationSeconds) + margin.top;
        setCallTooltip({
          visible: true,
          x: barX,
          y: Math.max(18, barY - 10),
          title: `${d.id} · ${d.category}`,
          lines: [
            `Duration: ${d.durationSeconds}s (${d.turns} turns)`,
            `Phone: ${d.callerPhone}`,
            d.outcome,
          ],
        });
      })
      .on('mouseleave', function () {
        d3.select(this).attr('opacity', 0.9);
        setCallTooltip((prev) => ({ ...prev, visible: false }));
      });

    // Trend curve overlay when >= 2 calls
    if (callData.length >= 2) {
      const lineGen = d3
        .line<(typeof callData)[number]>()
        .x((d) => (x(d.label) || 0) + x.bandwidth() / 2)
        .y((d) => y(d.durationSeconds))
        .curve(d3.curveMonotoneX);

      g.append('path')
        .datum(callData)
        .attr('fill', 'none')
        .attr('stroke', '#0F172A')
        .attr('stroke-width', 1.5)
        .attr('stroke-dasharray', '4,3')
        .attr('opacity', 0.45)
        .attr('d', lineGen);

      g.selectAll('.call-dot')
        .data(callData)
        .join('circle')
        .attr('cx', (d) => (x(d.label) || 0) + x.bandwidth() / 2)
        .attr('cy', (d) => y(d.durationSeconds))
        .attr('r', 3.5)
        .attr('fill', '#FFFFFF')
        .attr('stroke', '#0F172A')
        .attr('stroke-width', 1.75)
        .style('pointer-events', 'none');
    }
  }, [callData, callWidth]);

  // Render D3 Booking & Slot Trends Chart (grouped bars: Confirmed, Cancelled, Open)
  useEffect(() => {
    const container = bookingChartContainerRef.current;
    if (!container) return;

    const svgEl = container.querySelector('svg');
    if (!svgEl) return;

    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();

    const height = 220;
    const margin = { top: 18, right: 16, bottom: 32, left: 36 };
    const innerWidth = Math.max(120, bookingWidth - margin.left - margin.right);
    const innerHeight = height - margin.top - margin.bottom;

    svg.attr('viewBox', `0 0 ${bookingWidth} ${height}`);

    const g = svg
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const groups = bookingSeries.map((d) => d.label);
    const subKeys = ['confirmed', 'cancelled', 'open'] as const;
    const keyLabels: Record<(typeof subKeys)[number], string> = {
      confirmed: 'Confirmed',
      cancelled: 'Cancelled',
      open: 'Open Slots',
    };
    const keyColors: Record<(typeof subKeys)[number], string> = {
      confirmed: '#0F766E',
      cancelled: '#DC2626',
      open: '#94A3B8',
    };

    const x0 = d3
      .scaleBand<string>()
      .domain(groups)
      .range([0, innerWidth])
      .paddingInner(0.24);

    const x1 = d3
      .scaleBand<string>()
      .domain([...subKeys])
      .range([0, x0.bandwidth()])
      .padding(0.14);

    const maxVal = Math.max(
      4,
      d3.max(bookingSeries, (d) => Math.max(d.confirmed, d.cancelled, d.open)) || 4
    );
    const y = d3.scaleLinear().domain([0, maxVal]).nice().range([innerHeight, 0]);

    // Gridlines
    g.append('g')
      .call(
        d3
          .axisLeft(y)
          .ticks(4)
          .tickSize(-innerWidth)
          .tickFormat(() => '')
      )
      .call((sel) => sel.select('.domain').remove())
      .selectAll('line')
      .attr('stroke', '#E2E8F0')
      .attr('stroke-dasharray', '3,3');

    // Y Axis
    g.append('g')
      .call(d3.axisLeft(y).ticks(4).tickFormat(d3.format('d')))
      .call((sel) => sel.select('.domain').attr('stroke', '#CBD5E1'))
      .selectAll('text')
      .attr('fill', '#64748B')
      .style('font-size', '11px')
      .style('font-family', 'JetBrains Mono, monospace');

    // X Axis
    g.append('g')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(d3.axisBottom(x0).tickSizeOuter(0))
      .call((sel) => sel.select('.domain').attr('stroke', '#CBD5E1'))
      .selectAll('text')
      .attr('fill', '#475569')
      .style('font-size', '11px');

    const groupG = g
      .selectAll('.booking-group')
      .data(bookingSeries)
      .join('g')
      .attr('class', 'booking-group')
      .attr('transform', (d) => `translate(${x0(d.label) || 0},0)`);

    groupG
      .selectAll('rect')
      .data((d) =>
        subKeys.map((k) => ({
          key: k,
          value: d[k],
          parent: d,
        }))
      )
      .join('rect')
      .attr('x', (d) => x1(d.key) || 0)
      .attr('y', (d) => y(d.value))
      .attr('width', x1.bandwidth())
      .attr('height', (d) => Math.max(2, innerHeight - y(d.value)))
      .attr('rx', 3)
      .attr('fill', (d) => keyColors[d.key])
      .attr('opacity', (d) => (d.value === 0 ? 0.25 : 0.92))
      .style('cursor', 'pointer')
      .on('mouseenter', function (_event, d) {
        d3.select(this).attr('opacity', 1);
        const cx =
          (x0(d.parent.label) || 0) +
          (x1(d.key) || 0) +
          x1.bandwidth() / 2 +
          margin.left;
        const cy = y(d.value) + margin.top;
        setBookingTooltip({
          visible: true,
          x: cx,
          y: Math.max(18, cy - 10),
          title: `${d.parent.label} · ${keyLabels[d.key]}`,
          lines: [
            `Confirmed: ${d.parent.confirmed}`,
            `Cancelled: ${d.parent.cancelled}`,
            `Open Slots: ${d.parent.open}`,
          ],
        });
      })
      .on('mouseleave', function (_event, d) {
        d3.select(this).attr('opacity', d.value === 0 ? 0.25 : 0.92);
        setBookingTooltip((prev) => ({ ...prev, visible: false }));
      });
  }, [bookingSeries, bookingWidth]);

  return (
    <section
      aria-label="Call Patterns and Booking Trends"
      className="grid gap-6 lg:grid-cols-2"
    >
      {/* Left Widget: D3 Call Patterns */}
      <div className="rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="font-display text-base font-semibold text-slate-900">
              Call Patterns
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Session durations &amp; outcomes powered by D3.js
            </p>
          </div>
          <div className="flex items-center gap-3 font-mono text-[11px] text-slate-600 tabular-nums">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-xs bg-teal-700" />
              Booked {callSummary.Booked}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-xs bg-red-600" />
              Cancelled {callSummary.Cancelled}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-xs bg-sky-600" />
              Inquiry {callSummary.Inquiry}
            </span>
          </div>
        </div>

        <div className="relative px-4 pt-3 pb-4" ref={callChartContainerRef}>
          <svg className="h-[220px] w-full overflow-visible" role="img" aria-label="Call patterns bar and trend chart" />
          {callTooltip.visible && (
            <div
              className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-[11px] text-white shadow-lg"
              style={{ left: callTooltip.x, top: callTooltip.y }}
            >
              <p className="font-semibold text-teal-300">{callTooltip.title}</p>
              {callTooltip.lines.map((line, i) => (
                <p key={i} className="font-mono text-slate-200 tabular-nums">
                  {line}
                </p>
              ))}
            </div>
          )}
          <div className="mt-1 flex items-center justify-between border-t border-slate-100 pt-2.5 text-[11px] text-slate-500 font-mono tabular-nums">
            <span>Total recorded: {callSummary.total}</span>
            <span>Avg call length: {callSummary.avgSec}s</span>
          </div>
        </div>
      </div>

      {/* Right Widget: D3 Booking Trends */}
      <div className="rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="font-display text-base font-semibold text-slate-900">
              Booking Trends
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Confirmed, cancelled &amp; open capacity across schedule
            </p>
          </div>
          <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => setBookingView('date')}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                bookingView === 'date'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              By Date
            </button>
            <button
              type="button"
              onClick={() => setBookingView('specialty')}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                bookingView === 'specialty'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              By Specialty
            </button>
          </div>
        </div>

        <div className="relative px-4 pt-3 pb-4" ref={bookingChartContainerRef}>
          <svg className="h-[220px] w-full overflow-visible" role="img" aria-label="Booking trends grouped bar chart" />
          {bookingTooltip.visible && (
            <div
              className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-[11px] text-white shadow-lg"
              style={{ left: bookingTooltip.x, top: bookingTooltip.y }}
            >
              <p className="font-semibold text-teal-300">{bookingTooltip.title}</p>
              {bookingTooltip.lines.map((line, i) => (
                <p key={i} className="font-mono text-slate-200 tabular-nums">
                  {line}
                </p>
              ))}
            </div>
          )}
          <div className="mt-1 flex items-center gap-4 border-t border-slate-100 pt-2.5 font-mono text-[11px] text-slate-600 tabular-nums">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-xs bg-teal-700" />
              Confirmed
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-xs bg-red-600" />
              Cancelled
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-xs bg-slate-400" />
              Open Slots
            </span>
          </div>
        </div>
      </div>
    </section>
  );
};
