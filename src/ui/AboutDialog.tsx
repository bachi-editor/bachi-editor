// About / welcome modal. Opens by itself the first time Bachi runs in a browser
// (see `aboutOpen`'s initial value in model/store.ts) and from the top-bar
// overflow menu afterwards, so the same surface serves as the introduction and
// as the permanent version, changelog, and credits page.
//
// Below the header sits a three-page horizontal gallery: what Bachi does, the
// changelog, then who it is built on. Every page stays mounted so the slide
// animation has something to move; only the visible one is exposed to
// assistive tech.
//
// The running version is a small suffix on the welcome heading rather than a
// row of its own, which leaves the whole changelog page to the release list.

import { useEffect, useState, type ReactNode } from 'react';
import { useAppStore } from '../model/store';
import { useT, useUiLang } from '../i18n';
import { APP_VERSION, RELEASE_NOTES } from '../releaseNotes';
import { BrandMark, Icon, type IconName } from './shell/Icon';

const ISSUES_URL = 'https://github.com/bachi-editor/bachi-editor/issues';

const PAGE_COUNT = 3;

export function AboutDialog() {
  const close = useAppStore((s) => s.closeAbout);
  const t = useT();
  const uiLang = useUiLang();
  const [page, setPage] = useState(0);
  const dateFormatter = new Intl.DateTimeFormat(uiLang, {
    year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC',
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowRight') setPage((p) => Math.min(PAGE_COUNT - 1, p + 1));
      else if (e.key === 'ArrowLeft') setPage((p) => Math.max(0, p - 1));
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [close]);

  return (
    <div className="tk-modal-overlay" onClick={close}>
      <div className="tk-modal tk-about-modal" onClick={(e) => e.stopPropagation()}>
        <div className="tk-about-head">
          <BrandMark size={40} />
          <div className="tk-about-headtext">
            <h2>
              {t('about.welcome')}
              <span className="tk-about-ver">v{APP_VERSION}</span>
            </h2>
            <p>{t('about.intro')}</p>
          </div>
        </div>

        <div className="tk-about-warning" role="note">
          <span className="tk-about-warning-ic"><Icon name="alert" size={20} /></span>
          <div>
            <strong>{t('about.alphaTitle')}</strong>
            <p>{t('about.alphaBody')}</p>
            <p>
              {t('about.feedback')}{' '}
              <a href={ISSUES_URL} target="_blank" rel="noreferrer noopener">
                {t('about.feedbackLink')}
              </a>
            </p>
          </div>
        </div>

        <div className="tk-about-gallery">
          <div className="tk-about-track" style={{ transform: `translateX(-${page * 100}%)` }}>
            <GalleryPage hidden={page !== 0} title={t('about.featuresTitle')}>
              <ul className="tk-about-features">
                <Feature icon="save" title={t('about.feature.inPlace')} body={t('about.feature.inPlaceBody')} />
                <Feature icon="folder" title={t('about.feature.noInstall')} body={t('about.feature.noInstallBody')} />
                <Feature icon="link" title={t('about.feature.local')} body={t('about.feature.localBody')} />
                <Feature icon="check" title={t('about.feature.official')} body={t('about.feature.officialBody')} />
                <Feature icon="sound" title={t('about.feature.audio')} body={t('about.feature.audioBody')} />
              </ul>
            </GalleryPage>

            <GalleryPage hidden={page !== 1} title={t('about.changelogTitle')} className="tk-about-page-rel">
              <div className="tk-about-changelog">
                {RELEASE_NOTES.map((release) => (
                  <article className="tk-about-release" key={release.version}>
                    <div className="tk-about-release-head">
                      <strong>v{release.version} · {t(release.titleKey)}</strong>
                      <time dateTime={release.date}>
                        {dateFormatter.format(new Date(`${release.date}T00:00:00Z`))}
                      </time>
                    </div>
                    <ul>
                      {release.changeKeys.map((key) => <li key={key}>{t(key)}</li>)}
                    </ul>
                  </article>
                ))}
              </div>
            </GalleryPage>

            <GalleryPage hidden={page !== 2} title={t('about.creditsTitle')}>
              <p className="tk-about-lead">{t('about.creditsLead')}</p>
              <ul className="tk-about-credits">
                <Credit
                  name="tja2fumen"
                  note={t('about.credit.tja2fumen')}
                  href="https://github.com/vivaria/tja2fumen"
                />
                <Credit
                  name="TaikoSoundEditor"
                  note={t('about.credit.taikoSoundEditor')}
                  href="https://github.com/NotImplementedLife/TaikoSoundEditor"
                />
                <Credit
                  name="TaikoLocalServer"
                  note={t('about.credit.taikoLocalServer')}
                  href="https://github.com/asesidaa/TaikoLocalServer"
                />
              </ul>
              <div className="tk-about-subhead">{t('about.dependenciesTitle')}</div>
              <p className="tk-about-deps">
                React · zustand · fflate · Vite · TypeScript · Vitest · Hanken Grotesk · JetBrains Mono
              </p>
              <p className="tk-about-lead">{t('about.licenseNote')}</p>
            </GalleryPage>
          </div>
        </div>

        <div className="tk-modal-foot">
          <button
            className="tk-btn tk-btn-sm"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            aria-label={t('about.previous')}
            title={t('about.previous')}
          >
            <Icon name="chevron" className="tk-about-prev" />
          </button>
          <div className="tk-about-dots">
            {Array.from({ length: PAGE_COUNT }, (_, i) => (
              <button
                key={i}
                type="button"
                className={'tk-about-dot' + (i === page ? ' on' : '')}
                onClick={() => setPage(i)}
                aria-label={t('about.page', { n: i + 1 })}
                aria-current={i === page}
              />
            ))}
          </div>
          <button
            className="tk-btn tk-btn-sm"
            onClick={() => setPage((p) => Math.min(PAGE_COUNT - 1, p + 1))}
            disabled={page === PAGE_COUNT - 1}
            aria-label={t('about.next')}
            title={t('about.next')}
          >
            <Icon name="chevron" />
          </button>
          <div style={{ flex: 1 }} />
          <button className="tk-btn tk-btn-primary" onClick={close}>{t('about.start')}</button>
        </div>
      </div>
    </div>
  );
}

function GalleryPage(
  { hidden, title, className, children }:
  { hidden: boolean; title: string; className?: string; children: ReactNode },
) {
  return (
    <section className={'tk-about-page' + (className ? ` ${className}` : '')} aria-hidden={hidden}>
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function Feature({ icon, title, body }: { icon: IconName; title: string; body: string }) {
  return (
    <li>
      <span className="tk-about-feature-ic"><Icon name={icon} size={15} /></span>
      <div>
        <strong>{title}</strong>
        <span>{body}</span>
      </div>
    </li>
  );
}

function Credit({ name, note, href }: { name: string; note: string; href?: string }) {
  return (
    <li>
      <strong>
        {href ? <a href={href} target="_blank" rel="noreferrer noopener">{name}</a> : name}
      </strong>
      <span>{note}</span>
    </li>
  );
}
