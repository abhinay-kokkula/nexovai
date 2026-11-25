export interface Doctor {
  id: string;
  name: string;
  specialty: string;
  qualifications: string;
  experienceYears: number;
  focusAreas: string;
  room: string;
  consultationFee: number;
  bio: string;
  initials: string;
  tone: string;
}

export interface Slot {
  id: string;
  doctorId: string;
  date: string;
  time: string;
  isBooked: boolean;
}

export interface Appointment {
  id: string;
  patientName: string;
  phoneNumber: string;
  phoneNormalized: string;
  doctorId: string;
  doctorName: string;
  specialty: string;
  slotId: string;
  date: string;
  time: string;
  reason: string;
  status: 'Confirmed' | 'Cancelled';
  createdAt: string;
}

export interface ToolEvent {
  id: string;
  name: 'check_doctor_availability' | 'book_appointment' | 'cancel_appointment';
  args: Record<string, unknown>;
  result: Record<string, unknown>;
  timestamp: string;
}

export interface TranscriptEntry {
  id: string;
  speaker: 'caller' | 'agent' | 'tool';
  text: string;
  timestamp: string;
  toolEvent?: ToolEvent;
  isInterim?: boolean;
}

export interface CallLog {
  id: string;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number;
  callerPhone: string | null;
  sttProvider: string;
  ttsProvider: string;
  outcome: string;
  transcript: TranscriptEntry[];
}

export interface PipelineCapabilities {
  gemini: boolean;
  deepgram: boolean;
  sarvam: boolean;
}

export interface BootstrapPayload {
  doctors: Doctor[];
  slots: Slot[];
  appointments: Appointment[];
  callLogs: CallLog[];
  capabilities: PipelineCapabilities;
}

export type CallState = 'idle' | 'ringing' | 'connected' | 'ended';
