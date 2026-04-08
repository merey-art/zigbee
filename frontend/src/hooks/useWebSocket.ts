/**
 * useWebSocket
 *
 * Connects to the backend WebSocket endpoint and returns the latest message.
 * Automatically reconnects with exponential back-off on disconnect.
 */

import { useEffect, useRef, useState, useCallback } from "react";

export type WsStatus = "connecting" | "open" | "closed" | "error";

export interface SensorMessage {
  device_id: string;
  topic: string;
  data: Record<string, number>;
  timestamp: string;
}

interface UseWebSocketResult {
  lastMessage: SensorMessage | null;
  status: WsStatus;
}

const WS_URL =
  (import.meta as unknown as { env: Record<string, string> }).env.VITE_WS_URL ??
  "ws://localhost:8000";

const BASE_DELAY_MS = 1_000;
const MAX_DELAY_MS = 30_000;

export function useWebSocket(): UseWebSocketResult {
  const [lastMessage, setLastMessage] = useState<SensorMessage | null>(null);
  const [status, setStatus] = useState<WsStatus>("connecting");

  const wsRef = useRef<WebSocket | null>(null);
  const retryDelay = useRef(BASE_DELAY_MS);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmounted = useRef(false);

  const connect = useCallback(() => {
    if (unmounted.current) return;
    setStatus("connecting");

    const ws = new WebSocket(`${WS_URL}/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      if (unmounted.current) { ws.close(); return; }
      setStatus("open");
      retryDelay.current = BASE_DELAY_MS; // reset back-off on success
    };

    ws.onmessage = (evt) => {
      try {
        const msg: SensorMessage = JSON.parse(evt.data as string);
        setLastMessage(msg);
      } catch {
        // ignore malformed frames
      }
    };

    ws.onerror = () => {
      setStatus("error");
    };

    ws.onclose = () => {
      if (unmounted.current) return;
      setStatus("closed");
      // Exponential back-off reconnect
      retryTimer.current = setTimeout(() => {
        retryDelay.current = Math.min(retryDelay.current * 2, MAX_DELAY_MS);
        connect();
      }, retryDelay.current);
    };
  }, []);

  useEffect(() => {
    unmounted.current = false;
    connect();
    return () => {
      unmounted.current = true;
      if (retryTimer.current) clearTimeout(retryTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  return { lastMessage, status };
}
