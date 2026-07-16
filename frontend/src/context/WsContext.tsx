import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import {
  useWebSocket,
  type SensorMessage,
  type WsStatus,
  type WsMessageListener,
} from "../hooks/useWebSocket";

export interface BridgeEventMessage {
  type: "bridge_event";
  payload: unknown;
  timestamp: string;
}

export interface EmergencyMessage {
  type: "emergency";
  status: "active" | "acknowledged" | "cleared";
  event_id: number;
  key: string;
  device_id: string | null;
  temp_device_id: string | null;
  co2_device_id: string | null;
  zone_id: string | null;
  temperature: number;
  co2: number;
  temperature_rate: number;
  co2_rate: number;
  consecutive_readings: number;
  started_at: string;
  last_seen_at: string;
  acknowledged_at: string | null;
  cleared_at: string | null;
}

export type WsMessage = SensorMessage | BridgeEventMessage | EmergencyMessage | Record<string, unknown>;

const WS_LOG_CAP = 500;

interface WsState {
  lastMessage: WsMessage | null;
  status: WsStatus;
  recentMessages: WsMessage[];
  clearRecentMessages: () => void;
  subscribeMessages: (listener: WsMessageListener) => () => void;
}

const WsContext = createContext<WsState | null>(null);

/** Single dashboard WebSocket shared by Dashboard and Devices pages. */
export function WsProvider({ children }: { children: React.ReactNode }) {
  const { lastMessage, status, subscribeMessages } = useWebSocket();
  const [recentMessages, setRecentMessages] = useState<WsMessage[]>([]);

  useEffect(() => {
    return subscribeMessages((raw) => {
      const msg = raw as WsMessage;
      setRecentMessages((prev) => {
        const next = [...prev, msg];
        return next.length > WS_LOG_CAP ? next.slice(-WS_LOG_CAP) : next;
      });
    });
  }, [subscribeMessages]);

  const clearRecentMessages = useCallback(() => {
    setRecentMessages([]);
  }, []);

  return (
    <WsContext.Provider
      value={{
        lastMessage: lastMessage as WsMessage | null,
        status,
        recentMessages,
        clearRecentMessages,
        subscribeMessages,
      }}
    >
      {children}
    </WsContext.Provider>
  );
}

export function useDashboardWs(): WsState {
  const ctx = useContext(WsContext);
  if (!ctx) {
    throw new Error("useDashboardWs must be used within WsProvider");
  }
  return ctx;
}

export function isBridgeEvent(msg: WsMessage | null): msg is BridgeEventMessage {
  return msg !== null && typeof msg === "object" && (msg as BridgeEventMessage).type === "bridge_event";
}

export function isEmergencyMessage(msg: WsMessage | null): msg is EmergencyMessage {
  return msg !== null && typeof msg === "object" && (msg as EmergencyMessage).type === "emergency";
}

export function isSensorMessage(msg: WsMessage | null): msg is SensorMessage {
  if (!msg || typeof msg !== "object") return false;
  if ("type" in msg) {
    const type = (msg as { type?: string }).type;
    if (type === "bridge_event" || type === "emergency") return false;
  }
  return typeof (msg as SensorMessage).device_id === "string";
}
