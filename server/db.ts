import Database from 'better-sqlite3';
import crypto from 'crypto';
import path from 'path';
import type { Appointment, CallLog, Doctor, Slot, TranscriptEntry } from '../src/types/clinic.js';

const DB_PATH = path.resolve(process.cwd(), 'meridian_clinic.db');
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS doctors (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    specialty TEXT NOT NULL,
    qualifications TEXT NOT NULL,
    experience_years INTEGER NOT NULL DEFAULT 8,
    focus_areas TEXT NOT NULL DEFAULT '',
    room TEXT NOT NULL,
    consultation_fee INTEGER NOT NULL,
    bio TEXT NOT NULL,
    initials TEXT NOT NULL,
    tone TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS slots (
    id TEXT PRIMARY KEY,
    doctor_id TEXT NOT NULL,
    date TEXT NOT NULL,
    time TEXT NOT NULL,
    is_booked INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS appointments (
    id TEXT PRIMARY KEY,
    patient_name TEXT NOT NULL,
    phone_number TEXT NOT NULL,
    phone_normalized TEXT NOT NULL,
    doctor_id TEXT NOT NULL,
    doctor_name TEXT NOT NULL,
    specialty TEXT NOT NULL,
    slot_id TEXT NOT NULL,
    date TEXT NOT NULL,
    time TEXT NOT NULL,
    reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'Confirmed',
    created_at TEXT NOT NULL,
    FOREIGN KEY (doctor_id) REFERENCES doctors(id)
  );

  CREATE TABLE IF NOT EXISTS call_logs (
    id TEXT PRIMARY KEY,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    duration_seconds INTEGER NOT NULL DEFAULT 0,
    caller_phone TEXT,
    stt_provider TEXT NOT NULL,
    tts_provider TEXT NOT NULL,
    outcome TEXT NOT NULL,
    transcript_json TEXT NOT NULL
  );
`);

// Safe schema migration for existing SQLite files
const existingDoctorCols = (
  db.prepare(`PRAGMA table_info(doctors)`).all() as Array<{ name: string }>
).map((c) => c.name);
if (!existingDoctorCols.includes('experience_years')) {
  db.exec(`ALTER TABLE doctors ADD COLUMN experience_years INTEGER NOT NULL DEFAULT 8`);
}
if (!existingDoctorCols.includes('focus_areas')) {
  db.exec(`ALTER TABLE doctors ADD COLUMN focus_areas TEXT NOT NULL DEFAULT ''`);
}

export function getOffsetIsoDate(offsetDays: number): string {
  const now = new Date();
  const target = new Date(now.getTime() + offsetDays * 24 * 60 * 60 * 1000);
  const year = target.getFullYear();
  const month = String(target.getMonth() + 1).padStart(2, '0');
  const day = String(target.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function normalizePhone(raw: string): string {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length >= 10) {
    return digits.slice(-10);
  }
  return digits;
}

export function formatPhoneDisplay(raw: string): string {
  const norm = normalizePhone(raw);
  if (norm.length === 10) {
    return `${norm.slice(0, 5)} ${norm.slice(5)}`;
  }
  return raw.trim();
}

function normalizeTimeString(timeStr: string): string {
  return timeStr.trim().toUpperCase().replace(/\s+/g, ' ');
}

function seedIfEmpty(): void {
  const doctorCount = (db.prepare('SELECT COUNT(*) as c FROM doctors').get() as { c: number }).c;
  if (doctorCount > 0) return;

  const doctors: Doctor[] = [
    {
      id: 'doc-ananya',
      name: 'Dr. Ananya Rao',
      specialty: 'Cardiology',
      qualifications: 'MD, DM (Cardiology)',
      experienceYears: 14,
      focusAreas: 'Preventive Cardiology · Hypertension · Diagnostic ECG & Echo',
      room: 'Suite 204',
      consultationFee: 1200,
      bio: 'Senior cardiologist with 14 years of clinical experience managing hypertension, chest discomfort evaluations, lipid disorders, and long-term cardiac risk reduction.',
      initials: 'AR',
      tone: 'teal',
    },
    {
      id: 'doc-vikram',
      name: 'Dr. Vikram Sethi',
      specialty: 'Dermatology',
      qualifications: 'MD (Dermatology)',
      experienceYears: 11,
      focusAreas: 'Clinical Dermatology · Eczema & Allergies · Acne & Scalp Care',
      room: 'Suite 108',
      consultationFee: 900,
      bio: 'Board-certified dermatologist specializing in acute skin rashes, chronic eczema, allergy patch testing, and evidence-based dermatologic treatments for adults and teens.',
      initials: 'VS',
      tone: 'sky',
    },
    {
      id: 'doc-meera',
      name: 'Dr. Meera Krishnan',
      specialty: 'Pediatrics',
      qualifications: 'MD (Pediatrics)',
      experienceYears: 12,
      focusAreas: 'Child Wellness · Immunizations · Pediatric Respiratory & Fever Care',
      room: 'Suite 112',
      consultationFee: 850,
      bio: 'Compassionate pediatrician dedicated to developmental checkups, childhood vaccination schedules, seasonal viral fevers, and family-centered guidance for newborns through adolescents.',
      initials: 'MK',
      tone: 'indigo',
    },
    {
      id: 'doc-arjun',
      name: 'Dr. Arjun Kulkarni',
      specialty: 'Orthopedics',
      qualifications: 'MS (Orthopedics)',
      experienceYears: 15,
      focusAreas: 'Sports Injuries · Joint & Knee Pain · Spine & Posture Rehabilitation',
      room: 'Suite 302',
      consultationFee: 1100,
      bio: 'Orthopedic specialist focused on non-surgical joint preservation, ligament and sports injury recovery, lower-back evaluations, and structured mobility plans.',
      initials: 'AK',
      tone: 'amber',
    },
    {
      id: 'doc-priya',
      name: 'Dr. Priya Nair',
      specialty: 'General Medicine',
      qualifications: 'MBBS, MD (Internal Med)',
      experienceYears: 10,
      focusAreas: 'Primary Care · Fever & Infections · Diabetes & Thyroid Management',
      room: 'Suite 101',
      consultationFee: 700,
      bio: 'Internal medicine physician providing comprehensive adult checkups, fever and respiratory workups, preventive blood panels, and ongoing metabolic follow-up care.',
      initials: 'PN',
      tone: 'emerald',
    },
    {
      id: 'doc-kabir',
      name: 'Dr. Kabir Malhotra',
      specialty: 'General Therapist',
      qualifications: 'MBBS, PG Dip (General Therapy)',
      experienceYears: 7,
      focusAreas: 'Same-Day Primary Care · Stress & Sleep Support · Preventive Wellness',
      room: 'Suite 102',
      consultationFee: 650,
      bio: 'General therapist offering accessible same-day consultations for everyday symptoms, fatigue, stress-related concerns, lifestyle guidance, and specialist referrals when needed.',
      initials: 'KM',
      tone: 'teal',
    },
  ];

  const insertDoc = db.prepare(`
    INSERT INTO doctors (id, name, specialty, qualifications, experience_years, focus_areas, room, consultation_fee, bio, initials, tone)
    VALUES (@id, @name, @specialty, @qualifications, @experienceYears, @focusAreas, @room, @consultationFee, @bio, @initials, @tone)
  `);

  const insertSlot = db.prepare(`
    INSERT INTO slots (id, doctor_id, date, time, is_booked)
    VALUES (@id, @doctorId, @date, @time, @isBooked)
  `);

  const day0 = getOffsetIsoDate(0);
  const day1 = getOffsetIsoDate(1);
  const day2 = getOffsetIsoDate(2);
  const dates = [day0, day1, day2];

  const timeTemplates: Record<string, string[]> = {
    'doc-ananya': ['09:30 AM', '11:00 AM', '02:00 PM', '04:30 PM'],
    'doc-vikram': ['10:00 AM', '11:30 AM', '03:00 PM', '05:00 PM'],
    'doc-meera': ['09:00 AM', '10:30 AM', '01:30 PM', '04:00 PM'],
    'doc-arjun': ['10:00 AM', '12:00 PM', '02:30 PM', '05:30 PM'],
    'doc-priya': ['09:00 AM', '11:00 AM', '01:00 PM', '03:30 PM', '05:00 PM'],
    'doc-kabir': ['09:30 AM', '11:30 AM', '02:30 PM', '04:30 PM', '06:00 PM'],
  };

  const seedTx = db.transaction(() => {
    for (const doc of doctors) {
      insertDoc.run(doc);
      for (const date of dates) {
        const times = timeTemplates[doc.id] || ['10:00 AM', '02:00 PM'];
        for (const time of times) {
          insertSlot.run({
            id: `slot-${doc.id}-${date}-${time.replace(/[^a-zA-Z0-9]/g, '')}`,
            doctorId: doc.id,
            date,
            time,
            isBooked: 0,
          });
        }
      }
    }

    const seedBookings = [
      {
        id: 'APT-1041',
        patientName: 'Rohan Sharma',
        phoneRaw: '9876543210',
        doctorId: 'doc-ananya',
        doctorName: 'Dr. Ananya Rao',
        specialty: 'Cardiology',
        date: day0,
        time: '11:00 AM',
        reason: 'Annual cardiac checkup',
      },
      {
        id: 'APT-1042',
        patientName: 'Kavita Iyer',
        phoneRaw: '9123456789',
        doctorId: 'doc-priya',
        doctorName: 'Dr. Priya Nair',
        specialty: 'General Medicine',
        date: day0,
        time: '03:30 PM',
        reason: 'Routine blood pressure follow-up',
      },
      {
        id: 'APT-1043',
        patientName: 'Devansh Patel',
        phoneRaw: '9988776655',
        doctorId: 'doc-vikram',
        doctorName: 'Dr. Vikram Sethi',
        specialty: 'Dermatology',
        date: day1,
        time: '10:00 AM',
        reason: 'Skin rash evaluation',
      },
    ];

    const insertApt = db.prepare(`
      INSERT INTO appointments (id, patient_name, phone_number, phone_normalized, doctor_id, doctor_name, specialty, slot_id, date, time, reason, status, created_at)
      VALUES (@id, @patientName, @phoneNumber, @phoneNormalized, @doctorId, @doctorName, @specialty, @slotId, @date, @time, @reason, 'Confirmed', @createdAt)
    `);
    const markSlot = db.prepare(`UPDATE slots SET is_booked = 1 WHERE id = ?`);

    for (const b of seedBookings) {
      const slotId = `slot-${b.doctorId}-${b.date}-${b.time.replace(/[^a-zA-Z0-9]/g, '')}`;
      markSlot.run(slotId);
      insertApt.run({
        id: b.id,
        patientName: b.patientName,
        phoneNumber: formatPhoneDisplay(b.phoneRaw),
        phoneNormalized: normalizePhone(b.phoneRaw),
        doctorId: b.doctorId,
        doctorName: b.doctorName,
        specialty: b.specialty,
        slotId,
        date: b.date,
        time: b.time,
        reason: b.reason,
        createdAt: new Date().toISOString(),
      });
    }
  });

  seedTx();
}

seedIfEmpty();

function ensureDoctorProfilesUpdated(): void {
  const existing = db.prepare(`SELECT id FROM doctors WHERE id = 'doc-kabir'`).get();
  if (!existing) {
    const insertDoc = db.prepare(`
      INSERT OR IGNORE INTO doctors (id, name, specialty, qualifications, experience_years, focus_areas, room, consultation_fee, bio, initials, tone)
      VALUES (@id, @name, @specialty, @qualifications, @experienceYears, @focusAreas, @room, @consultationFee, @bio, @initials, @tone)
    `);
    const insertSlot = db.prepare(`
      INSERT OR IGNORE INTO slots (id, doctor_id, date, time, is_booked)
      VALUES (@id, @doctorId, @date, @time, @isBooked)
    `);

    const dates = [getOffsetIsoDate(0), getOffsetIsoDate(1), getOffsetIsoDate(2)];
    const times = ['09:30 AM', '11:30 AM', '02:30 PM', '04:30 PM', '06:00 PM'];

    const tx = db.transaction(() => {
      insertDoc.run({
        id: 'doc-kabir',
        name: 'Dr. Kabir Malhotra',
        specialty: 'General Therapist',
        qualifications: 'MBBS, PG Dip (General Therapy)',
        experienceYears: 7,
        focusAreas: 'Same-Day Primary Care · Stress & Sleep Support · Preventive Wellness',
        room: 'Suite 102',
        consultationFee: 650,
        bio: 'General therapist offering accessible same-day consultations for everyday symptoms, fatigue, stress-related concerns, lifestyle guidance, and specialist referrals when needed.',
        initials: 'KM',
        tone: 'teal',
      });
      for (const date of dates) {
        for (const time of times) {
          insertSlot.run({
            id: `slot-doc-kabir-${date}-${time.replace(/[^a-zA-Z0-9]/g, '')}`,
            doctorId: 'doc-kabir',
            date,
            time,
            isBooked: 0,
          });
        }
      }
    });
    tx();
  }

  // Ensure existing DB rows receive enriched experienceYears, focusAreas, and full biographies
  const profileUpdates: Array<{
    id: string;
    experienceYears: number;
    focusAreas: string;
    bio: string;
  }> = [
    {
      id: 'doc-ananya',
      experienceYears: 14,
      focusAreas: 'Preventive Cardiology · Hypertension · Diagnostic ECG & Echo',
      bio: 'Senior cardiologist with 14 years of clinical experience managing hypertension, chest discomfort evaluations, lipid disorders, and long-term cardiac risk reduction.',
    },
    {
      id: 'doc-vikram',
      experienceYears: 11,
      focusAreas: 'Clinical Dermatology · Eczema & Allergies · Acne & Scalp Care',
      bio: 'Board-certified dermatologist specializing in acute skin rashes, chronic eczema, allergy patch testing, and evidence-based dermatologic treatments for adults and teens.',
    },
    {
      id: 'doc-meera',
      experienceYears: 12,
      focusAreas: 'Child Wellness · Immunizations · Pediatric Respiratory & Fever Care',
      bio: 'Compassionate pediatrician dedicated to developmental checkups, childhood vaccination schedules, seasonal viral fevers, and family-centered guidance for newborns through adolescents.',
    },
    {
      id: 'doc-arjun',
      experienceYears: 15,
      focusAreas: 'Sports Injuries · Joint & Knee Pain · Spine & Posture Rehabilitation',
      bio: 'Orthopedic specialist focused on non-surgical joint preservation, ligament and sports injury recovery, lower-back evaluations, and structured mobility plans.',
    },
    {
      id: 'doc-priya',
      experienceYears: 10,
      focusAreas: 'Primary Care · Fever & Infections · Diabetes & Thyroid Management',
      bio: 'Internal medicine physician providing comprehensive adult checkups, fever and respiratory workups, preventive blood panels, and ongoing metabolic follow-up care.',
    },
    {
      id: 'doc-kabir',
      experienceYears: 7,
      focusAreas: 'Same-Day Primary Care · Stress & Sleep Support · Preventive Wellness',
      bio: 'General therapist offering accessible same-day consultations for everyday symptoms, fatigue, stress-related concerns, lifestyle guidance, and specialist referrals when needed.',
    },
  ];

  const updateStmt = db.prepare(`
    UPDATE doctors
    SET experience_years = @experienceYears,
        focus_areas = @focusAreas,
        bio = @bio
    WHERE id = @id AND (focus_areas = '' OR length(bio) < 100)
  `);
  const updateTx = db.transaction(() => {
    for (const p of profileUpdates) {
      updateStmt.run(p);
    }
  });
  updateTx();
}

ensureDoctorProfilesUpdated();

export function getDoctors(): Doctor[] {
  const rows = db.prepare(`
    SELECT id, name, specialty, qualifications, experience_years as experienceYears, focus_areas as focusAreas,
           room, consultation_fee as consultationFee, bio, initials, tone
    FROM doctors
    ORDER BY name ASC
  `).all() as Doctor[];
  return rows;
}

export function getSlots(): Slot[] {
  const rows = db.prepare(`
    SELECT id, doctor_id as doctorId, date, time, is_booked as isBookedRaw
    FROM slots
    ORDER BY date ASC, id ASC
  `).all() as Array<{ id: string; doctorId: string; date: string; time: string; isBookedRaw: number }>;

  return rows.map((r) => ({
    id: r.id,
    doctorId: r.doctorId,
    date: r.date,
    time: r.time,
    isBooked: Boolean(r.isBookedRaw),
  }));
}

export function getAppointments(): Appointment[] {
  return db.prepare(`
    SELECT id, patient_name as patientName, phone_number as phoneNumber, phone_normalized as phoneNormalized,
           doctor_id as doctorId, doctor_name as doctorName, specialty, slot_id as slotId,
           date, time, reason, status, created_at as createdAt
    FROM appointments
    ORDER BY created_at DESC
  `).all() as Appointment[];
}

export function getCallLogs(): CallLog[] {
  const rows = db.prepare(`
    SELECT id, started_at as startedAt, ended_at as endedAt, duration_seconds as durationSeconds,
           caller_phone as callerPhone, stt_provider as sttProvider, tts_provider as ttsProvider,
           outcome, transcript_json as transcriptJson
    FROM call_logs
    ORDER BY started_at DESC
    LIMIT 25
  `).all() as Array<{
    id: string;
    startedAt: string;
    endedAt: string | null;
    durationSeconds: number;
    callerPhone: string | null;
    sttProvider: string;
    ttsProvider: string;
    outcome: string;
    transcriptJson: string;
  }>;

  return rows.map((r) => {
    let transcript: TranscriptEntry[] = [];
    try {
      transcript = JSON.parse(r.transcriptJson);
    } catch {
      transcript = [];
    }
    return {
      id: r.id,
      startedAt: r.startedAt,
      endedAt: r.endedAt,
      durationSeconds: r.durationSeconds,
      callerPhone: r.callerPhone,
      sttProvider: r.sttProvider,
      ttsProvider: r.ttsProvider,
      outcome: r.outcome,
      transcript,
    };
  });
}

export function saveCallLog(log: CallLog): void {
  db.prepare(`
    INSERT OR REPLACE INTO call_logs
    (id, started_at, ended_at, duration_seconds, caller_phone, stt_provider, tts_provider, outcome, transcript_json)
    VALUES (@id, @startedAt, @endedAt, @durationSeconds, @callerPhone, @sttProvider, @ttsProvider, @outcome, @transcriptJson)
  `).run({
    id: log.id,
    startedAt: log.startedAt,
    endedAt: log.endedAt,
    durationSeconds: log.durationSeconds,
    callerPhone: log.callerPhone,
    sttProvider: log.sttProvider,
    ttsProvider: log.ttsProvider,
    outcome: log.outcome,
    transcriptJson: JSON.stringify(log.transcript),
  });
}

// ---------- Tool Operations ----------

function buildNearestAlternatives(options: {
  excludeDoctorId?: string;
  targetDate?: string;
}) {
  const doctors = getDoctors();
  const slots = getSlots();
  const preferredDate = options.targetDate || getOffsetIsoDate(0);

  // Prioritize General Therapist, General Medicine, then other available specialists
  const priorityOrder = (doc: Doctor) => {
    const s = doc.specialty.toLowerCase();
    if (s.includes('general therapist')) return 0;
    if (s.includes('general medicine')) return 1;
    return 2;
  };

  const candidates = doctors
    .filter((d) => d.id !== options.excludeDoctorId)
    .sort((a, b) => priorityOrder(a) - priorityOrder(b))
    .map((doc) => {
      const sameDayOpen = slots
        .filter((s) => s.doctorId === doc.id && !s.isBooked && s.date === preferredDate)
        .map((s) => ({ date: s.date, time: s.time }));
      const nextOpen =
        sameDayOpen.length > 0
          ? sameDayOpen
          : slots
              .filter((s) => s.doctorId === doc.id && !s.isBooked)
              .slice(0, 3)
              .map((s) => ({ date: s.date, time: s.time }));
      return {
        doctorName: doc.name,
        specialty: doc.specialty,
        room: doc.room,
        consultationFee: doc.consultationFee,
        openSlots: nextOpen.slice(0, 3),
      };
    })
    .filter((c) => c.openSlots.length > 0)
    .slice(0, 3);

  return candidates;
}

export function checkDoctorAvailability(params: {
  doctor_name?: string;
  specialty?: string;
  date?: string;
}) {
  const doctors = getDoctors();
  const slots = getSlots();

  let targetDate = params.date?.trim();
  if (targetDate) {
    const lower = targetDate.toLowerCase();
    if (lower === 'today') targetDate = getOffsetIsoDate(0);
    else if (lower === 'tomorrow') targetDate = getOffsetIsoDate(1);
  }

  let matchedDoctors = doctors;
  if (params.doctor_name?.trim()) {
    const q = params.doctor_name.trim().toLowerCase().replace(/^dr\.?\s*/i, '');
    matchedDoctors = matchedDoctors.filter((d) =>
      d.name.toLowerCase().includes(q)
    );
  }
  if (params.specialty?.trim()) {
    const sq = params.specialty.trim().toLowerCase();
    matchedDoctors = matchedDoctors.filter(
      (d) =>
        d.specialty.toLowerCase().includes(sq) ||
        (sq.includes('therap') && d.specialty.toLowerCase().includes('general')) ||
        (sq.includes('general') && d.specialty.toLowerCase().includes('general'))
    );
  }

  if (matchedDoctors.length === 0) {
    return {
      found: false,
      message:
        'Requested doctor or specialty is not available at Tara. Suggesting nearest available options such as our General Therapist and General Medicine physicians.',
      nearestAlternatives: buildNearestAlternatives({ targetDate }),
      availableDoctors: doctors.map((d) => ({ name: d.name, specialty: d.specialty })),
      today: getOffsetIsoDate(0),
      tomorrow: getOffsetIsoDate(1),
    };
  }

  const results = matchedDoctors.map((doc) => {
    const docSlots = slots.filter(
      (s) => s.doctorId === doc.id && !s.isBooked && (!targetDate || s.date === targetDate)
    );
    const byDate: Record<string, string[]> = {};
    for (const s of docSlots) {
      if (!byDate[s.date]) byDate[s.date] = [];
      byDate[s.date].push(s.time);
    }

    // If zero open slots on targetDate, include the doctor's other open dates too
    const nextAvailableDates: Record<string, string[]> = {};
    if (docSlots.length === 0 && targetDate) {
      for (const s of slots.filter((sl) => sl.doctorId === doc.id && !sl.isBooked)) {
        if (!nextAvailableDates[s.date]) nextAvailableDates[s.date] = [];
        nextAvailableDates[s.date].push(s.time);
      }
    }

    return {
      doctorName: doc.name,
      specialty: doc.specialty,
      room: doc.room,
      consultationFee: doc.consultationFee,
      availableSlotsByDate: byDate,
      totalOpenSlots: docSlots.length,
      ...(Object.keys(nextAvailableDates).length > 0 ? { nextAvailableDates } : {}),
    };
  });

  const hasAnyOpen = results.some((r) => r.totalOpenSlots > 0);

  return {
    found: true,
    today: getOffsetIsoDate(0),
    tomorrow: getOffsetIsoDate(1),
    doctors: results,
    ...(!hasAnyOpen
      ? {
          nearestAlternatives: buildNearestAlternatives({
            excludeDoctorId: matchedDoctors.length === 1 ? matchedDoctors[0].id : undefined,
            targetDate,
          }),
        }
      : {}),
  };
}

export function bookAppointment(params: {
  phone_number: string;
  doctor_name: string;
  date: string;
  time: string;
  patient_name?: string;
  reason?: string;
}) {
  const normPhone = normalizePhone(params.phone_number);
  if (normPhone.length < 7) {
    return {
      success: false,
      error: 'A valid phone number spoken by the caller is required to book an appointment.',
    };
  }

  let dateIso = params.date.trim();
  if (dateIso.toLowerCase() === 'today') dateIso = getOffsetIsoDate(0);
  else if (dateIso.toLowerCase() === 'tomorrow') dateIso = getOffsetIsoDate(1);

  const doctors = getDoctors();
  const docQuery = params.doctor_name.trim().toLowerCase().replace(/^dr\.?\s*/i, '');
  const doctor = doctors.find((d) => d.name.toLowerCase().includes(docQuery));
  if (!doctor) {
    return {
      success: false,
      error: `Could not find a doctor matching "${params.doctor_name}".`,
      nearestOptions: buildNearestAlternatives({ targetDate: dateIso }),
    };
  }

  const reqTimeNorm = normalizeTimeString(params.time);
  const allDocSlots = db.prepare(`
    SELECT id, doctor_id as doctorId, date, time, is_booked as isBooked
    FROM slots
    WHERE doctor_id = ? AND date = ?
  `).all(doctor.id, dateIso) as Array<{ id: string; doctorId: string; date: string; time: string; isBooked: number }>;

  const matchedSlot = allDocSlots.find((s) => {
    const sNorm = normalizeTimeString(s.time);
    if (sNorm === reqTimeNorm) return true;
    // Also support 24h or short forms like "2:00 PM" vs "02:00 PM"
    const stripZero = (v: string) => v.replace(/^0/, '');
    return stripZero(sNorm) === stripZero(reqTimeNorm);
  });

  if (!matchedSlot) {
    const open = allDocSlots.filter((s) => !s.isBooked).map((s) => s.time);
    return {
      success: false,
      error: `No slot at ${params.time} on ${dateIso} for ${doctor.name}.`,
      openSlotsForDate: open,
      nearestOptions: buildNearestAlternatives({ excludeDoctorId: doctor.id, targetDate: dateIso }),
    };
  }

  if (matchedSlot.isBooked) {
    const open = allDocSlots.filter((s) => !s.isBooked).map((s) => s.time);
    return {
      success: false,
      error: `The ${matchedSlot.time} slot on ${dateIso} with ${doctor.name} is already booked.`,
      openSlotsForDate: open,
      nearestOptions: buildNearestAlternatives({ excludeDoctorId: doctor.id, targetDate: dateIso }),
    };
  }

  const appointmentId = `APT-${crypto.randomInt(1100, 9999)}`;
  const displayPhone = formatPhoneDisplay(params.phone_number);
  const patientName = params.patient_name?.trim() || 'Voice Caller';
  const reason = params.reason?.trim() || 'General consultation';
  const createdAt = new Date().toISOString();

  const tx = db.transaction(() => {
    const updated = db.prepare(`UPDATE slots SET is_booked = 1 WHERE id = ? AND is_booked = 0`).run(matchedSlot.id);
    if (updated.changes === 0) {
      throw new Error('Slot was just booked by someone else.');
    }
    db.prepare(`
      INSERT INTO appointments (id, patient_name, phone_number, phone_normalized, doctor_id, doctor_name, specialty, slot_id, date, time, reason, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Confirmed', ?)
    `).run(
      appointmentId,
      patientName,
      displayPhone,
      normPhone,
      doctor.id,
      doctor.name,
      doctor.specialty,
      matchedSlot.id,
      matchedSlot.date,
      matchedSlot.time,
      reason,
      createdAt
    );
  });

  try {
    tx();
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unable to book slot.',
    };
  }

  const appointment: Appointment = {
    id: appointmentId,
    patientName,
    phoneNumber: displayPhone,
    phoneNormalized: normPhone,
    doctorId: doctor.id,
    doctorName: doctor.name,
    specialty: doctor.specialty,
    slotId: matchedSlot.id,
    date: matchedSlot.date,
    time: matchedSlot.time,
    reason,
    status: 'Confirmed',
    createdAt,
  };

  return {
    success: true,
    appointment,
  };
}

export function cancelAppointment(params: {
  phone_number: string;
  appointment_id?: string;
}) {
  const normPhone = normalizePhone(params.phone_number);
  if (normPhone.length < 7 && !params.appointment_id) {
    return {
      success: false,
      error: 'Caller phone number is required to look up and cancel an appointment.',
    };
  }

  let rows: Appointment[] = [];
  if (params.appointment_id?.trim()) {
    rows = db.prepare(`
      SELECT id, patient_name as patientName, phone_number as phoneNumber, phone_normalized as phoneNormalized,
             doctor_id as doctorId, doctor_name as doctorName, specialty, slot_id as slotId,
             date, time, reason, status, created_at as createdAt
      FROM appointments
      WHERE id = ? AND status = 'Confirmed'
    `).all(params.appointment_id.trim()) as Appointment[];
  }

  if (rows.length === 0 && normPhone.length >= 7) {
    rows = db.prepare(`
      SELECT id, patient_name as patientName, phone_number as phoneNumber, phone_normalized as phoneNormalized,
             doctor_id as doctorId, doctor_name as doctorName, specialty, slot_id as slotId,
             date, time, reason, status, created_at as createdAt
      FROM appointments
      WHERE phone_normalized = ? AND status = 'Confirmed'
      ORDER BY date ASC, created_at DESC
    `).all(normPhone) as Appointment[];
  }

  if (rows.length === 0) {
    return {
      success: false,
      error: `No active confirmed appointment found for phone number ${formatPhoneDisplay(params.phone_number)}.`,
    };
  }

  const target = rows[0];
  const tx = db.transaction(() => {
    db.prepare(`UPDATE appointments SET status = 'Cancelled' WHERE id = ?`).run(target.id);
    db.prepare(`UPDATE slots SET is_booked = 0 WHERE id = ?`).run(target.slotId);
  });
  tx();

  return {
    success: true,
    cancelledAppointment: { ...target, status: 'Cancelled' as const },
    remainingActiveForPhone: rows.length - 1,
  };
}

export function findAppointmentsByPhone(phoneNumber: string): Appointment[] {
  const norm = normalizePhone(phoneNumber);
  if (norm.length < 7) return [];
  return db.prepare(`
    SELECT id, patient_name as patientName, phone_number as phoneNumber, phone_normalized as phoneNormalized,
           doctor_id as doctorId, doctor_name as doctorName, specialty, slot_id as slotId,
           date, time, reason, status, created_at as createdAt
    FROM appointments
    WHERE phone_normalized = ? AND status = 'Confirmed'
    ORDER BY date ASC
  `).all(norm) as Appointment[];
}
