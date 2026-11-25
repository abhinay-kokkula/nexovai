import React, { useMemo, useState } from 'react';
import { Download, Search } from 'lucide-react';
import type { Appointment } from '../types/clinic';

interface AppointmentsLedgerProps {
  appointments: Appointment[];
  highlightedAppointmentId: string | null;
  highlightAction: 'booked' | 'cancelled' | null;
  onCancelAppointment: (appointment: Appointment) => void;
  onDownloadToken: (appointment: Appointment) => void;
  cancellingId: string | null;
}

export const AppointmentsLedger: React.FC<AppointmentsLedgerProps> = ({
  appointments,
  highlightedAppointmentId,
  highlightAction,
  onCancelAppointment,
  onDownloadToken,
  cancellingId,
}) => {
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'All' | 'Confirmed' | 'Cancelled'>('All');

  const filtered = useMemo(() => {
    return appointments.filter((apt) => {
      if (statusFilter !== 'All' && apt.status !== statusFilter) return false;
      if (query.trim()) {
        const q = query.trim().toLowerCase();
        return (
          apt.patientName.toLowerCase().includes(q) ||
          apt.phoneNumber.toLowerCase().includes(q) ||
          apt.phoneNormalized.includes(q.replace(/\D/g, '')) ||
          apt.doctorName.toLowerCase().includes(q) ||
          apt.id.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [appointments, query, statusFilter]);

  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-display text-base font-semibold text-slate-900">
            Appointments
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Updates automatically as callers book or cancel by spoken phone number.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[180px] flex-1 sm:flex-none">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Phone, patient, ID..."
              className="w-full rounded-lg border border-slate-200 bg-slate-50 py-1.5 pr-2.5 pl-8 text-xs text-slate-900 placeholder:text-slate-400 focus:border-teal-600 focus:bg-white focus:outline-none sm:w-52"
            />
          </div>

          <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
            {(['All', 'Confirmed', 'Cancelled'] as const).map((status) => (
              <button
                key={status}
                type="button"
                onClick={() => setStatusFilter(status)}
                className={`whitespace-nowrap shrink-0 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  statusFilter === status
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {status}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/75 text-slate-500">
              <th className="px-5 py-2.5 font-medium">Ref</th>
              <th className="px-4 py-2.5 font-medium">Caller Phone</th>
              <th className="px-4 py-2.5 font-medium">Patient</th>
              <th className="px-4 py-2.5 font-medium">Doctor</th>
              <th className="px-4 py-2.5 font-medium">Schedule</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
              <th className="px-5 py-2.5 text-right font-medium">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-5 py-10 text-center text-sm text-slate-500">
                  No appointments found matching your filter.
                </td>
              </tr>
            ) : (
              filtered.map((apt) => {
                const isHighlighted = highlightedAppointmentId === apt.id;
                const flashClass = isHighlighted
                  ? highlightAction === 'cancelled'
                    ? 'animate-row-cancelled'
                    : 'animate-row-booked'
                  : '';

                return (
                  <tr
                    key={apt.id}
                    className={`transition-colors hover:bg-slate-50/70 ${flashClass}`}
                  >
                    <td className="whitespace-nowrap px-5 py-3 font-mono text-slate-600 tabular-nums">
                      {apt.id}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 font-mono font-medium text-slate-900 tabular-nums">
                      {apt.phoneNumber}
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      <span className="font-medium text-slate-900">{apt.patientName}</span>
                      <span className="block truncate max-w-[160px] text-[11px] text-slate-500">
                        {apt.reason}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-medium text-slate-900">{apt.doctorName}</span>
                      <span className="block text-[11px] text-slate-500">{apt.specialty}</span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-slate-700 tabular-nums">
                      <span>{apt.date}</span>
                      <span className="mx-1 text-slate-300">·</span>
                      <span>{apt.time}</span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 font-medium">
                      <span
                        className={
                          apt.status === 'Confirmed'
                            ? 'text-emerald-700'
                            : 'text-red-600'
                        }
                      >
                        {apt.status}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-5 py-3 text-right">
                      {apt.status === 'Confirmed' ? (
                        <div className="inline-flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => onDownloadToken(apt)}
                            className="inline-flex items-center gap-1 rounded-md border border-teal-200 bg-teal-50/70 px-2.5 py-1 text-xs font-medium text-teal-800 transition-colors hover:bg-teal-100"
                            title={`Download token pass for ${apt.id}`}
                          >
                            <Download className="h-3 w-3" />
                            Token
                          </button>
                          <button
                            type="button"
                            disabled={cancellingId === apt.id}
                            onClick={() => onCancelAppointment(apt)}
                            className="rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-700 disabled:opacity-50"
                          >
                            {cancellingId === apt.id ? 'Cancelling...' : 'Cancel'}
                          </button>
                        </div>
                      ) : (
                        <span className="text-[11px] text-slate-400">Closed</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
};
