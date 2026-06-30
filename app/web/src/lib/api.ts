import type { Bot, Rating, MatchResult } from "./types";

const API = "/api";

async function j<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json() as Promise<T>;
}

export const api = {
  health: () => j<{ ok: boolean; stockfish: string | null }>(`${API}/health`),
  bots: () => j<Bot[]>(`${API}/bots`),
  ratings: () => j<Rating[]>(`${API}/ratings`),
  matches: () => j<MatchResult[]>(`${API}/matches`),
  installCmd: () =>
    j<{ command: string; detected: string | null }>(`${API}/stockfish/install`),
  registerStockfish: () =>
    j<{ ok: boolean; name?: string; version?: string; error?: string }>(
      `${API}/engines/register-stockfish`,
      { method: "POST" }
    ),
};

export function wsURL(path: string): string {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}${path}`;
}
