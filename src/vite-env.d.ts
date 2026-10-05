/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DA_CLIENT_ID: string;
  readonly VITE_DA_REDIRECT_URI: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
