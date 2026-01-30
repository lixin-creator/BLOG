const ZHIPU_API_KEY = import.meta.env.VITE_ZHIPU_API_KEY as string | undefined;
const API_URL = "https://open.bigmodel.cn/api/paas/v4/audio/speech";
const VOICE_LIST_URL = "https://open.bigmodel.cn/api/paas/v4/voice/list";
const MOSS_TTS_VOICE = import.meta.env.VITE_MOSS_TTS_VOICE as string | undefined;

let cachedVoice: string | null = null;

type VoiceListItem = {
  voice: string;
  voice_name?: string;
  voice_type?: string;
};

async function resolveMossVoice(): Promise<string> {
  if (MOSS_TTS_VOICE && MOSS_TTS_VOICE.trim()) {
    cachedVoice = MOSS_TTS_VOICE.trim();
    return cachedVoice;
  }
  if (cachedVoice) return cachedVoice;

  const fetchVoices = async (voiceName?: string) => {
    const url = new URL(VOICE_LIST_URL);
    url.searchParams.set("voiceType", "OFFICIAL");
    if (voiceName) url.searchParams.set("voiceName", voiceName);
    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${ZHIPU_API_KEY ?? ""}`
      }
    });
    if (!response.ok) return [] as VoiceListItem[];
    const data = await response.json();
    return Array.isArray(data?.voice_list) ? data.voice_list : [];
  };

  const list =
    (await fetchVoices("男")) ||
    (await fetchVoices("男声")) ||
    (await fetchVoices("男性")) ||
    (await fetchVoices("磁性")) ||
    (await fetchVoices("金属")) ||
    (await fetchVoices("机械")) ||
    (await fetchVoices());

  if (import.meta.env.DEV) {
    const info = list
      .map(v => ({ voice: v.voice, name: v.voice_name, type: v.voice_type }))
      .filter(v => v.voice || v.name);
    if (info.length) {
      console.info("MOSS official voice list:", info);
    }
  }

  const standardMale = list.find(item => (item.voice_name || "").includes("标准男声"));
  if (standardMale?.voice) {
    cachedVoice = standardMale.voice;
    return cachedVoice;
  }

  const metallicKeywords = ["金属", "机械", "机甲", "机器人"];
  const maleKeywords = ["男", "男性", "男声"];

  const pickByKeywords = (needMetallic: boolean) => {
    return list.find(item => {
      const name = (item.voice_name || "").trim();
      if (!name) return false;
      const isMale = maleKeywords.some(k => name.includes(k));
      const isMetallic = metallicKeywords.some(k => name.includes(k));
      return isMale && (!needMetallic || isMetallic);
    });
  };

  const metallicMale = pickByKeywords(true);
  if (metallicMale?.voice) {
    cachedVoice = metallicMale.voice;
    return cachedVoice;
  }

  const maleOnly = pickByKeywords(false);
  if (maleOnly?.voice) {
    cachedVoice = maleOnly.voice;
    return cachedVoice;
  }

  cachedVoice = "tongtong";
  return cachedVoice;
}

export async function synthesizeMossSpeech(text: string): Promise<Blob> {
  if (!ZHIPU_API_KEY) {
    throw new Error("Missing ZHIPU API key");
  }

  const input = text.length > 1024 ? text.slice(0, 1024) : text;
  const voice = await resolveMossVoice();
  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${ZHIPU_API_KEY}`
    },
    body: JSON.stringify({
      model: "glm-tts",
      input,
      voice
    })
  });

  if (!response.ok) {
    throw new Error(`TTS request failed: ${response.status}`);
  }

  return response.blob();
}
