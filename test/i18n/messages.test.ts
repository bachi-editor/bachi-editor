import { describe, expect, test } from 'vitest';
import {
  DEFAULT_UI_LANG,
  detectDefaultUiLang,
  isUiLang,
  messages,
  translate,
  UI_LANGUAGES,
  type UiLang,
} from '../../src/i18n/messages';

const LANGS = UI_LANGUAGES.map((l) => l.code);

describe('i18n catalog completeness', () => {
  test('there are exactly the four required languages', () => {
    expect(LANGS.sort()).toEqual(['en', 'ja', 'zh-Hans', 'zh-Hant']);
  });

  test('every message is translated into all four languages (non-empty)', () => {
    const missing: string[] = [];
    for (const [key, row] of Object.entries(messages)) {
      for (const lang of LANGS) {
        const value = (row as Record<UiLang, string>)[lang];
        if (typeof value !== 'string' || value.trim() === '') missing.push(`${key}/${lang}`);
      }
    }
    expect(missing).toEqual([]);
  });

  test('no row carries a stray/extra language key', () => {
    for (const row of Object.values(messages)) {
      expect(Object.keys(row).sort()).toEqual(['en', 'ja', 'zh-Hans', 'zh-Hant']);
    }
  });
});

describe('translate', () => {
  test('returns the string for the requested language', () => {
    expect(translate('nav.songs', 'ja')).toBe('エディター');
    expect(translate('nav.songs', 'zh-Hans')).toBe('编辑器');
  });

  test('interpolates {placeholder} params', () => {
    const out = translate('setup.reconnect', 'en', { name: 'x64' });
    expect(out).toContain('x64');
    expect(out).not.toContain('{name}');
  });

  test('leaves unknown placeholders untouched', () => {
    // 'setup.reconnect' has {name}; passing an unrelated param leaves {name}.
    expect(translate('setup.reconnect', 'en', { other: 'y' })).toContain('{name}');
  });
});

describe('detectDefaultUiLang', () => {
  test('maps browser languages to the closest supported code', () => {
    expect(detectDefaultUiLang({ language: 'ja-JP' })).toBe('ja');
    expect(detectDefaultUiLang({ language: 'zh-CN' })).toBe('zh-Hans');
    expect(detectDefaultUiLang({ language: 'zh-TW' })).toBe('zh-Hant');
    expect(detectDefaultUiLang({ language: 'zh-Hant-HK' })).toBe('zh-Hant');
    expect(detectDefaultUiLang({ language: 'en-US' })).toBe('en');
  });

  test('falls back to the default for unsupported languages', () => {
    expect(detectDefaultUiLang({ language: 'fr-FR' })).toBe(DEFAULT_UI_LANG);
    expect(detectDefaultUiLang({ languages: [] })).toBe(DEFAULT_UI_LANG);
  });
});

describe('isUiLang', () => {
  test('accepts supported codes and rejects others', () => {
    expect(isUiLang('en')).toBe(true);
    expect(isUiLang('zh-Hant')).toBe(true);
    expect(isUiLang('ko')).toBe(false);
    expect(isUiLang(undefined)).toBe(false);
  });
});
