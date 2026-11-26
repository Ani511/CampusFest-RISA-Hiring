import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Primary Supabase configuration constants (kept in one config file)
export const SUPABASE_URL = 'https://uszaieusabkapksxnhfq.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_C6hAqDIP2564aLvsmWaUNA_fVjOtc5m';

const STORAGE_URL_KEY = 'campusfest_supabase_url';
const STORAGE_ANON_KEY = 'campusfest_supabase_anon_key';

export interface SupabaseConnectionState {
  client: SupabaseClient | null;
  url: string;
  anonKey: string;
  configError: string | null;
  isUsingOverride: boolean;
}

export function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function getActiveSupabaseCredentials(): {
  url: string;
  anonKey: string;
  isUsingOverride: boolean;
} {
  if (typeof window !== 'undefined') {
    const storedUrl = window.localStorage.getItem(STORAGE_URL_KEY)?.trim();
    const storedKey = window.localStorage.getItem(STORAGE_ANON_KEY)?.trim();
    if (storedUrl && storedKey) {
      return { url: storedUrl, anonKey: storedKey, isUsingOverride: true };
    }
  }

  return {
    url: SUPABASE_URL.trim(),
    anonKey: SUPABASE_ANON_KEY.trim(),
    isUsingOverride: false,
  };
}

export function saveSupabaseOverride(url: string, anonKey: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_URL_KEY, url.trim());
  window.localStorage.setItem(STORAGE_ANON_KEY, anonKey.trim());
}

export function clearSupabaseOverride(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(STORAGE_URL_KEY);
  window.localStorage.removeItem(STORAGE_ANON_KEY);
}

export function getSupabaseConnection(): SupabaseConnectionState {
  const { url, anonKey, isUsingOverride } = getActiveSupabaseCredentials();

  if (!isValidHttpUrl(url)) {
    const hint = url.startsWith('sb_publishable_')
      ? 'The configured SUPABASE_URL starts with "sb_publishable_", which is a Supabase publishable API key rather than a project URL (https://<project-ref>.supabase.co).'
      : 'SUPABASE_URL must be a valid HTTP or HTTPS Supabase project URL (https://<project-ref>.supabase.co).';

    return {
      client: null,
      url,
      anonKey,
      configError: hint,
      isUsingOverride,
    };
  }

  if (!anonKey) {
    return {
      client: null,
      url,
      anonKey,
      configError: 'SUPABASE_ANON_KEY is missing.',
      isUsingOverride,
    };
  }

  try {
    const client = createClient(url, anonKey);
    return {
      client,
      url,
      anonKey,
      configError: null,
      isUsingOverride,
    };
  } catch (err) {
    return {
      client: null,
      url,
      anonKey,
      configError: err instanceof Error ? err.message : 'Failed to initialize Supabase client.',
      isUsingOverride,
    };
  }
}
