import React, { useMemo, useState } from 'react';
import { Award, ChevronDown, ChevronUp, Search, Stethoscope } from 'lucide-react';
import type { Doctor, Slot } from '../types/clinic';

interface DoctorsDirectoryProps {
  doctors: Doctor[];
  slots: Slot[];
  highlightedSlotId: string | null;
  onSelectSlot: (doctor: Doctor, slot: Slot) => void;
}

function formatDateLabel(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((dt.getTime() - today.getTime()) / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Tomorrow';
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const TONE_AVATAR: Record<string, string> = {
  teal: 'bg-teal-50 text-teal-800 border-teal-200',
  sky: 'bg-sky-50 text-sky-800 border-sky-200',
  indigo: 'bg-indigo-50 text-indigo-800 border-indigo-200',
  amber: 'bg-amber-50 text-amber-800 border-amber-200',
  emerald: 'bg-emerald-50 text-emerald-800 border-emerald-200',
};

export const DoctorsDirectory: React.FC<DoctorsDirectoryProps> = ({
  doctors,
  slots,
  highlightedSlotId,
  onSelectSlot,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [specialtyFilter, setSpecialtyFilter] = useState('All');
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});

  const toggleExpanded = (doctorId: string) => {
    setExpandedIds((prev) => ({ ...prev, [doctorId]: !prev[doctorId] }));
  };

  const uniqueDates = useMemo(() => {
    const set = new Set(slots.map((s) => s.date));
    return Array.from(set).sort();
  }, [slots]);

  const [selectedDate, setSelectedDate] = useState<string>('');
  const activeDate = selectedDate || uniqueDates[0] || '';

  const specialties = useMemo(() => {
    const set = new Set(doctors.map((d) => d.specialty));
    return ['All', ...Array.from(set)];
  }, [doctors]);

  const filteredDoctors = useMemo(() => {
    return doctors.filter((doc) => {
      if (specialtyFilter !== 'All' && doc.specialty !== specialtyFilter) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        return (
          doc.name.toLowerCase().includes(q) ||
          doc.specialty.toLowerCase().includes(q) ||
          doc.room.toLowerCase().includes(q) ||
          doc.focusAreas.toLowerCase().includes(q) ||
          doc.bio.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [doctors, specialtyFilter, searchQuery]);

  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-display text-base font-semibold text-slate-900">
            Doctors & Available Slots
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Select an open slot to book directly, or ask Tara by voice.
          </p>
        </div>

        {/* Date Segmented Tabs */}
        <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
          {uniqueDates.map((dateStr) => {
            const active = dateStr === activeDate;
            return (
              <button
                key={dateStr}
                type="button"
                onClick={() => setSelectedDate(dateStr)}
                className={`whitespace-nowrap shrink-0 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  active
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {formatDateLabel(dateStr)}
              </button>
            );
          })}
        </div>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter by doctor or specialty..."
            className="w-full rounded-lg border border-slate-200 bg-slate-50 py-1.5 pr-3 pl-8 text-xs text-slate-900 placeholder:text-slate-400 focus:border-teal-600 focus:bg-white focus:outline-none"
          />
        </div>

        <div className="flex flex-wrap items-center gap-1">
          {specialties.map((spec) => {
            const active = specialtyFilter === spec;
            return (
              <button
                key={spec}
                type="button"
                onClick={() => setSpecialtyFilter(spec)}
                className={`whitespace-nowrap shrink-0 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  active
                    ? 'bg-teal-700 text-white'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                {spec}
              </button>
            );
          })}
        </div>
      </div>

      {/* Doctors List */}
      <div className="divide-y divide-slate-100">
        {filteredDoctors.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-slate-500">
            No doctors match your current filter.
          </div>
        ) : (
          filteredDoctors.map((doc) => {
            const daySlots = slots.filter(
              (s) => s.doctorId === doc.id && s.date === activeDate
            );
            const openCount = daySlots.filter((s) => !s.isBooked).length;
            const isExpanded = Boolean(expandedIds[doc.id]);
            const profilePanelId = `doctor-profile-${doc.id}`;

            return (
              <div key={doc.id} className="px-5 py-4 transition-colors hover:bg-slate-50/40">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="flex items-start gap-3.5 min-w-0">
                    <div
                      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border font-display text-xs font-semibold ${
                        TONE_AVATAR[doc.tone] || TONE_AVATAR.teal
                      }`}
                    >
                      {doc.initials}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <h3 className="font-display text-sm font-semibold text-slate-900">
                          {doc.name}
                        </h3>
                        <span className="text-xs font-medium text-teal-700">
                          {doc.specialty}
                        </span>
                        <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                          · {doc.experienceYears} yrs exp
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {doc.qualifications}
                        <span aria-hidden="true"> · </span>
                        {doc.room}
                        <span aria-hidden="true"> · </span>
                        <span className="font-mono tabular-nums">
                          ₹{doc.consultationFee}
                        </span>
                        <span aria-hidden="true"> · </span>
                        <span className="tabular-nums">
                          {openCount} open
                        </span>
                      </p>
                      <button
                        type="button"
                        onClick={() => toggleExpanded(doc.id)}
                        aria-expanded={isExpanded}
                        aria-controls={profilePanelId}
                        className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium text-teal-700 transition-colors hover:text-teal-900"
                      >
                        {isExpanded ? 'Hide profile' : 'View doctor profile'}
                        {isExpanded ? (
                          <ChevronUp className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronDown className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                    {daySlots.map((slot) => {
                      const isHighlighted = highlightedSlotId === slot.id;
                      return (
                        <button
                          key={slot.id}
                          type="button"
                          disabled={slot.isBooked}
                          onClick={() => onSelectSlot(doc, slot)}
                          className={`whitespace-nowrap shrink-0 rounded-lg border px-2.5 py-1.5 font-mono text-xs tabular-nums transition-colors ${
                            slot.isBooked
                              ? 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400 line-through'
                              : isHighlighted
                              ? 'border-teal-600 bg-teal-50 text-teal-900 ring-2 ring-teal-500/30'
                              : 'border-slate-200 bg-white text-slate-700 hover:border-teal-600 hover:bg-teal-50/50 hover:text-teal-800'
                          }`}
                          title={
                            slot.isBooked
                              ? 'Slot already booked'
                              : `Book ${doc.name} at ${slot.time}`
                          }
                        >
                          {slot.time}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {isExpanded && (
                  <div
                    id={profilePanelId}
                    className="mt-3.5 rounded-lg border border-slate-200/80 border-l-2 border-l-teal-600 bg-slate-50/80 px-4 py-3.5 text-xs text-slate-700 sm:ml-[54px]"
                  >
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="flex items-start gap-2">
                        <Stethoscope className="mt-0.5 h-3.5 w-3.5 shrink-0 text-teal-700" />
                        <div>
                          <p className="font-medium text-slate-900">
                            Specialty Focus
                          </p>
                          <p className="mt-0.5 text-slate-600">
                            {doc.focusAreas || `${doc.specialty} · ${doc.qualifications}`}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-start gap-2">
                        <Award className="mt-0.5 h-3.5 w-3.5 shrink-0 text-teal-700" />
                        <div>
                          <p className="font-medium text-slate-900">
                            Clinical Experience
                          </p>
                          <p className="mt-0.5 text-slate-600 tabular-nums">
                            {doc.experienceYears} years in {doc.specialty} · {doc.qualifications}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="mt-3 border-t border-slate-200/70 pt-2.5">
                      <p className="font-medium text-slate-900">Biography</p>
                      <p className="mt-1 leading-relaxed text-slate-600">
                        {doc.bio}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </section>
  );
};
