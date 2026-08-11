// Dani config validation. Errors block save; warnings surface but don't block
// (see PLAN.md, Dani Dojo). Song-catalog checks (does songNo resolve? does the song have
// an Ura chart?) only run when a game project is open and supplies a resolver;
// without one, only range/shape checks apply (see PLAN.md, Dani Dojo).

import {
  BORDER_TYPE_ALL,
  BORDER_TYPE_PER_SONG,
  danConditionType,
  danTitleParts,
  EXPECTED_ODAI_SONGS,
  MAX_ODAI_BORDERS,
  ODAI_TYPE_DRUMROLL,
  ODAI_TYPE_SCORE,
  ODAI_TYPE_SOUL_GAUGE,
  type DanConfig,
  type DanEntry,
} from '../codec/serverdata';
import { isEmptyDan, type DanSection } from './danEdits';
import type { SongStars } from './songlist';

export interface DanIssue {
  level: 'error' | 'warning';
  message: string;
}

/** What the song catalog can tell us about a Song No. (`songNo` == musicinfo `uniqueId`). */
export interface ResolvedDanSong {
  id: string;
  title: string;
  hasUra: boolean;
  stars: SongStars;
  genreNo?: number;
}

/** Resolver injected by the store from the open project's SongIndex + locale. */
export type DanSongResolver = (songNo: number) => ResolvedDanSong | undefined;

/** Issues for a single dan — the set shown inline in its detail panel. */
export function validateDan(d: DanEntry, resolve?: DanSongResolver): DanIssue[] {
  const issues: DanIssue[] = [];
  const err = (message: string) => issues.push({ level: 'error', message });
  const warn = (message: string) => issues.push({ level: 'warning', message });

  if (isEmptyDan(d)) {
    err('This dan is cleared (no songs). Fill its 3 songs or remove it before saving.');
    return issues;
  }
  if (d.aryOdaiSong.length !== EXPECTED_ODAI_SONGS) {
    err(`A dan must have exactly ${EXPECTED_ODAI_SONGS} odai songs (has ${d.aryOdaiSong.length}).`);
  }
  d.aryOdaiSong.forEach((s, i) => {
    const n = i + 1;
    if (!s.songNo) {
      err(`Song ${n}: no song selected.`);
    } else if (resolve && !resolve(s.songNo)) {
      err(`Song ${n}: Song No. ${s.songNo} does not resolve to a known song.`);
    }
    if (s.level < 1 || s.level > 5) {
      err(`Song ${n}: course level ${s.level} is out of range (1–5).`);
    }
    const song = resolve?.(s.songNo);
    if (song && s.level === 5 && !song.hasUra) {
      warn(`Song ${n} (${song.title}): set to Ura Oni but the song has no Ura Oni chart.`);
    }
  });

  if (d.aryOdaiBorder.length === 0) {
    warn('No clear criteria — every run would pass by default.');
  }
  d.aryOdaiBorder.forEach((b, i) => {
    const n = i + 1;
    const type = danConditionType(b.odaiType);
    if (!type) err(`Criterion ${n}: unknown odaiType ${b.odaiType}.`);
    if (b.borderType !== 1 && b.borderType !== 2) err(`Criterion ${n}: invalid borderType ${b.borderType}.`);
    // Red/gold ordering is separate from whether the pass comparison is strict.
    // `≥` types want gold ≥ red; `<` types (Bad/OK) want gold ≤ red. A 0/0
    // pair is "no requirement".
    if (type) {
      const pairs: [number, number][] = b.borderType === BORDER_TYPE_PER_SONG
        ? [[b.redBorder_1, b.goldBorder_1], [b.redBorder_2, b.goldBorder_2], [b.redBorder_3, b.goldBorder_3]]
        : [[b.redBorderTotal, b.goldBorderTotal]];
      const upperLimit = type.comparison === '<';
      const inverted = pairs.some(([r, g]) => (upperLimit ? g > r : g < r));
      if (inverted) {
        warn(upperLimit
          ? `Criterion ${n} (${type.label}): gold is above red — fewer is better here, so gold should be ≤ red.`
          : `Criterion ${n} (${type.label}): gold is below red — higher is better here, so gold should be ≥ red.`);
      }
    }
  });

  // Structural conventions (non-blocking) distilled from every official dan.
  issues.push(...danStructureWarnings(d));
  return issues;
}

/**
 * Non-blocking structural conventions distilled from every official dan (段位道場
 * 2020–2025 + the CHN corpus, ~120 entries). The game's enum technically
 * supports any odaiType in either border mode, so a deviation is a WARNING
 * (likely a mistake), not a hard error. Every real dan is one of:
 *   [Gauge, TotalHit] · [Gauge, TotalHit, Bad] ·
 *   [Gauge, {TotalHit|Good|OK|Combo}, Bad, Drumroll]
 * — condition 1 is always a whole-set Soul Gauge, Drumroll is per-song, Score is
 * never used, at most 4 criteria, and no condition type repeats.
 */
export function danStructureWarnings(d: DanEntry): DanIssue[] {
  const out: DanIssue[] = [];
  const warn = (message: string) => out.push({ level: 'warning', message });
  const borders = d.aryOdaiBorder;
  if (borders.length === 0) return out; // the "no criteria" warning is raised in validateDan

  if (borders.length > MAX_ODAI_BORDERS) {
    warn(`${borders.length} criteria — standard dans use at most ${MAX_ODAI_BORDERS} (the result screen shows 条件1〜4).`);
  }

  // Soul Gauge leads every official dan and is a cumulative, whole-set gauge.
  const gauge = borders.filter((b) => b.odaiType === ODAI_TYPE_SOUL_GAUGE);
  if (gauge.length === 0) {
    warn('No Soul Gauge criterion — every standard dan leads with one (条件1 = 魂ゲージ).');
  } else {
    if (borders[0].odaiType !== ODAI_TYPE_SOUL_GAUGE) {
      warn('Soul Gauge is the first criterion (条件1) in every standard dan.');
    }
    if (gauge.some((b) => b.borderType !== BORDER_TYPE_ALL)) {
      warn('Soul Gauge is a cumulative gauge — standard dans evaluate it over the whole set, not per song.');
    }
  }

  // Drumroll, when present, is always the final criterion and per-song.
  const drumIdx = borders.findIndex((b) => b.odaiType === ODAI_TYPE_DRUMROLL);
  if (drumIdx !== -1) {
    if (drumIdx !== borders.length - 1) {
      warn('Drumroll is the last criterion (条件4) in every standard dan.');
    }
    if (borders[drumIdx].borderType !== BORDER_TYPE_PER_SONG) {
      warn('Drumroll criteria are evaluated per song in every standard dan.');
    }
  }
  if (borders.some((b) => b.odaiType === ODAI_TYPE_SCORE)) {
    warn('Score criteria have never appeared in a standard dan — double-check this is intended.');
  }

  // Each condition type appears at most once.
  const counts = new Map<number, number>();
  for (const b of borders) counts.set(b.odaiType, (counts.get(b.odaiType) ?? 0) + 1);
  for (const [type, n] of counts) {
    if (n > 1) {
      const name = danConditionType(type)?.label ?? `type ${type}`;
      warn(`Criterion "${name}" appears ${n}× — standard dans use each type at most once.`);
    }
  }
  return out;
}

/** A dan's display label for section-level messages. */
export function danLabel(section: DanSection, d: DanEntry): string {
  return section === 'gaiden' ? d.title : danTitleParts(d.title).en;
}

export interface SectionIssues {
  errors: DanIssue[];
  /** Warnings, restricted to dans the caller marks edited (keeps the modal quiet). */
  warnings: DanIssue[];
}

/**
 * File-level issues: per-dan errors (always), plus contiguity + uniqueness
 * checks. Warnings are only collected for dans the `isEdited` predicate marks,
 * so an untouched corpus quirk never nags on save.
 */
export function validateSection(
  config: DanConfig,
  resolve: DanSongResolver | undefined,
  section: DanSection,
  isEdited: (d: DanEntry) => boolean = () => true,
): SectionIssues {
  const errors: DanIssue[] = [];
  const warnings: DanIssue[] = [];

  // danId uniqueness (see PLAN.md, Dani Dojo).
  const seen = new Set<number>();
  for (const d of config) {
    if (seen.has(d.danId)) errors.push({ level: 'error', message: `Duplicate danId ${d.danId}.` });
    seen.add(d.danId);
  }

  // Contiguity: an empty dan may not sit before a filled one (no mid-ladder gap).
  const firstEmpty = config.findIndex(isEmptyDan);
  if (firstEmpty > -1) {
    for (let i = firstEmpty + 1; i < config.length; i++) {
      if (!isEmptyDan(config[i])) {
        errors.push({
          level: 'error',
          message:
            `Gap: ${danLabel(section, config[firstEmpty])} is empty but a later dan ` +
            `(${danLabel(section, config[i])}) has data. Dans must be contiguous.`,
        });
        break;
      }
    }
  }

  for (const d of config) {
    const label = danLabel(section, d);
    const perDan = validateDan(d, resolve);
    for (const issue of perDan) {
      if (issue.level === 'error') {
        errors.push({ level: 'error', message: `${label}: ${issue.message}` });
      } else if (isEdited(d)) {
        warnings.push({ level: 'warning', message: `${label}: ${issue.message}` });
      }
    }
  }
  return { errors, warnings };
}

/** Count of blocking errors in a section (drives the status bar + save gate). */
export function sectionErrorCount(config: DanConfig, resolve: DanSongResolver | undefined, section: DanSection): number {
  return validateSection(config, resolve, section).errors.length;
}
