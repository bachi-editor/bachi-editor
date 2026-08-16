import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import { translate } from '../../src/i18n/messages';
import type { TFn } from '../../src/i18n/useT';
import { localesForGameVersion, type Locale, type SongRow } from '../../src/model/songlist';
import { convertTjaForImport } from '../../src/model/tjaImport';
import { metadataChanges } from '../../src/ui/ImportTjaDialog';
import {
  canOpenProjectSetup,
  GameVersionField,
  setupErrorMessage,
} from '../../src/ui/SettingsDialog';

const t: TFn = (key, params) => translate(key, 'en', params);

function completeSetup(): Parameters<typeof canOpenProjectSetup>[0] {
  return {
    handle: {} as FileSystemDirectoryHandle,
    gameVersion: 'chn',
    datatableKey: 'datatable-key',
    fumenKey: 'fumen-key',
    busy: false,
  };
}

describe('project game-version setup', () => {
  test('requires an explicit CHN or JPN selection before loading', () => {
    const complete = completeSetup();
    expect(canOpenProjectSetup(complete)).toBe(true);
    expect(canOpenProjectSetup({ ...complete, gameVersion: 'jpn' })).toBe(true);
    expect(canOpenProjectSetup({ ...complete, gameVersion: undefined })).toBe(false);
    expect(canOpenProjectSetup({ ...complete, handle: undefined })).toBe(false);
    expect(canOpenProjectSetup({ ...complete, datatableKey: '  ' })).toBe(false);
    expect(canOpenProjectSetup({ ...complete, fumenKey: '' })).toBe(false);
    expect(canOpenProjectSetup({ ...complete, busy: true })).toBe(false);
  });

  test('localizes a detected-version mismatch with both version names', () => {
    const message = setupErrorMessage(t, {
      field: 'gameVersion',
      selected: 'chn',
      detected: 'jpn',
    });
    expect(message).toContain(translate('setup.gameVersion.chn', 'en'));
    expect(message).toContain(translate('setup.gameVersion.jpn', 'en'));
  });

  test('renders an unselected, required native radio group', () => {
    const html = renderToStaticMarkup(createElement(GameVersionField, {
      value: undefined,
      invalid: false,
      disabled: false,
      onChange: () => {},
      t,
    }));
    expect(html.match(/type="radio"/g)).toHaveLength(2);
    expect(html.match(/required=""/g)).toHaveLength(2);
    expect(html).not.toContain('checked=""');
    expect(html).toContain('value="chn"');
    expect(html).toContain('value="jpn"');
  });

  test('links a mismatch alert to the invalid radio group', () => {
    const html = renderToStaticMarkup(createElement('div', null,
      createElement(GameVersionField, {
        value: 'chn',
        invalid: true,
        disabled: false,
        errorId: 'tk-setup-error',
        onChange: () => {},
        t,
      }),
      createElement('div', { id: 'tk-setup-error', role: 'alert' }, 'Mismatch'),
    ));
    expect(html).toContain('<fieldset class="tk-settings-version" aria-invalid="true"');
    expect(html).toContain('aria-errormessage="tk-setup-error"');
    expect(html).toContain('id="tk-setup-error"');
    expect(html).toContain('role="alert"');
    expect(html).toMatch(/<input(?=[^>]*value="chn")(?=[^>]*checked="")[^>]*>/);
  });
});

describe('Metadata locales by game version', () => {
  test('omits only Simplified Chinese for JPN projects', () => {
    const chn = localesForGameVersion('chn').map((locale) => locale.value);
    const jpn = localesForGameVersion('jpn').map((locale) => locale.value);
    const legacy = localesForGameVersion(undefined).map((locale) => locale.value);

    expect(chn).toContain('chineseSText');
    expect(legacy).toContain('chineseSText');
    expect(jpn).not.toContain('chineseSText');
    expect(jpn).toEqual(chn.filter((locale) => locale !== 'chineseSText'));
  });

  test('omits Simplified Chinese title and subtitle changes from the JPN TJA preview', () => {
    const localized = (value: string): Record<Locale, string> => ({
      chineseSText: value,
      chineseTText: value,
      japaneseText: value,
      englishUsText: value,
      koreanText: value,
    });
    const row: SongRow = {
      id: 'target',
      uniqueId: 17,
      genreNo: 0,
      info: { uniqueId: 17, id: 'target' },
      titles: {
        title: localized('Old title'),
        subtitle: localized('Old subtitle'),
        detail: localized(''),
      },
    };
    const imported = convertTjaForImport(`
TITLE:New title
TITLEZH:新標題
SUBTITLE:--New subtitle
BPM:120
OFFSET:0
COURSE:Oni
LEVEL:5
#START
1,
#END
`);

    const jpnKeys = metadataChanges(row, imported, t, 'jpn').map((change) => change.key);
    const chnKeys = metadataChanges(row, imported, t, 'chn').map((change) => change.key);
    expect(jpnKeys).not.toContain('title:chineseSText');
    expect(jpnKeys).not.toContain('subtitle:chineseSText');
    expect(chnKeys).toContain('title:chineseSText');
    expect(chnKeys).toContain('subtitle:chineseSText');
  });
});
