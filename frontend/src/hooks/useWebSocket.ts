/**
 * useWebSocket
 *
 * Connects to the backend WebSocket endpoint and returns the latest message.
 * Automatically reconnects with exponential back-off on disconnect.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { wsUrl } from "../api/client";

export type WsStatus = "connecting" | "open" | "closed" | "error";

export interface SensorMessage {
  device_id: string;
  topic: string;
  data: Record<string, number>;
  timestamp: string;
}

interface UseWebSocketResult {
  lastMessage: SensorMessage | Record<string, unknown> | null;
  status: WsStatus;
}

const BASE_DELAY_MS = 1_000;
const MAX_DELAY_MS = 30_000;

export function useWebSocket(): UseWebSocketResult {
  const [lastMessage, setLastMessage] = useState<SensorMessage | Record<string, unknown> | null>(
    null
  );
  const [status, setStatus] = useState<WsStatus>("connecting");

  const wsRef = useRef<WebSocket | null>(null);
  const retryDelay = useRef(BASE_DELAY_MS);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmounted = useRef(false);

  const connect = useCallback(() => {
    if (unmounted.current) return;
    setStatus("connecting");

    const ws = new WebSocket(wsUrl());
    wsRef.current = ws;

    ws.onopen = () => {
      if (unmounted.current) {
        ws.close();
        return;
      }
      setStatus("open");
      retryDelay.current = BASE_DELAY_MS;
    };

    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data as string) as SensorMessage | Record<string, unknown>;
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
