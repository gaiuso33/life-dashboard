/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_SYNC_MIN_GAP_MS?: string;
  readonly VITE_VAPID_PUBLIC_KEY?: string;
}
