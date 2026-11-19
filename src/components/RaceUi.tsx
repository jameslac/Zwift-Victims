import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  buildZwiftActivityUrl,
  buildZwiftPowerEventUrl,
  buildZwiftRacingEventUrl,
  buildZwiftToolsBikeComparisonUrl,
  buildZwiftToolsRaceReplayUrl,
  buildZwifterBikesRouteUrl,
  ordinal,
} from '../lib/raceHistory';
import type { ActivityType } from '../lib/raceHistory';

export { AppHeader } from './AppShell';

const ACTIVITY_TYPE_BADGE_TONE: Record<ActivityType, string> = {
  race: 'bg-accent/15 border-accent/40 text-accent-text',
  ride: 'bg-sky-500/15 border-sky-500/40 text-sky-300',
  workout: 'bg-violet-500/15 border-violet-500/40 text-violet-300',
  free_ride: 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300',
};

export function ActivityTypeBadge({
  type = 'race',
  label = 'Race',
}: {
  type?: ActivityType;
  label?: string;
}) {
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${ACTIVITY_TYPE_BADGE_TONE[type]}`}
    >
      {label}
    </span>
  );
}

export function Stat({
  label,
  value,
  subValue,
}: {
  label: string;
  value: string | number | undefined;
  subValue?: string;
}) {
  return (
    <div className="rounded-xl bg-slate-950/70 border border-slate-800 p-4">
      <dt className="text-xs uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-1 text-xl font-bold">{value ?? '—'}</dd>
      {subValue && <dd className="mt-0.5 text-xs text-slate-400">{subValue}</dd>}
    </div>
  );
}

export function MetricGrid({
  items,
}: {
  items: Array<{
    label: string;
    value: string | number | undefined;
    tone?: 'positive' | 'negative';
  }>;
}) {
  return (
    <dl className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2 text-xs">
      {items.map((item) => {
        const containerTone =
          item.tone === 'positive'
            ? 'bg-emerald-500/10 border-emerald-500/30'
            : item.tone === 'negative'
              ? 'bg-red-500/10 border-red-500/30'
              : 'bg-slate-900/70 border-slate-800/80';
        const valueTone =
          item.tone === 'positive'
            ? 'text-emerald-400'
            : item.tone === 'negative'
              ? 'text-red-400'
              : '';
        return (
          <div key={item.label} className={`rounded-lg border p-2 ${containerTone}`}>
            <dt className="text-slate-400">{item.label}</dt>
            <dd className={`mt-0.5 font-semibold ${valueTone}`}>{item.value ?? '—'}</dd>
          </div>
        );
      })}
    </dl>
  );
}

export function PlacingBadge({
  truePlace,
  fieldSize,
  zpPlace,
  didNotFinish,
  disqualified,
  penalty,
}: {
  truePlace?: number;
  fieldSize?: number;
  zpPlace?: number;
  didNotFinish?: boolean;
  disqualified?: boolean;
  penalty?: string;
}) {
  if (didNotFinish) {
    return (
      <span className="rounded-full bg-red-500/20 border border-red-500/40 px-2.5 py-0.5 text-xs font-semibold text-red-300">
        DNF
      </span>
    );
  }
  if (disqualified) {
    return (
      <span className="rounded-full bg-red-500/20 border border-red-500/40 px-2.5 py-0.5 text-xs font-semibold text-red-300">
        DQ
      </span>
    );
  }
  if (truePlace != null) {
    const label = fieldSize ? `${ordinal(truePlace)} / ${fieldSize}` : ordinal(truePlace);
    let tone = 'bg-slate-800/80 border-slate-600 text-slate-100';
    if (truePlace === 1) {
      tone = 'bg-amber-400/20 border-amber-400/50 text-amber-300';
    } else if (truePlace === 2) {
      tone = 'bg-slate-300/20 border-slate-300/50 text-slate-200';
    } else if (truePlace === 3) {
      tone = 'bg-orange-500/20 border-orange-500/50 text-orange-300';
    }
    return (
      <span
        className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${tone}`}
        title="True category placing from ZwiftRacing (includes private riders)"
      >
        {label}
      </span>
    );
  }
  if (penalty) {
    return (
      <span className="rounded-full bg-red-500/20 border border-red-500/40 px-2.5 py-0.5 text-xs font-semibold text-red-300">
        {penalty}
      </span>
    );
  }
  if (zpPlace != null) {
    return (
      <span
        className="rounded-full bg-slate-700/40 border border-slate-600 px-2.5 py-0.5 text-xs font-semibold text-slate-300"
        title="ZwiftPower category placing (private/hidden riders excluded)"
      >
        {ordinal(zpPlace)} (ZP*)
      </span>
    );
  }
  return null;
}

function ZwiftIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M6 6h12L6 18h12" />
    </svg>
  );
}

function ZwiftPowerIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M13 2 4.5 13.5H11l-1 8.5 8.5-11.5H12l1-8.5Z" />
    </svg>
  );
}

function ZwiftRacingIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
      <line x1="4" y1="22" x2="4" y2="15" />
    </svg>
  );
}

function RouteIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <circle cx="6" cy="19" r="3" />
      <path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15" />
      <circle cx="18" cy="5" r="3" />
    </svg>
  );
}

function BikeIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <circle cx="5.5" cy="16.5" r="3.5" />
      <circle cx="18.5" cy="16.5" r="3.5" />
      <path d="M5.5 16.5h6l4-6.5h-6l-4 6.5Z" />
      <path d="M11.5 16.5 8.8 8H7" />
      <path d="M18.5 16.5 14.5 7.8H17" />
    </svg>
  );
}

function ReplayIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M10.5 8.5v7l5.5-3.5-5.5-3.5Z" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function RaceExternalLinks({
  zpZid,
  zrEventId,
  zrSubgroup,
  routeName,
  activityId,
  align = 'end',
}: {
  zpZid?: string;
  zrEventId?: string;
  zrSubgroup?: string;
  routeName?: string;
  activityId?: string;
  align?: 'start' | 'end';
  showLabels?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleOutside(e: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('pointerdown', handleOutside);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('pointerdown', handleOutside);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  const links: Array<{
    key: string;
    href: string;
    title: string;
    subtitle: string;
    icon: ReactNode;
  }> = [];

  const cleanZid = zpZid?.trim();
  if (cleanZid) {
    links.push({
      key: 'zwiftpower',
      href: buildZwiftPowerEventUrl(cleanZid),
      title: 'ZwiftPower Event Results',
      subtitle: 'Official ZP standings & power splits',
      icon: <ZwiftPowerIcon className="w-4 h-4" />,
    });
  }

  const cleanZrEventId = zrEventId?.trim();
  const cleanSubgroup = zrSubgroup?.trim().replace(/\+$/, '');
  if (cleanZrEventId && cleanSubgroup) {
    links.push({
      key: 'zwiftracing',
      href: buildZwiftRacingEventUrl(cleanZrEventId, cleanSubgroup),
      title: 'ZwiftRacing.app Event',
      subtitle: 'vELO ratings, SOF & pen breakdown',
      icon: <ZwiftRacingIcon className="w-4 h-4" />,
    });
  }

  const cleanRouteName = routeName?.trim();
  const routeUrl = cleanRouteName ? buildZwifterBikesRouteUrl(cleanRouteName) : undefined;
  if (cleanRouteName && routeUrl) {
    links.push({
      key: 'zwifterbikes',
      href: routeUrl,
      title: 'ZwifterBikes Route Guide',
      subtitle: `Best bike & wheel setup for ${cleanRouteName}`,
      icon: <RouteIcon className="w-4 h-4" />,
    });
  }

  const cleanActivityId = activityId?.trim();
  if (cleanActivityId) {
    links.push(
      {
        key: 'zwift',
        href: buildZwiftActivityUrl(cleanActivityId),
        title: 'Zwift Activity Feed',
        subtitle: 'Open activity & photos on Zwift.com',
        icon: <ZwiftIcon className="w-4 h-4" />,
      },
      {
        key: 'zwifttools-bike',
        href: buildZwiftToolsBikeComparisonUrl(cleanActivityId),
        title: 'ZwiftTools Bike Comparison',
        subtitle: 'Compare frame & wheel time savings',
        icon: <BikeIcon className="w-4 h-4" />,
      },
      {
        key: 'zwifttools-replay',
        href: buildZwiftToolsRaceReplayUrl(cleanActivityId),
        title: 'ZwiftTools Race Replay',
        subtitle: 'Interactive telemetry & race replay',
        icon: <ReplayIcon className="w-4 h-4" />,
      },
    );
  }

  if (links.length === 0) return null;

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-bold transition-colors ${
          open
            ? 'border-accent bg-accent/15 text-accent-text'
            : 'border-slate-700 bg-slate-900 text-slate-200 hover:border-accent/60 hover:text-accent-text hover:bg-slate-800'
        }`}
      >
        <span>External Links ({links.length})</span>
        <svg
          viewBox="0 0 20 20"
          fill="currentColor"
          className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          aria-label="External activity and event links"
          className={`absolute z-30 mt-1.5 w-68 rounded-2xl border border-slate-700 bg-slate-900/98 backdrop-blur-xl p-1.5 shadow-2xl space-y-0.5 ${
            align === 'start' ? 'left-0' : 'right-0'
          }`}
        >
          {links.map((link) => (
            <a
              key={link.key}
              role="menuitem"
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setOpen(false)}
              className="flex items-start gap-2.5 rounded-xl px-2.5 py-2 text-left hover:bg-slate-800/90 transition-colors group"
            >
              <span className="mt-0.5 inline-flex items-center justify-center w-7 h-7 rounded-lg bg-slate-950 border border-slate-800 text-slate-300 group-hover:border-accent/50 group-hover:text-accent-text shrink-0">
                {link.icon}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-1 text-xs font-bold text-slate-100 group-hover:text-accent-text">
                  <span className="truncate">{link.title}</span>
                  <span className="text-[11px] text-slate-400 group-hover:text-accent-text shrink-0">
                    ↗
                  </span>
                </span>
                <span className="block text-[11px] text-slate-400 truncate mt-0.5">
                  {link.subtitle}
                </span>
              </span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
