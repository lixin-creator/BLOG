const API_BASE = import.meta.env.VITE_API_BASE || "/api";
const MOSS_TTS_VOICE = import.meta.env.VITE_MOSS_TTS_VOICE as string | undefined;

const createAuthHeaders = (base?: HeadersInit) => {
  const headers = new Headers(base || {});
  if (typeof window === "undefined") return headers;
  try {
    const raw = window.localStorage.getItem("lx_current_user");
    if (!raw) return headers;
    const user = JSON.parse(raw);
    const username = String(user?.username || "").trim();
    const password = String(user?.password || "");
    if (!username || !password) return headers;
    headers.set("X-Auth-Username", username);
    headers.set("X-Auth-Password", password);
  } catch (_error) {
    // ignore invalid local cache
  }
  return headers;
};

export async function synthesizeMossSpeech(text: string): Promise<Blob> {
  const input = text.length > 1024 ? text.slice(0, 1024) : text;
  const voice = MOSS_TTS_VOICE?.trim() || "streamer_male";
  const response = await fetch(`${API_BASE}/tts`, {
    method: "POST",
    credentials: "include",
    headers: createAuthHeaders({
      "Content-Type": "application/json"
    }),
    body: JSON.stringify({
      input,
      voice
    })
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`TTS request failed: ${response.status} ${detail}`);
  }

  const buffer = await response.arrayBuffer();
  const rawType = response.headers.get("content-type") || "audio/wav";
  const type = rawType.startsWith("audio/") ? rawType : "audio/wav";
  return new Blob([buffer], { type });
}
