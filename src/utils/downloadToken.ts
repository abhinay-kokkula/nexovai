import type { Appointment, Doctor } from '../types/clinic';

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function downloadAppointmentToken(
  appointment: Appointment,
  doctor?: Doctor
): void {
  const width = 880;
  const height = 460;
  const scale = 2;

  const canvas = document.createElement('canvas');
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.scale(scale, scale);

  // Outer card background
  ctx.fillStyle = '#F8FAFC';
  ctx.fillRect(0, 0, width, height);

  // Ticket card surface
  roundRectPath(ctx, 24, 24, width - 48, height - 48, 20);
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = '#CBD5E1';
  ctx.stroke();

  // Top teal accent header strip
  ctx.save();
  roundRectPath(ctx, 24, 24, width - 48, 92, 20);
  ctx.clip();
  ctx.fillStyle = '#0F766E';
  ctx.fillRect(24, 24, width - 48, 92);
  ctx.restore();
  // Square off bottom corners of header strip
  ctx.fillStyle = '#0F766E';
  ctx.fillRect(24, 92, width - 48, 24);

  // Header brand & badge
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '700 24px "Plus Jakarta Sans", system-ui, sans-serif';
  ctx.fillText('Tara', 52, 66);

  ctx.fillStyle = '#CCFBF1';
  ctx.font = '500 13px "DM Sans", system-ui, sans-serif';
  ctx.fillText('CLINIC VISIT TOKEN PASS', 52, 92);

  // Confirmed badge on right of header
  roundRectPath(ctx, width - 196, 46, 144, 34, 8);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
  ctx.fill();
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '600 13px "JetBrains Mono", monospace';
  ctx.textAlign = 'center';
  ctx.fillText('CONFIRMED', width - 124, 68);
  ctx.textAlign = 'left';

  // Prominent Token ID block
  ctx.fillStyle = '#64748B';
  ctx.font = '600 11px "DM Sans", system-ui, sans-serif';
  ctx.fillText('TOKEN NUMBER', 52, 152);

  ctx.fillStyle = '#0F172A';
  ctx.font = '700 34px "JetBrains Mono", monospace';
  ctx.fillText(appointment.id, 52, 190);

  // Schedule pill-free highlight box
  roundRectPath(ctx, 52, 212, 540, 82, 12);
  ctx.fillStyle = '#F0FDFA';
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = '#99F6E4';
  ctx.stroke();

  ctx.fillStyle = '#0F766E';
  ctx.font = '600 11px "DM Sans", system-ui, sans-serif';
  ctx.fillText('CONSULTATION SCHEDULE', 72, 238);

  ctx.fillStyle = '#0F172A';
  ctx.font = '700 22px "JetBrains Mono", monospace';
  ctx.fillText(`${appointment.date}   ·   ${appointment.time}`, 72, 272);

  // Details grid (left + middle columns)
  const fields: Array<{ label: string; value: string; x: number; y: number }> = [
    { label: 'PATIENT', value: appointment.patientName, x: 52, y: 332 },
    { label: 'SPOKEN PHONE', value: appointment.phoneNumber, x: 245, y: 332 },
    {
      label: 'DOCTOR',
      value: `${appointment.doctorName} (${appointment.specialty})`,
      x: 430,
      y: 332,
    },
    {
      label: 'ROOM / SUITE',
      value: doctor?.room || 'Front Desk Assigned',
      x: 52,
      y: 388,
    },
    {
      label: 'CONSULTATION FEE',
      value: doctor ? `INR ${doctor.consultationFee}` : 'Standard Clinic Fee',
      x: 245,
      y: 388,
    },
    {
      label: 'VISIT REASON',
      value:
        appointment.reason.length > 30
          ? `${appointment.reason.slice(0, 28)}...`
          : appointment.reason,
      x: 430,
      y: 388,
    },
  ];

  for (const field of fields) {
    ctx.fillStyle = '#64748B';
    ctx.font = '600 10px "DM Sans", system-ui, sans-serif';
    ctx.fillText(field.label, field.x, field.y);

    ctx.fillStyle = '#0F172A';
    ctx.font = '600 14px "DM Sans", system-ui, sans-serif';
    ctx.fillText(field.value, field.x, field.y + 20);
  }

  // Perforated vertical divider before stub verification matrix
  ctx.save();
  ctx.setLineDash([5, 5]);
  ctx.strokeStyle = '#CBD5E1';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(632, 136);
  ctx.lineTo(632, 412);
  ctx.stroke();
  ctx.restore();

  // Deterministic QR-style check-in verification block
  const matrixX = 668;
  const matrixY = 148;
  const cell = 11;
  const grid = 13;
  const seedStr = `${appointment.id}-${appointment.phoneNormalized}-${appointment.slotId}`;

  ctx.fillStyle = '#0F172A';
  for (let r = 0; r < grid; r++) {
    for (let c = 0; c < grid; c++) {
      const isCorner =
        (r < 3 && c < 3) ||
        (r < 3 && c >= grid - 3) ||
        (r >= grid - 3 && c < 3);
      const charCode = seedStr.charCodeAt((r * grid + c) % seedStr.length);
      const filled = isCorner || (charCode + r * 7 + c * 13) % 3 === 0;
      if (filled) {
        ctx.fillRect(matrixX + c * cell, matrixY + r * cell, cell - 2, cell - 2);
      }
    }
  }

  ctx.fillStyle = '#475569';
  ctx.font = '500 11px "JetBrains Mono", monospace';
  ctx.textAlign = 'center';
  ctx.fillText('CHECK-IN PASS', matrixX + (grid * cell) / 2, matrixY + grid * cell + 26);
  ctx.fillStyle = '#94A3B8';
  ctx.font = '400 10px "DM Sans", system-ui, sans-serif';
  ctx.fillText('Show at clinic desk', matrixX + (grid * cell) / 2, matrixY + grid * cell + 44);
  ctx.textAlign = 'left';

  // Download via anchor element (no window.open)
  const dataUrl = canvas.toDataURL('image/png');
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = `DrConnect-Token-${appointment.id}.png`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
