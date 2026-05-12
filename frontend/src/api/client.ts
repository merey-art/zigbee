/**
 * API paths: use `/api/...` via nginx in Docker; Vite dev proxy strips `/api` for FastAPI.
 * If `VITE_API_URL` is set, requests go directly to that backend root (no `/api` prefix).
 */

export function apiPath(rest: string): string {
  const p = rest.startsWith("/") ? rest : `/${rest}`;
  const base = (import.meta.env.VITE_API_URL as string | undefined)?.trim();
  if (!base) {
    return `/api${p}`;
  }
  return `${base.replace(/\/$/, "")}${p}`;
}

export function wsUrl(): string {
  const base = (import.meta.env.VITE_WS_URL as string | undefined)?.trim();
  if (base) {
    const b = base.replace(/\/$/, "");
    return `${b}/ws`;
  }
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/ws`;
}

export function apiFetch(rest: string, init?: RequestInit): Promise<Response> {
  return fetch(apiPath(rest), {
    credentials: "include",
    ...init,
  });
}
