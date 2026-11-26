import React, { useState } from 'react';
import {
  clearSupabaseOverride,
  isValidHttpUrl,
  saveSupabaseOverride,
  SUPABASE_ANON_KEY,
  SUPABASE_URL,
} from '../config/supabase';

interface ConfigErrorBannerProps {
  errorMessage: string;
  currentUrl: string;
  currentKey: string;
  isUsingOverride: boolean;
  onRetry: () => void;
}

export const ConfigErrorBanner: React.FC<ConfigErrorBannerProps> = ({
  errorMessage,
  currentUrl,
  currentKey,
  isUsingOverride,
  onRetry,
}) => {
  const [urlInput, setUrlInput] = useState(
    isValidHttpUrl(currentUrl) ? currentUrl : ''
  );
  const [keyInput, setKeyInput] = useState(
    currentKey === SUPABASE_ANON_KEY && SUPABASE_URL.startsWith('sb_publishable_')
      ? SUPABASE_URL
      : currentKey
  );
  const [formError, setFormError] = useState<string | null>(null);

  const handleApply = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValidHttpUrl(urlInput)) {
      setFormError('Enter a valid Supabase project URL starting with https://');
      return;
    }
    if (!keyInput.trim()) {
      setFormError('Enter a Supabase anon or publishable key.');
      return;
    }
    setFormError(null);
    saveSupabaseOverride(urlInput, keyInput);
    onRetry();
  };

  const handleReset = () => {
    clearSupabaseOverride();
    onRetry();
  };

  return (
    <div className="max-w-2xl my-8 calm-card p-6 space-y-4">
      <div className="space-y-2">
        <h2 className="font-display text-xl font-bold text-[#1F1B16]">
          Couldn't reach the database. Check your connection and try again.
        </h2>
        <p className="text-sm text-[#D6453D] leading-relaxed bg-[#FDF2F2] p-3 rounded-lg border border-[#D6453D]">{errorMessage}</p>
        <p className="text-[13px] text-[#6C757D] break-all">
          Configured URL: {currentUrl || '(empty)'}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onRetry}
          className="calm-btn-primary text-sm"
        >
          Try again
        </button>
        {isUsingOverride && (
          <button
            type="button"
            onClick={handleReset}
            className="calm-btn-secondary text-sm"
          >
            Reset to file config
          </button>
        )}
      </div>

      <form
        onSubmit={handleApply}
        className="pt-5 border-t border-[#DDD5C4] space-y-4"
      >
        <p className="text-sm font-semibold text-[#4F4A3F]">
          Or update connection settings for this browser session:
        </p>

        <div className="space-y-3">
          <div>
            <label
              htmlFor="supabase-url-override"
              className="block text-sm font-medium text-[#4F4A3F] mb-1.5"
            >
              Supabase project URL
            </label>
            <input
              id="supabase-url-override"
              type="url"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="https://your-project-ref.supabase.co"
              className="w-full px-3 py-2 text-sm bg-white border border-[#DDD5C4] rounded-lg text-[#1F1B16]"
            />
          </div>

          <div>
            <label
              htmlFor="supabase-key-override"
              className="block text-sm font-medium text-[#4F4A3F] mb-1.5"
            >
              Supabase publishable or anon key
            </label>
            <input
              id="supabase-key-override"
              type="text"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder="sb_publishable_... or eyJ..."
              className="w-full px-3 py-2 text-sm bg-white border border-[#DDD5C4] rounded-lg text-[#1F1B16]"
            />
          </div>
        </div>

        {formError && (
          <p role="alert" className="text-sm text-[#D6453D] font-semibold">
            {formError}
          </p>
        )}

        <button
          type="submit"
          className="calm-btn-secondary text-sm"
        >
          Save connection and retry
        </button>
      </form>
    </div>
  );
};
