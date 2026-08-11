import { useAppStore } from '../../model/store';
import { UI_LANGUAGES, useT, useUiLang } from '../../i18n';
import { Icon } from './Icon';
import { Menu } from './Menu';

// Editor UI-language switcher (globe + current language) in the top bar. This
// re-skins the editor chrome and also drives the preferred song-title locale.
export function LanguagePicker() {
  const uiLang = useUiLang();
  const setUiLang = useAppStore((s) => s.setUiLang);
  const t = useT();

  return (
    <Menu
      trigger={<Icon name="globe" size={16} />}
      triggerClassName="tk-iconbtn"
      triggerTitle={t('lang.tooltip')}
      minWidth={168}
    >
      {(close) => (
        <>
          <div className="tk-menu-label">{t('lang.label')}</div>
          {UI_LANGUAGES.map((l) => (
            <button
              key={l.code}
              className={'tk-menu-item' + (l.code === uiLang ? ' on' : '')}
              onClick={() => {
                setUiLang(l.code);
                close();
              }}
            >
              <span className="ic">{l.code === uiLang ? <Icon name="check" /> : null}</span>
              {l.label}
            </button>
          ))}
        </>
      )}
    </Menu>
  );
}
