const API_BASE = import.meta.env.VITE_API_BASE || "/api";

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

export async function uploadCloneAudio(file: File): Promise<number> {
  const form = new FormData();
  form.append("file", file, file.name);
  const response = await fetch(`${API_BASE}/minimax/upload`, {
    method: "POST",
    credentials: "include",
    headers: createAuthHeaders(),
    body: form
  });
  if (!response.ok) {
    throw new Error(`Upload failed: ${response.status}`);
  }
  const data = await response.json();
  const fileId = Number(data?.fileId);
  if (!Number.isFinite(fileId)) {
    throw new Error("Missing fileId in upload response");
  }
  return fileId;
}

export async function cloneVoice(fileId: number, voiceId: string, previewText?: string): Promise<string> {
  const response = await fetch(`${API_BASE}/minimax/clone`, {
    method: "POST",
    credentials: "include",
    headers: createAuthHeaders({
      "Content-Type": "application/json"
    }),
    body: JSON.stringify({
      fileId,
      voiceId,
      previewText
    })
  });
  if (!response.ok) {
    throw new Error(`Clone failed: ${response.status}`);
  }
  const data = await response.json();
  return String(data?.voiceId || voiceId);
}

export async function synthesizeSpeech(text: string, voiceId: string): Promise<Blob> {
  const response = await fetch(`${API_BASE}/minimax/synthesize`, {
    method: "POST",
    credentials: "include",
    headers: createAuthHeaders({
      "Content-Type": "application/json"
    }),
    body: JSON.stringify({
      text,
      voiceId
    })
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`T2A failed: ${response.status} ${detail}`);
  }
  const bytes = await response.arrayBuffer();
  return new Blob([bytes], { type: response.headers.get("content-type") || "audio/mpeg" });
}
