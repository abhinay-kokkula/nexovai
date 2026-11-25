"""
Meridian Clinic — Pipecat Real-Time Voice Agent (Python)
Pipeline: WebRTC/WebSocket Audio + Silero VAD -> Deepgram Nova-3 STT -> Gemini LLM (Function Calling) -> Sarvam AI Bulbul v3 TTS
"""

import os
import json
import httpx
from datetime import date, timedelta
from dotenv import load_dotenv

from pipecat.frames.frames import LLMMessagesFrame
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.runner import PipelineRunner
from pipecat.pipeline.task import PipelineParams, PipelineTask
from pipecat.processors.aggregators.openai_llm_context import OpenAILLMContext
from pipecat.services.deepgram.stt import DeepgramSTTService
from pipecat.services.google.llm import GoogleLLMService
from pipecat.services.sarvam.tts import SarvamTTSService
from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.transports.network.small_webrtc import SmallWebRTCTransport
from pipecat.transports.base_transport import TransportParams

load_dotenv()

BACKEND_BASE_URL = os.getenv("CLINIC_BACKEND_URL", "http://localhost:3000")


async def check_doctor_availability(params):
    """Tool: Returns available slots for a doctor and/or date."""
    args = params.arguments
    query = {}
    if args.get("doctor_name"):
        query["doctor"] = args["doctor_name"]
    if args.get("specialty"):
        query["specialty"] = args["specialty"]
    if args.get("date"):
        query["date"] = args["date"]

    async with httpx.AsyncClient() as client:
        resp = await client.get(f"{BACKEND_BASE_URL}/api/doctors", params=query, timeout=10.0)
        await params.result_callback(resp.json())


async def book_appointment(params):
    """Tool: Books a slot using the phone number spoken and confirmed by the caller."""
    args = params.arguments
    payload = {
        "phoneNumber": args.get("phone_number"),
        "doctorName": args.get("doctor_name"),
        "date": args.get("date"),
        "time": args.get("time"),
        "patientName": args.get("patient_name", "Voice Caller"),
        "reason": args.get("reason", "General consultation"),
    }
    async with httpx.AsyncClient() as client:
        resp = await client.post(f"{BACKEND_BASE_URL}/api/appointments", json=payload, timeout=10.0)
        await params.result_callback(resp.json())


async def cancel_appointment(params):
    """Tool: Cancels an existing appointment using the caller's spoken phone number."""
    args = params.arguments
    phone = args.get("phone_number", "")
    digits = "".join(ch for ch in phone if ch.isdigit())[-10:]

    async with httpx.AsyncClient() as client:
        apts_resp = await client.get(f"{BACKEND_BASE_URL}/api/appointments", timeout=10.0)
        apts = apts_resp.json().get("appointments", [])
        match = next(
            (a for a in apts if a["status"] == "Confirmed" and a["phoneNormalized"] == digits),
            None,
        )
        if not match:
            await params.result_callback({"success": False, "error": "No active appointment found for that phone number."})
            return

        del_resp = await client.delete(f"{BACKEND_BASE_URL}/api/appointments/{match['id']}", timeout=10.0)
        await params.result_callback(del_resp.json())


TOOLS = [
    {
        "function_declarations": [
            {
                "name": "check_doctor_availability",
                "description": "Returns the available slots for a doctor, specialty, and/or date.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "doctor_name": {"type": "string"},
                        "specialty": {"type": "string"},
                        "date": {"type": "string", "description": "YYYY-MM-DD, today, or tomorrow"},
                    },
                },
            },
            {
                "name": "book_appointment",
                "description": "Books a selected slot for the caller using their spoken phone number.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "phone_number": {"type": "string"},
                        "doctor_name": {"type": "string"},
                        "date": {"type": "string"},
                        "time": {"type": "string"},
                        "patient_name": {"type": "string"},
                        "reason": {"type": "string"},
                    },
                    "required": ["phone_number", "doctor_name", "date", "time"],
                },
            },
            {
                "name": "cancel_appointment",
                "description": "Cancels the caller's existing appointment using the phone number they spoke.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "phone_number": {"type": "string"},
                    },
                    "required": ["phone_number"],
                },
            },
        ]
    }
]


async def run_bot(webrtc_connection):
    today = date.today().isoformat()
    tomorrow = (date.today() + timedelta(days=1)).isoformat()

    transport = SmallWebRTCTransport(
        webrtc_connection=webrtc_connection,
        params=TransportParams(
            audio_in_enabled=True,
            audio_out_enabled=True,
            vad_enabled=True,
            vad_analyzer=SileroVADAnalyzer(),
        ),
    )

    stt = DeepgramSTTService(
        api_key=os.environ["DEEPGRAM_API_KEY"],
        model="nova-3",
        language="en-IN",
    )

    llm = GoogleLLMService(
        api_key=os.environ["GEMINI_API_KEY"],
        model="gemini-3.1-flash-lite",
        tools=TOOLS,
    )
    llm.register_function("check_doctor_availability", check_doctor_availability)
    llm.register_function("book_appointment", book_appointment)
    llm.register_function("cancel_appointment", cancel_appointment)

    tts = SarvamTTSService(
        api_key=os.environ["SARVAM_API_KEY"],
        model="bulbul:v3",
        voice_id="ritu",
        language_code="en-IN",
    )

    system_prompt = (
        f"You are Tara, the front-desk voice assistant at Tara. "
        f"Today is {today}, tomorrow is {tomorrow}. "
        "Identify callers ONLY by the phone number they speak out loud. "
        "Always read the phone number back clearly to confirm before calling book_appointment or cancel_appointment. "
        "Keep spoken responses concise and natural."
    )

    context = OpenAILLMContext(messages=[{"role": "system", "content": system_prompt}])
    context_aggregator = llm.create_context_aggregator(context)

    pipeline = Pipeline(
        [
            transport.input(),
            stt,
            context_aggregator.user(),
            llm,
            tts,
            transport.output(),
            context_aggregator.assistant(),
        ]
    )

    task = PipelineTask(pipeline, params=PipelineParams(allow_interruptions=True))
    runner = PipelineRunner()
    await runner.run(task)
