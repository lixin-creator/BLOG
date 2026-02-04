const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:3001/api";
const MOSS_TTS_VOICE = import.meta.env.VITE_MOSS_TTS_VOICE as string | undefined;

export async function synthesizeMossSpeech(text: string): Promise<Blob> {
  const input = text.length > 1024 ? text.slice(0, 1024) : text;
  const voice = MOSS_TTS_VOICE?.trim() || "streamer_male";
  const response = await fetch(`${API_BASE}/tts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
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
