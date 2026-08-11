// React binding for the i18n catalog. `useT()` returns a `t(key, params?)`
// bound to the current editor UI language from the store, so components stay
// terse: `const t = useT(); … t('settings.title')`.
//
// This file imports the store (the store only imports the pure catalog in
// ./messages, never this hook) so there is no import cycle.

import { useAppStore } from '../model/store';
import { type MessageKey, translate, type UiLang } from './messages';

export type TFn = (key: MessageKey, params?: Record<string, string | number>) => string;

/** Subscribe to the current UI language and get a bound translate function. */
export function useT(): TFn {
  const lang = useAppStore((s) => s.ui.uiLang);
  return (key, params) => translate(key, lang, params);
}

/** The current UI language (for components that need the raw code). */
export function useUiLang(): UiLang {
  return useAppStore((s) => s.ui.uiLang);
}
