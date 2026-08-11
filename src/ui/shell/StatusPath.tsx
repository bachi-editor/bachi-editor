// The right-aligned file path shown in every status bar. Each entry is a full
// project-relative path; the directory portion is dimmed and the file name is
// highlighted, so the status line always names the exact file(s) the current
// view reads/writes — even when those files live in different folders (e.g. the
// Sound tab touches both sound/ and fumen/).
//
// Hidden affordance: ⌘-click (macOS) / Ctrl-click (Windows/Linux) a file name to
// copy its full path. A sandboxed browser can't reveal a file in Finder/Explorer
// — the File System Access API hides absolute paths — so copying is the closest
// we can offer for "locate this file".

import { useEffect, useRef, useState } from 'react';
import { useT } from '../../i18n';

/** True on macOS, where the reveal modifier is ⌘ rather than Ctrl. */
const IS_MAC = typeof navigator !== 'undefined' && /Mac|iP(hone|ad|od)/.test(navigator.platform);
const MOD_LABEL = IS_MAC ? '⌘' : 'Ctrl';

export interface StatusPathProps {
  /**
   * Project-relative path(s) the current view touches, rendered clickable and
   * joined by " · ". A path ending in "/" is treated as a non-clickable
   * directory hint (used when no concrete file is resolved yet).
   */
  paths: string[];
}

/** Split "Data/x64/sound/song_x.nus3bank" → dim dir "Data/x64/sound/" + name. */
function splitPath(path: string): { dir: string; name: string } {
  const slash = path.lastIndexOf('/');
  return slash >= 0 ? { dir: path.slice(0, slash + 1), name: path.slice(slash + 1) } : { dir: '', name: path };
}

export function StatusPath({ paths }: StatusPathProps) {
  const t = useT();
  // Which path just got copied — drives the transient "copied" flash.
  const [copied, setCopied] = useState<string | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const reveal = (path: string) => {
    void navigator.clipboard?.writeText(path).then(
      () => {
        setCopied(path);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(undefined), 1400);
      },
      () => {
        /* clipboard denied — nothing actionable to show */
      },
    );
  };

  return (
    <div className="grp right tk-path">
      {paths.map((path, i) => {
        // NBSPs survive the flex-item boundary; ordinary leading whitespace is
        // collapsed, which previously rendered the first path directly beside "·".
        const sep = i > 0 ? <span className="tk-path-sep">&nbsp;·&nbsp;</span> : null;
        // A trailing slash is a directory hint: dim, non-interactive.
        if (path.endsWith('/')) {
          return (
            <span key={i}>{sep}<span className="tk-path-dir">{path}</span></span>
          );
        }
        const { dir, name } = splitPath(path);
        return (
          <span key={i}>
            {sep}
            <button
              type="button"
              className={`tk-path-file${copied === path ? ' copied' : ''}`}
              title={t('statuspath.copyHint', { mod: MOD_LABEL })}
              onClick={(e) => {
                if (e.metaKey || e.ctrlKey) reveal(path);
              }}
            >
              {copied === path ? t('statuspath.copied') : <><span className="tk-path-dir">{dir}</span>{name}</>}
            </button>
          </span>
        );
      })}
    </div>
  );
}
