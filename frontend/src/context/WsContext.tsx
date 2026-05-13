import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useWebSocket, type SensorMessage, type WsStatus } from "../hooks/useWebSocket";

export interface BridgeEventMessage {
  type: "bridge_event";
  payload: unknown;
  timestamp: string;
}

export type WsMessage = SensorMessage | BridgeEventMessage | Record<string, unknown>;

const WS_LOG_CAP = 500;

interface WsState {
  lastMessage: WsMessage | null;
  status: WsStatus;
  recentMessages: WsMessage[];
  clearRecentMessages: () => void;
}

const WsContext = createContext<WsState | null>(null);

/** Single dashboard WebSocket shared by Dashboard and Devices pages. */
export function WsProvider({ children }: { children: React.ReactNode }) {
  const { lastMessage, status } = useWebSocket();
  const [recentMessages, setRecentMessages] = useState<WsMessage[]>([]);

  useEffect(() => {
    if (lastMessage === null) return;
    setRecentMessages((prev) => {
      const msg = lastMessage as WsMessage;
      const next = [...prev, msg];
      return next.length > WS_LOG_CAP ? next.slice(-WS_LOG_CAP) : next;
    });
  }, [lastMessage]);

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

export function isSensorMessage(msg: WsMessage | null): msg is SensorMessage {
  if (!msg || typeof msg !== "object") return false;
  if ("type" in msg && (msg as { type?: string }).type === "bridge_event") return false;
  return typeof (msg as SensorMessage).device_id === "string";
}
