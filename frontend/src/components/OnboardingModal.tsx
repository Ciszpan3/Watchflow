import React from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Heart,
  History,
  ListVideo,
  Sparkles,
  ThumbsUp,
  Users,
  X
} from "lucide-react";
import { interestOptions } from "../viewerData";
import type { LanguageCode, SourceMode, VideoFormat, ViewerProfile, ViewerSignalsSummary } from "../viewerTypes";

const languageOptions: { value: LanguageCode; label: string }[] = [
  { value: "en", label: "English" },
  { value: "pl", label: "Polish" }
];

const formatOptions: { value: VideoFormat; label: string; note: string }[] = [
  { value: "standard", label: "Standard videos", note: "Focused, regular uploads" },
  { value: "short", label: "Shorts", note: "Quick ideas and breaks" },
  { value: "live", label: "Live", note: "Current and participatory" },
  { value: "podcast", label: "Podcasts", note: "Long conversations" }
];

const sourceOptions: { value: SourceMode; label: string; note: string }[] = [
  { value: "subscribed", label: "Subscriptions", note: "Stay with channels you know" },
  { value: "mixed", label: "Balanced mix", note: "Trusted channels plus discovery" },
  { value: "new", label: "New creators", note: "Explore outside your bubble" }
];

function toggleValue<T extends string>(values: T[], value: T) {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

function TagInput({ label, placeholder, values, onChange }: {
  label: string;
  placeholder: string;
  values: string[];
  onChange: (values: string[]) => void;
}) {
  const [value, setValue] = React.useState("");

  function addValue() {
    const normalized = value.trim().toLowerCase();
    if (!normalized || values.includes(normalized)) return;
    onChange([...values, normalized]);
    setValue("");
  }

  return (
    <label className="tag-input">
      <span>{label}</span>
      <div>
        {values.map((item) => <button key={item} type="button" onClick={() => onChange(values.filter((valueItem) => valueItem !== item))}>{item}<X /></button>)}
        <input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === ",") {
              event.preventDefault();
              addValue();
            }
          }}
          onBlur={addValue}
          placeholder={values.length ? "Add another" : placeholder}
        />
      </div>
    </label>
  );
}

export function OnboardingModal({ open, profile, signals, editing, onProgress, onComplete, onSkip, onClose }: {
  open: boolean;
  profile: ViewerProfile;
  signals: ViewerSignalsSummary;
  editing: boolean;
  onProgress: (profile: ViewerProfile) => void;
  onComplete: (profile: ViewerProfile) => void;
  onSkip: (profile: ViewerProfile) => void;
  onClose: () => void;
}) {
  const [step, setStep] = React.useState(1);
  const [draft, setDraft] = React.useState(profile);
  const [error, setError] = React.useState("");
  const dialogRef = React.useRef<HTMLDivElement>(null);
  const draftRef = React.useRef(profile);

  React.useEffect(() => {
    if (!open) return;
    setDraft(profile);
    draftRef.current = profile;
    setStep(1);
    setError("");
  }, [open, profile]);

  React.useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  React.useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    const focusable = () => Array.from(dialog?.querySelectorAll<HTMLElement>("button, input, textarea, [tabindex]:not([tabindex='-1'])") ?? [])
      .filter((element) => !element.hasAttribute("disabled"));
    focusable()[0]?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (!editing) onProgress({ ...draftRef.current, status: "in_progress" });
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previous?.focus();
    };
  }, [editing, onClose, onProgress, open]);

  if (!open) return null;

  function nextStep() {
    if (step === 1 && draft.interests.length < 3) {
      setError("Choose at least three interests, or skip setup for now.");
      return;
    }
    if (step === 2 && (!draft.languages.length || !draft.formats.length)) {
      setError("Keep at least one language and one video format selected.");
      return;
    }
    setError("");
    if (!editing) onProgress({ ...draft, status: "in_progress" });
    setStep((current) => Math.min(3, current + 1));
  }

  return (
    <div className="onboarding-backdrop" role="presentation">
      <div className="onboarding-modal" role="dialog" aria-modal="true" aria-labelledby="onboarding-title" ref={dialogRef}>
        <header className="onboarding-header">
          <div className="onboarding-brand"><span><Sparkles /></span><div><strong>Watchflow setup</strong><small>Personalization you can inspect and change</small></div></div>
          <button className="icon-button" type="button" onClick={() => { if (!editing) onProgress({ ...draft, status: "in_progress" }); onClose(); }} aria-label="Close onboarding"><X /></button>
        </header>

        <div className="onboarding-progress" aria-label={`Step ${step} of 3`}>
          {[1, 2, 3].map((value) => <span key={value} className={value <= step ? "active" : ""}><i>{value < step ? <Check /> : value}</i><b>{value === 1 ? "Interests" : value === 2 ? "Viewing style" : "Sources"}</b></span>)}
        </div>

        <div className="onboarding-content">
          {step === 1 && (
            <section>
              <span className="section-kicker">Step 1 · Your interests</span>
              <h2 id="onboarding-title">What deserves a place in your feed?</h2>
              <p>Choose at least three. These are starting points, not permanent labels.</p>
              <div className="interest-picker">
                {interestOptions.map((option) => <button key={option.id} className={draft.interests.includes(option.id) ? "selected" : ""} type="button" onClick={() => setDraft((current) => ({ ...current, interests: toggleValue(current.interests, option.id) }))}>{draft.interests.includes(option.id) && <Check />}{option.label}</button>)}
              </div>
              <div className="tag-input-grid">
                <TagInput label="Your niche topics" placeholder="e.g. urban planning" values={draft.customTopics} onChange={(customTopics) => setDraft((current) => ({ ...current, customTopics }))} />
                <TagInput label="Show me less of" placeholder="e.g. celebrity news" values={draft.excludedTopics} onChange={(excludedTopics) => setDraft((current) => ({ ...current, excludedTopics }))} />
              </div>
            </section>
          )}

          {step === 2 && (
            <section>
              <span className="section-kicker">Step 2 · Viewing style</span>
              <h2 id="onboarding-title">How do you like to watch?</h2>
              <p>These defaults shape future sessions. You can override them any time.</p>
              <div className="onboarding-field"><strong>Languages</strong><div className="choice-row">{languageOptions.map((option) => <button key={option.value} className={draft.languages.includes(option.value) ? "selected" : ""} type="button" onClick={() => setDraft((current) => ({ ...current, languages: toggleValue(current.languages, option.value) }))}>{draft.languages.includes(option.value) && <Check />}{option.label}</button>)}</div></div>
              <div className="onboarding-field"><strong>Formats</strong><div className="format-picker">{formatOptions.map((option) => <button key={option.value} className={draft.formats.includes(option.value) ? "selected" : ""} type="button" onClick={() => setDraft((current) => ({ ...current, formats: toggleValue(current.formats, option.value) }))}><span>{option.label}</span><small>{option.note}</small>{draft.formats.includes(option.value) && <Check />}</button>)}</div></div>
              <div className="onboarding-sliders">
                <label className="range-control"><span><b>Quick overview</b><b>Deep dive</b></span><input type="range" min="0" max="100" value={draft.depth} onChange={(event) => setDraft((current) => ({ ...current, depth: Number(event.target.value) }))} /><small>{draft.depth < 40 ? "Keep it light" : draft.depth > 70 ? "Detailed by default" : "Useful detail"}</small></label>
                <label className="range-control"><span><b>Calm pace</b><b>High energy</b></span><input type="range" min="0" max="100" value={draft.pace} onChange={(event) => setDraft((current) => ({ ...current, pace: Number(event.target.value) }))} /><small>{draft.pace < 40 ? "Calm and measured" : draft.pace > 70 ? "Fast and dynamic" : "Balanced pace"}</small></label>
              </div>
              <div className="onboarding-toggles">
                <label className="toggle-row"><span><Heart /><span><strong>Audio-friendly</strong><small>Include videos that work without watching closely</small></span></span><input type="checkbox" checked={draft.audioFriendly} onChange={(event) => setDraft((current) => ({ ...current, audioFriendly: event.target.checked }))} /><i /></label>
                <label className="toggle-row"><span><CheckCircle2 /><span><strong>Anti-clickbait filter</strong><small>Prefer titles that accurately reflect the content</small></span></span><input type="checkbox" checked={draft.antiClickbait} onChange={(event) => setDraft((current) => ({ ...current, antiClickbait: event.target.checked }))} /><i /></label>
              </div>
            </section>
          )}

          {step === 3 && (
            <section>
              <span className="section-kicker">Step 3 · Recommendation sources</span>
              <h2 id="onboarding-title">How far should Watchflow look?</h2>
              <p>Your choices control the recommendation logic. Connected accounts use imported subscriptions and liked videos; demo mode keeps everything local.</p>
              <div className="source-picker">{sourceOptions.map((option) => <button key={option.value} className={draft.defaultSource === option.value ? "selected" : ""} type="button" onClick={() => setDraft((current) => ({ ...current, defaultSource: option.value }))}><span>{option.label}</span><small>{option.note}</small>{draft.defaultSource === option.value && <CheckCircle2 />}</button>)}</div>
              <div className="signal-permissions">
                <label><span className="signal-icon"><Users /></span><span><strong>Use my subscriptions</strong><small>{signals.subscriptions.detail}</small></span><input type="checkbox" checked={draft.useSubscriptions} onChange={(event) => setDraft((current) => ({ ...current, useSubscriptions: event.target.checked }))} /></label>
                <label><span className="signal-icon"><ThumbsUp /></span><span><strong>Use my liked videos</strong><small>{signals.likedVideos.detail}</small></span><input type="checkbox" checked={draft.useLikedVideos} onChange={(event) => setDraft((current) => ({ ...current, useLikedVideos: event.target.checked }))} /></label>
              </div>
              <div className="api-limits"><div><History /><span><strong>Watch history</strong><small>Not available through the YouTube Data API</small></span></div><div><ListVideo /><span><strong>Watch Later</strong><small>Not available through the YouTube Data API</small></span></div></div>
            </section>
          )}
          {error && <p className="onboarding-error" role="alert">{error}</p>}
        </div>

        <footer className="onboarding-footer">
          <button className="button text-button" type="button" onClick={() => editing ? onClose() : onSkip({ ...draft, status: "skipped" })}>{editing ? "Cancel changes" : "Skip for now"}</button>
          <div>
            {step > 1 && <button className="button secondary" type="button" onClick={() => { setError(""); setStep((current) => current - 1); }}><ArrowLeft />Back</button>}
            {step < 3 ? <button className="button primary" type="button" onClick={nextStep}>Continue<ArrowRight /></button> : <button className="button primary" type="button" onClick={() => onComplete({ ...draft, status: "completed" })}><Check />{editing ? "Save profile" : "Finish setup"}</button>}
          </div>
        </footer>
      </div>
    </div>
  );
}
