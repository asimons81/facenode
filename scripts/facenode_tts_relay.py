#!/usr/bin/env python3
"""
FaceNode TTS Relay — standalone companion process.

Run this BEFORE starting Hermes in voice mode:
    python3 facenode_tts_relay.py

Two listeners:
  - HTTP server :3459  ← Hermes POSTs here when TTS fires
  - WebSocket   :3456  ← FaceNode connects here to receive avatar events

Event flow:
    Hermes TTS fires
      → POST /speech_start {"audioUrl": "http://localhost:3459/..."}
      → Standalone relay serves audio file AND broadcasts {type:"speech_start", audioUrl:"..."} to all WS clients
      → FaceNode (browser) receives event, loads audio URL, animates avatar

Usage:
    python3 facenode_tts_relay.py

FaceNode dashboard WebSocket URL: ws://localhost:3456
"""

import argparse
import asyncio
import json
import os
import shutil
import threading
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from typing import Optional

import websockets

TTS_DIR = Path.home() / ".facenode" / "tts"
WS_PORT = 3456
HTTP_PORT = 3459


class RelayServer:
    """
    Dual-role relay:
      - HTTP server (port HTTP_PORT): receives events from Hermes
      - WebSocket server (port WS_PORT): broadcasts events to all connected FaceNode clients
    """

    def __init__(self):
        self.ws_port = WS_PORT
        self.http_port = HTTP_PORT
        self._ws_clients: set[websockets.WebSocketServerProtocol] = set()
        self._ws_server: Optional[websockets.WebSocketServer] = None
        self._http_running = True
        self._http_thread: Optional[threading.Thread] = None

        TTS_DIR.mkdir(parents=True, exist_ok=True)

    # ── HTTP server ────────────────────────────────────────────────────────────

    def _http_handler_class(self):
        parent = self

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                content_length = int(self.headers.get("Content-Length", 0) or 0)
                body = self.rfile.read(content_length) if content_length else b"{}"
                try:
                    payload = json.loads(body)
                    event_type = payload.get("type", "?")
                    print(f"[Relay] HTTP POST → {event_type}")
                    # Broadcast to all connected FaceNode clients
                    asyncio.run(parent._broadcast(payload))
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                    self.end_headers()
                    self.wfile.write(b'{"ok":true}')
                except Exception as e:
                    print(f"[Relay] HTTP error: {e}")
                    self.send_response(500)
                    self.end_headers()

            def do_GET(self):
                # Serve ~/.facenode/tts/ audio files
                if ".." in self.path:
                    self.send_response(403)
                    self.end_headers()
                    return
                filename = self.path.lstrip("/")
                if not filename:
                    self.send_response(400)
                    self.end_headers()
                    return
                filepath = TTS_DIR / filename
                if not filepath.is_file():
                    print(f"[Relay] GET 404: {filename}")
                    self.send_response(404)
                    self.end_headers()
                    return
                with open(filepath, "rb") as f:
                    data = f.read()
                print(f"[Relay] GET 200: {filename} ({len(data)} bytes)")
                self.send_response(200)
                self.send_header("Content-Type", "audio/mpeg")
                self.send_header("Content-Length", str(len(data)))
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(data)

            def log_message(self, fmt, *args):
                pass  # quiet

        return Handler

    def _run_http(self) -> None:
        handler = self._http_handler_class()
        with HTTPServer(("127.0.0.1", self.http_port), handler) as srv:
            print(f"[Relay] HTTP server  → http://127.0.0.1:{self.http_port}")
            print(f"[Relay] Audio dir   → {TTS_DIR}")
            while self._http_running:
                srv.handle_request()

    def start_http(self) -> None:
        self._http_thread = threading.Thread(target=self._run_http, daemon=True)
        self._http_thread.start()

    def stop_http(self) -> None:
        self._http_running = False

    # ── WebSocket server ──────────────────────────────────────────────────────

    async def _ws_handler(
        self,
        ws: websockets.WebSocketServerProtocol,
        path: str,
    ) -> None:
        self._ws_clients.add(ws)
        print(f"[Relay] WS client connected (total={len(self._ws_clients)})")
        # Send 'connected' so avatar transitions from 'disconnected' → 'idle'
        await ws.send(json.dumps({"type": "connected"}))
        try:
            await ws.wait_closed()
        finally:
            self._ws_clients.discard(ws)
            print(f"[Relay] WS client disconnected (total={len(self._ws_clients)})")

    async def _broadcast(self, payload: dict) -> None:
        if not self._ws_clients:
            return
        msg = json.dumps(payload)
        await asyncio.gather(
            *(client.send(msg) for client in self._ws_clients),
            return_exceptions=True,
        )

    async def _run_ws(self) -> None:
        async with websockets.serve(self._ws_handler, "127.0.0.1", self.ws_port):
            print(f"[Relay] WebSocket   → ws://127.0.0.1:{self.ws_port}")
            print(f"[Relay] ─── Ready ───")
            await asyncio.Future()  # run forever

    def run(self) -> None:
        self.start_http()
        try:
            asyncio.run(self._run_ws())
        except KeyboardInterrupt:
            print("[Relay] Shutdown")
        finally:
            self.stop_http()

    @classmethod
    def main(cls) -> None:
        parser = argparse.ArgumentParser(description="FaceNode TTS Relay")
        parser.add_argument(
            "--http-port", type=int, default=HTTP_PORT,
            help=f"HTTP port for Hermes to POST to (default: {HTTP_PORT})",
        )
        parser.add_argument(
            "--ws-port", type=int, default=WS_PORT,
            help=f"WebSocket port for FaceNode to connect to (default: {WS_PORT})",
        )
        args = parser.parse_args()

        relay = cls()
        relay.http_port = args.http_port
        relay.ws_port = args.ws_port
        relay.run()


if __name__ == "__main__":
    RelayServer.main()
