import { useAppStore } from '../../model/store';
import { useT } from '../../i18n';
import { Icon } from './Icon';

// Light/dark toggle (the one new control from the dark-mode reference). Shows the
// current theme's glyph — sun in light, moon in dark — and flips on click.
export function ThemeToggle() {
  const theme = useAppStore((s) => s.ui.theme);
  const toggleTheme = useAppStore((s) => s.toggleTheme);
  const t = useT();
  const dark = theme === 'dark';
  return (
    <button
      className="tk-iconbtn tk-themebtn"
      onClick={toggleTheme}
      title={dark ? t('theme.toLight') : t('theme.toDark')}
      aria-label={t('theme.toggle')}
      aria-pressed={dark}
    >
      <Icon name={dark ? 'moon' : 'sun'} size={16} />
    </button>
  );
}
