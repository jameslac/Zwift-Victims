import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ordinal } from '../lib/raceHistory';
import type { UnitSystem } from '../lib/units';

export function Stat({ label, value }: { label: string; value: string | number | undefined }) {
  return (
    <div className="rounded-xl bg-slate-950/70 border border-slate-800 p-4">
      <dt className="text-xs uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-1 text-xl font-bold">{value ?? '—'}</dd>
    </div>
  );
}

export function AttributeList({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="divide-y divide-slate-800 text-sm mt-2">
      {rows.map(([key, value]) => (
        <div key={key} className="flex flex-col sm:flex-row sm:justify-between gap-1 py-2">
          <dt className="font-mono text-slate-400 break-all">{key}</dt>
          <dd className="font-mono sm:text-right break-all">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function AttributeKeysSummary({ label, keys }: { label: string; keys: string[] }) {
  if (keys.length === 0) return null;
  return (
    <details className="rounded-xl bg-slate-950/70 border border-slate-800 p-4">
      <summary className="cursor-pointer text-sm font-medium text-slate-300">
        {label} ({keys.length} keys)
      </summary>
      <ul className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-xs font-mono text-slate-400">
        {keys.map((key) => (
          <li key={key} className="break-all">
            {key}
          </li>
        ))}
      </ul>
    </details>
  );
}

export function MetricGrid({
  items,
}: {
  items: Array<{ label: string; value: string | number | undefined }>;
}) {
  return (
    <dl className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2 text-xs">
      {items.map((item) => (
        <div key={item.label} className="rounded-lg bg-slate-900/70 border border-slate-800/80 p-2">
          <dt className="text-slate-400">{item.label}</dt>
          <dd className="mt-0.5 font-semibold">{item.value ?? '—'}</dd>
        </div>
      ))}
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
