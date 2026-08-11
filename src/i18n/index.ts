// i18n barrel for UI components. Components import from here.
//
// The store must NOT import this barrel (it would pull in the store→hook cycle);
// it imports the pure catalog from './messages' directly.
export {
  DEFAULT_UI_LANG,
  detectDefaultUiLang,
  isUiLang,
  type MessageKey,
  type UiLang,
  UI_LANGUAGES,
} from './messages';
export { type TFn, useT, useUiLang } from './useT';
