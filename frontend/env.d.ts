/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE?: string;
  readonly VITE_ZHIPU_API_KEY?: string;
  readonly VITE_MOSS_TTS_VOICE?: string;
  readonly VITE_MINIMAX_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
