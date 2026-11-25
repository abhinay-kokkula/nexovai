import 'dotenv/config';
import express from 'express';
import http from 'http';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import WebSocket, { WebSocketServer } from 'ws';
import {
  bookAppointment,
  cancelAppointment,
  checkDoctorAvailability,
  getAppointments,
  getCallLogs,
  getDoctors,
  getSlots,
} from './server/db.js';
import {
  DashboardBroadcastEvent,
  getPipelineCapabilities,
  VoiceCallSession,
} from './server/voicePipeline.js';

const PORT = Number(process.env.PORT || 3000);

async function startServer(): Promise<void> {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });
  const dashboardClients = new Set<WebSocket>();

  const broadcastDashboard = (evt: DashboardBroadcastEvent) => {
    const payload = JSON.stringify(evt);
    for (const client of dashboardClients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  };

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
    if (url.pathname === '/ws/voice' || url.pathname === '/ws/dashboard') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request, url.pathname);
      });
    } else {
      socket.destroy();
    }
  });

  wss.on('connection', (ws: WebSocket, _request: http.IncomingMessage, pathname: string) => {
    if (pathname === '/ws/dashboard') {
      dashboardClients.add(ws);
      ws.on('close', () => dashboardClients.delete(ws));
      ws.on('error', () => dashboardClients.delete(ws));
      return;
    }

    if (pathname === '/ws/voice') {
      const session = new VoiceCallSession(ws, broadcastDashboard);

      ws.on('message', (data, isBinary) => {
        if (isBinary) {
          session.handleAudioChunk(Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer));
          return;
        }
        try {
          const msg = JSON.parse(data.toString()) as {
            type: string;
            speaker?: string;
            text?: string;
          };
          if (msg.type === 'start_call') {
            void session.start({ speaker: msg.speaker });
          } else if (msg.type === 'speech_start') {
            session.handleSpeechStart();
          } else if (msg.type === 'speech_end') {
            void session.handleSpeechEnd();
          } else if (msg.type === 'barge_in') {
            session.handleBargeIn();
          } else if (msg.type === 'user_text' && typeof msg.text === 'string') {
            void session.handleCallerUtterance(msg.text);
          } else if (msg.type === 'set_voice' && typeof msg.speaker === 'string') {
            session.setSpeaker(msg.speaker);
          } else if (msg.type === 'end_call') {
            session.end();
          }
        } catch (err) {
          console.error('Invalid WS message:', err);
        }
      });

      ws.on('close', () => session.end());
      ws.on('error', () => session.end());
    }
  });

  // ---------- REST API Routes ----------

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', capabilities: getPipelineCapabilities() });
  });

  app.get('/api/bootstrap', (_req, res) => {
    res.json({
      doctors: getDoctors(),
      slots: getSlots(),
      appointments: getAppointments(),
      callLogs: getCallLogs(),
      capabilities: getPipelineCapabilities(),
    });
  });

  app.get('/api/doctors', (req, res) => {
    const doctorName = typeof req.query.doctor === 'string' ? req.query.doctor : undefined;
    const specialty = typeof req.query.specialty === 'string' ? req.query.specialty : undefined;
    const date = typeof req.query.date === 'string' ? req.query.date : undefined;

    if (doctorName || specialty || date) {
      res.json(checkDoctorAvailability({ doctor_name: doctorName, specialty, date }));
      return;
    }
    res.json({ doctors: getDoctors(), slots: getSlots() });
  });

  app.get('/api/appointments', (_req, res) => {
    res.json({ appointments: getAppointments() });
  });

  app.post('/api/appointments', (req, res) => {
    const body = req.body as {
      phoneNumber?: string;
      doctorName?: string;
      date?: string;
      time?: string;
      patientName?: string;
      reason?: string;
    };

    if (!body.phoneNumber || !body.doctorName || !body.date || !body.time) {
      res.status(400).json({ error: 'phoneNumber, doctorName, date, and time are required.' });
      return;
    }

    const result = bookAppointment({
      phone_number: body.phoneNumber,
      doctor_name: body.doctorName,
      date: body.date,
      time: body.time,
      patient_name: body.patientName,
      reason: body.reason,
    });

    if (!result.success) {
      res.status(400).json({ error: result.error, openSlotsForDate: result.openSlotsForDate });
      return;
    }

    broadcastDashboard({
      type: 'appointments:changed',
      payload: { action: 'booked', appointment: result.appointment },
    });

    res.status(201).json({ appointment: result.appointment });
  });

  app.delete('/api/appointments/:id', (req, res) => {
    const id = req.params.id;
    const all = getAppointments();
    const target = all.find((a) => a.id === id);
    if (!target) {
      res.status(404).json({ error: 'Appointment not found.' });
      return;
    }

    const result = cancelAppointment({
      phone_number: target.phoneNumber,
      appointment_id: id,
    });

    if (!result.success) {
      res.status(400).json({ error: result.error });
      return;
    }

    broadcastDashboard({
      type: 'appointments:changed',
      payload: { action: 'cancelled', appointment: result.cancelledAppointment },
    });

    res.json({ appointment: result.cancelledAppointment });
  });

  app.get('/api/calls', (_req, res) => {
    res.json({ callLogs: getCallLogs() });
  });

  // ---------- Vite Dev Middleware / Production Static ----------

  if (process.env.NODE_ENV === 'production') {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Tara server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
