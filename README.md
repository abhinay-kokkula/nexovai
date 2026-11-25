# Tara — Voice AI Doctor Appointment Assistant

Tara is a real-time voice appointment scheduling platform where callers speak naturally to book, check availability, or cancel doctor appointments—identified exclusively by the phone number spoken aloud during the call—with live synchronization to the clinical operations dashboard.

## Architecture Overview

1. **Voice Pipeline (`Caller Audio -> VAD -> STT -> Gemini LLM -> Tools -> Sarvam TTS -> Caller Audio`)**
   - **Speech-to-Text (STT):** Deepgram Nova-3 live streaming WebSocket (`wss://api.deepgram.com/v1/listen`), with automatic fallback to Sarvam Saaras v4 / Gemini 3.5 Transcribe when `DEEPGRAM_API_KEY` is omitted.
   - **LLM & Function Calling:** Google Gemini (`gemini-4-hydrogen` primary with `gemini-3.5-flash-lite` fallback via `@google/genai`) with three core tools:
     - `check_doctor_availability`: Queries open slots by doctor, specialty, or date.
     - `book_appointment`: Reserves a slot after reading back and confirming the caller's spoken phone number.
     - `cancel_appointment`: Cancels an active appointment matched by the confirmed spoken phone number.
   - **Text-to-Speech (TTS):** Sarvam AI Bulbul v3 (`https://api.sarvam.ai/text-to-speech`, `en-IN` / `hi-IN` speakers `ritu` and `shubh`), with Gemini 3.8 Flash-Lite and Flash TTS fallback.
   - **Voice Activity Detection & Barge-In:** Client-side Web Audio RMS VAD + pre-roll buffering enables natural interruptions mid-utterance.

2. **Frontend Dashboard & Phone Handset (`React + TypeScript + Tailwind CSS`)**
   - **Phone Call Screen (`Try Call`):** Realistic handset interface with ringing, connected timer, live audio waveform, mute/speaker/end-call controls, in-call confirmation card, and live transcript.
   - **Doctors & Available Slots:** Live searchable directory by specialty and date; newly booked or freed slots highlight automatically.
   - **Appointments Ledger:** Live table persisted in SQLite (`meridian_clinic.db`) that highlights rows whenever the voice agent books or cancels.

3. **Optional Pipecat Python Pipeline (`/voice-agent-pipecat`)**
   - Includes a standalone Pipecat reference agent (`bot.py`) wired with `SileroVADAnalyzer`, `DeepgramSTTService`, `GoogleLLMService`, and `SarvamTTSService` calling the clinic REST endpoints.

## Running Locally

### 1. Full-Stack Web App & Real-Time Voice Server (Port 3000)

```bash
npm install
cp .env.example .env
# Add GEMINI_API_KEY to .env; DEEPGRAM_API_KEY and SARVAM_API_KEY are optional
npm run dev
```

Open `http://localhost:3000` and click **Talk to Tara**. Add `GEMINI_API_KEY` to the project root `.env` file to enable voice calls. `DEEPGRAM_API_KEY` and `SARVAM_API_KEY` are optional and enable their respective speech services. Restart the dev server after changing `.env`; keep the secret values private and out of source control.

### 2. Pipecat Python Agent (Optional)

```bash
cd voice-agent-pipecat
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```
