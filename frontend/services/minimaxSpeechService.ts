const MINIMAX_API_KEY = import.meta.env.VITE_MINIMAX_API_KEY as string | undefined;
const API_BASE = "https://api.minimax.io/v1";

function ensureApiKey(): string {
  if (!MINIMAX_API_KEY) {
    throw new Error("Missing MiniMax API key");
  }
  return MINIMAX_API_KEY;
}

export async function uploadCloneAudio(file: File): Promise<number> {
  const apiKey = ensureApiKey();
  const form = new FormData();
  form.append("purpose", "voice_clone");
  form.append("file", file, file.name);

  const response = await fetch(`${API_BASE}/files/upload`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`
    },
    body: form
  });

  if (!response.ok) {
    throw new Error(`Upload failed: ${response.status}`);
  }

  const data = await response.json();
  const fileId = data?.file?.file_id;
  if (!fileId) {
    throw new Error("Missing file_id in upload response");
  }

  return Number(fileId);
}

export async function cloneVoice(fileId: number, voiceId: string, previewText?: string): Promise<string> {
  const apiKey = ensureApiKey();
  const response = await fetch(`${API_BASE}/voice_clone`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      file_id: fileId,
      voice_id: voiceId,
      model: "speech-2.8-hd",
      text: previewText,
      need_noise_reduction: true,
      need_volumn_normalization: true,
      continuous_sound: false
    })
  });

  if (!response.ok) {
    throw new Error(`Clone failed: ${response.status}`);
  }

  const data = await response.json();
  if (data?.base_resp?.status_code !== 0) {
    throw new Error(data?.base_resp?.status_msg || "Clone failed");
  }

  return voiceId;
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const len = clean.length;
  const buffer = new ArrayBuffer(len / 2);
  const out = new Uint8Array(buffer);
  for (let i = 0; i < len; i += 2) {
    out[i / 2] = parseInt(clean.slice(i, i + 2), 16);
  }
  return out;
}

export async function synthesizeSpeech(text: string, voiceId: string): Promise<Blob> {
  const apiKey = ensureApiKey();
  const input = text.length > 10000 ? text.slice(0, 10000) : text;
  const response = await fetch(`${API_BASE}/t2a_v2`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "speech-2.8-hd",
      text: input,
      stream: false,
      output_format: "hex",
      voice_setting: {
        voice_id: voiceId,
        speed: 1,
        vol: 1,
        pitch: 0
      },
      audio_setting: {
        sample_rate: 32000,
        bitrate: 128000,
        format: "mp3",
        channel: 1
      }
    })
  });

  if (!response.ok) {
    throw new Error(`T2A failed: ${response.status}`);
  }

  const data = await response.json();
  const hexAudio = data?.data?.audio as string | undefined;
  if (!hexAudio) {
    throw new Error("Missing audio data");
  }
  const bytes = hexToBytes(hexAudio);
  const safeBuffer = bytes.buffer.slice(0) as ArrayBuffer;
  const safeBytes = new Uint8Array(safeBuffer);
  return new Blob([safeBytes], { type: "audio/mpeg" });
}
