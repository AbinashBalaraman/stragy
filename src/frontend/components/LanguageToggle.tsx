import type { Lang } from '../i18n';

type Props = { value: Lang; onChange: (lang: Lang) => void; compact?: boolean };

export function LanguageToggle({ value, onChange, compact }: Props) {
  return (
    <div className="seg" role="radiogroup" aria-label="Reply language" data-lang={value}>
      <button
        type="button"
        role="radio"
        aria-checked={value === 'en'}
        lang="en"
        onClick={() => onChange('en')}
      >
        English
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={value === 'ta'}
        lang="ta"
        className="ta-text"
        style={compact ? { fontSize: 'var(--fs-xs)', padding: '0 8px' } : undefined}
        onClick={() => onChange('ta')}
      >
        தமிழ்
      </button>
    </div>
  );
}
