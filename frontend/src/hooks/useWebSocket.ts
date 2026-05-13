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

export type WsRawMessage = SensorMessage | Record<string, unknown>;

export type WsMessageListener = (msg: WsRawMessage) => void;

interface UseWebSocketResult {
  lastMessage: WsRawMessage | null;
  status: WsStatus;
  /** Called for every inbound frame (avoids losing updates when React batches setLastMessage). */
  subscribeMessages: (listener: WsMessageListener) => () => void;
}

const BASE_DELAY_MS = 1_000;
const MAX_DELAY_MS = 30_000;

export function useWebSocket(): UseWebSocketResult {
  const [lastMessage, setLastMessage] = useState<WsRawMessage | null>(null);
  const [status, setStatus] = useState<WsStatus>("connecting");

  const wsRef = useRef<WebSocket | null>(null);
  const listenersRef = useRef(new Set<WsMessageListener>());
  const retryDelay = useRef(BASE_DELAY_MS);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmounted = useRef(false);

  const subscribeMessages = useCallback((listener: WsMessageListener) => {
    listenersRef.current.add(listener);
    return () => {
      listenersRef.current.delete(listener);
    };
  }, []);

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
        const msg = JSON.parse(evt.data as string) as WsRawMessage;
        listenersRef.current.forEach((fn) => {
          try {
            fn(msg);
          } catch {
            /* subscriber bug should not kill the socket */
          }
        });
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

  return { lastMessage, status, subscribeMessages };
}
