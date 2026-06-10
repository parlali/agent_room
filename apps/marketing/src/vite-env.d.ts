/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_ALLOWED_HOSTS?: string
    readonly VITE_WAITLIST_API_URL?: string
}

interface ImportMeta {
    readonly env: ImportMetaEnv
}
