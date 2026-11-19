import { useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  buildZwiftActivityUrl,
  buildZwiftPowerEventUrl,
  buildZwiftRacingEventUrl,
  buildZwiftToolsBikeComparisonUrl,
  buildZwiftToolsRaceReplayUrl,
  buildZwifterBikesRouteUrl,
  ordinal,
} from '../lib/raceHistory';
import type { UnitSystem } from '../lib/units';

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

export function AppHeader({
  isOwnProfile,
  units,
  onUnitsChange,
  onLogout,
  backTo,
  backLabel,
}: {
  isOwnProfile: boolean;
  units: UnitSystem;
  onUnitsChange: (u: UnitSystem) => void;
  onLogout: () => void;
  backTo?: string;
  backLabel?: string;
}) {
  const navigate = useNavigate();
  const [lookupId, setLookupId] = useState('');

  function handleLookupSubmit(e: FormEvent) {
    e.preventDefault();
    const cleaned = lookupId.trim();
    if (!/^\d+$/.test(cleaned)) return;
    setLookupId('');
    navigate(`/riders/${cleaned}`);
  }

  return (
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/" className="font-extrabold text-lg">
          Zwift Victims
        </Link>
        {backTo && backLabel && (
          <Link
            to={backTo}
            className="rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-800"
          >
            {backLabel}
          </Link>
        )}
        {!isOwnProfile && !backTo && (
          <Link
            to="/"
            className="rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-800"
          >
            My profile
          </Link>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <form onSubmit={handleLookupSubmit} className="flex items-center gap-1">
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            placeholder="View rider ID…"
            aria-label="View rider by Zwift ID"
            value={lookupId}
            onChange={(e) => setLookupId(e.target.value)}
            className="w-32 rounded-lg bg-slate-900 border border-slate-700 px-2.5 py-1.5 text-sm focus:outline-none focus:border-[#fc6719]"
          />
          <button
            type="submit"
            disabled={!/^\d+$/.test(lookupId.trim())}
            className="rounded-lg border border-slate-700 px-2.5 py-1.5 text-sm hover:bg-slate-800 disabled:opacity-40"
          >
            Go
          </button>
        </form>
        <select
          aria-label="Units"
          value={units}
          onChange={(e) => onUnitsChange(e.target.value as UnitSystem)}
          className="rounded-lg bg-slate-900 border border-slate-700 px-2 py-1.5 text-sm"
        >
          <option value="metric">Metric (kg, cm)</option>
          <option value="imperial">Imperial (lb, ft)</option>
        </select>
        <button
          onClick={onLogout}
          className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm hover:bg-slate-800"
        >
          Log out
        </button>
      </div>
    </header>
  );
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
  showLabels = false,
}: {
  zpZid?: string;
  zrEventId?: string;
  zrSubgroup?: string;
  routeName?: string;
  activityId?: string;
  align?: 'start' | 'end';
  showLabels?: boolean;
}) {
  const links: Array<{
    key: string;
    href: string;
    title: string;
    label: string;
    shortLabel: string;
    icon: ReactNode;
  }> = [];

  const cleanZid = zpZid?.trim();
  if (cleanZid) {
    links.push({
      key: 'zwiftpower',
      href: buildZwiftPowerEventUrl(cleanZid),
      title: 'ZwiftPower Event',
      label: 'Open Event on ZwiftPower',
      shortLabel: 'ZwiftPower',
      icon: <ZwiftPowerIcon className={showLabels ? 'w-3.5 h-3.5' : 'w-4 h-4'} />,
    });
  }

  const cleanZrEventId = zrEventId?.trim();
  const cleanSubgroup = zrSubgroup?.trim().replace(/\+$/, '');
  if (cleanZrEventId && cleanSubgroup) {
    links.push({
      key: 'zwiftracing',
      href: buildZwiftRacingEventUrl(cleanZrEventId, cleanSubgroup),
      title: 'ZwiftRacing.app Event',
      label: 'Open Event on ZwiftRacing.app',
      shortLabel: 'ZwiftRacing',
      icon: <ZwiftRacingIcon className={showLabels ? 'w-3.5 h-3.5' : 'w-4 h-4'} />,
    });
  }

  const cleanRouteName = routeName?.trim();
  const routeUrl = cleanRouteName ? buildZwifterBikesRouteUrl(cleanRouteName) : undefined;
  if (cleanRouteName && routeUrl) {
    links.push({
      key: 'zwifterbikes',
      href: routeUrl,
      title: `ZwifterBikes Route (${cleanRouteName})`,
      label: 'Open Route on ZwifterBikes',
      shortLabel: 'ZwifterBikes',
      icon: <RouteIcon className={showLabels ? 'w-3.5 h-3.5' : 'w-4 h-4'} />,
    });
  }

  const cleanActivityId = activityId?.trim();
  if (cleanActivityId) {
    links.push(
      {
        key: 'zwift',
        href: buildZwiftActivityUrl(cleanActivityId),
        title: 'Zwift Activity',
        label: 'Open Activity on Zwift',
        shortLabel: 'Zwift',
        icon: <ZwiftIcon className={showLabels ? 'w-3.5 h-3.5' : 'w-4 h-4'} />,
      },
      {
        key: 'zwifttools-bike',
        href: buildZwiftToolsBikeComparisonUrl(cleanActivityId),
        title: 'ZwiftTools Bike Comparison',
        label: 'Open Bike Comparison on ZwiftTools',
        shortLabel: 'Bike Compare',
        icon: <BikeIcon className={showLabels ? 'w-3.5 h-3.5' : 'w-4 h-4'} />,
      },
      {
        key: 'zwifttools-replay',
        href: buildZwiftToolsRaceReplayUrl(cleanActivityId),
        title: 'ZwiftTools Race Replay',
        label: 'Open Race Replay on ZwiftTools',
        shortLabel: 'Race Replay',
        icon: <ReplayIcon className={showLabels ? 'w-3.5 h-3.5' : 'w-4 h-4'} />,
      },
    );
  }

  if (links.length === 0) return null;

  const baseClass =
    'inline-flex items-center justify-center rounded-lg border border-slate-700/80 bg-slate-900/80 text-slate-300 hover:border-[#fc6719]/60 hover:text-[#fc6719] hover:bg-slate-800 transition-colors';
  const sizeClass = showLabels ? 'px-2.5 py-1 text-xs font-medium gap-1.5' : 'p-1.5';

  return (
    <div
      className={`flex flex-wrap items-center ${align === 'start' ? 'justify-start' : 'justify-end'} gap-2`}
    >
      {links.map((link) => (
        <a
          key={link.key}
          href={link.href}
          target="_blank"
          rel="noopener noreferrer"
          title={link.title}
          aria-label={link.label}
          className={`${baseClass} ${sizeClass}`}
        >
          {link.icon}
          {showLabels && <span>{link.shortLabel}</span>}
        </a>
      ))}
    </div>
  );
}
