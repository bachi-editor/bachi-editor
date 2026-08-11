// Release metadata shown in the About dialog. `package.json` owns the current
// application version; this list owns the dated history and points into the
// normal four-locale UI catalog for every piece of visible copy.

import packageMetadata from '../package.json';
import type { MessageKey } from './i18n/messages';

export const APP_VERSION = packageMetadata.version;

export interface ReleaseNote {
  version: string;
  date: `${number}-${number}-${number}`;
  titleKey: MessageKey;
  changeKeys: readonly MessageKey[];
}

export const RELEASE_NOTES = [
  {
    version: '0.0.1',
    date: '2026-08-11',
    titleKey: 'about.release.0_0_1.title',
    changeKeys: ['about.release.0_0_1.songSort'],
  },
  {
    version: '0.0.0',
    date: '2026-08-10',
    titleKey: 'about.release.0_0_0.title',
    changeKeys: [
      'about.release.0_0_0.about',
      'about.release.0_0_0.tja',
      'about.release.0_0_0.playhead',
    ],
  },
] as const satisfies readonly ReleaseNote[];
