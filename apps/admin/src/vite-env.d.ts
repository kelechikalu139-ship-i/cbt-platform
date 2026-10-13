/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string
  readonly VITE_USE_MOCK: string
  readonly VITE_APP_NAME: string
  readonly VITE_INSTALLATION_ID: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
