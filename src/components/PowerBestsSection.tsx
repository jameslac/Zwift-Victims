import { useMemo } from 'react';
import type { ZwiftPowerProfile } from '../api/zwiftCore';
import type { ZwiftPowerRaceEntry } from '../api/zwiftPower';
import type { ZwiftRacingRiderResponse } from '../api/zwiftRacing';
import { buildPowerBests } from '../lib/powerBests';
import type { PowerEffort } from '../lib/powerBests';
import { flatten } from '../lib/profileUtils';
import type { AsyncState } from '../lib/profileUtils';
import { AttributeList, MetricGrid } from './ProfileShared';

function pickNumber(obj: Record<string, unknown> | undefined, keys: string[]): number | undefined {
  if (!obj) return undefined;
  for (const key of keys) {
    const val = obj[key];
    if (typeof val === 'number' && Number.isFinite(val) && val > 0) return val;
  }
  return undefined;
}

function formatEffortDate(date: string | number | undefined): string | undefined {
  if (date === undefined || date === null || date === '') return undefined;
  const parsed = typeof date === 'number' ? new Date(date * 1000) : new Date(date);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toLocaleDateString(undefined, { dateStyle: 'medium' });
}

function EffortCell({
  effort,
  emptyLabel = '—',
  prefix = '',
  tag,
}: {
  effort?: PowerEffort;
  emptyLabel?: string;
  prefix?: string;
  tag?: string;
}) {
  if (!effort || (effort.watts === undefined && effort.wkg === undefined)) {
    return <span className="text-slate-500">{emptyLabel}</span>;
  }

  const dateLabel = formatEffortDate(effort.date);
  return (
    <div className="space-y-0.5" title={effort.eventTitle || undefined}>
      <div className="flex flex-wrap items-baseline gap-1.5">
        <span className="font-semibold text-slate-100">
          {effort.watts !== undefined ? `${prefix}${Math.round(effort.watts)} W` : '—'}
        </span>
        {effort.wkg !== undefined && (
          <span className="text-xs text-slate-400">{effort.wkg.toFixed(2)} W/kg</span>
        )}
        {tag && (
          <span className="rounded bg-slate-800 border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-300">
            {tag}
          </span>
        )}
      </div>
      {(dateLabel || effort.eventTitle) && (
        <p className="text-[11px] text-slate-500 truncate max-w-[14rem]">
          {dateLabel}
          {dateLabel && effort.eventTitle ? ' · ' : ''}
          {effort.eventTitle}
        </p>
      )}
    </div>
  );
}

export default function PowerBestsSection({
  isOwnProfile,
  weightGrams,
  powerProfileState,
  zpState,
  zrState,
}: {
  isOwnProfile: boolean;
  weightGrams?: number;
  powerProfileState: AsyncState<ZwiftPowerProfile> | null;
  zpState: AsyncState<ZwiftPowerRaceEntry[]>;
  zrState: AsyncState<ZwiftRacingRiderResponse>;
}) {
  const powerProfile =
    powerProfileState?.status === 'loaded' ? powerProfileState.data : undefined;
  const zpRaces = useMemo(
    () => (zpState.status === 'loaded' ? zpState.data : []),
    [zpState],
  );
  const zrRider = zrState.status === 'loaded' ? zrState.data.rider : undefined;

  const rows = useMemo(
    () =>
      buildPowerBests({
        powerProfile,
        zpRaces,
        zrRider,
        weightGrams,
      }),
    [powerProfile, zpRaces, zrRider, weightGrams],
  );

  const maxPeakWatts = useMemo(
    () => rows.reduce((max, row) => Math.max(max, row.peakWatts ?? 0), 0),
    [rows],
  );

  const rawProfileRows = useMemo(
    () => (powerProfile ? flatten(powerProfile) : []),
    [powerProfile],
  );

  const zftp = pickNumber(powerProfile, ['zftp', 'zFtp', 'zFTP']);
  const zmap = pickNumber(powerProfile, ['zmap', 'zMap', 'zMAP']);
  const vo2max = pickNumber(powerProfile, ['vo2max', 'vo2Max', 'zvo2', 'VO2max']);
  const cp = typeof zrRider?.power?.CP === 'number' ? zrRider.power.CP : undefined;
  const awc = typeof zrRider?.power?.AWC === 'number' ? zrRider.power.AWC : undefined;
  const compoundScore =
    typeof zrRider?.power?.compoundScore === 'number' ? zrRider.power.compoundScore : undefined;

  const awcLabel =
    awc !== undefined
      ? `${(awc < 200 ? awc : awc / 1000).toFixed(1)} kJ`
      : undefined;

  const allLoading =
    (!isOwnProfile || powerProfileState?.status === 'loading') &&
    zpState.status === 'loading' &&
    zrState.status === 'loading';

  return (
    <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-8 space-y-4">
      <div>
        <h2 className="text-lg font-bold">Power Bests (5 sec – 60 min)</h2>
        <p className="text-xs text-slate-400">
          Zwift Feed personal power curve (<code>/api/power-curve/power-profile</code>), ZwiftPower
          all-time race splits &amp; sustained race averages up to 1 hour, and ZwiftRacing 90-day /
          CP-AWC model.
        </p>
      </div>

      {!isOwnProfile && (
        <p className="text-xs text-slate-400">
          Zwift Feed personal power curve is only exposed for your signed-in account; showing
          ZwiftPower and ZwiftRacing bests for this rider.
        </p>
      )}

      {isOwnProfile && powerProfileState?.status === 'error' && (
        <p role="alert" className="text-xs text-amber-400">
          Zwift Feed power profile unavailable ({powerProfileState.message}); showing ZwiftPower and
          ZwiftRacing data.
        </p>
      )}

      <MetricGrid
        items={[
          { label: 'zFTP (Zwift)', value: zftp !== undefined ? `${Math.round(zftp)} W` : undefined },
          { label: 'zMAP (Zwift)', value: zmap !== undefined ? `${Math.round(zmap)} W` : undefined },
          {
            label: 'VO2max (Zwift)',
            value: vo2max !== undefined ? vo2max.toFixed(1) : undefined,
          },
          { label: 'CP (ZR)', value: cp !== undefined ? `${Math.round(cp)} W` : undefined },
          { label: 'AWC (ZR)', value: awcLabel },
          {
            label: 'Compound Score',
            value: compoundScore !== undefined ? compoundScore.toFixed(0) : undefined,
          },
        ]}
      />

      {allLoading ? (
        <p className="text-sm text-slate-400">Loading power bests…</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/60">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400 uppercase tracking-wide text-[11px]">
                <th className="py-2.5 px-3 font-medium">Duration</th>
                {isOwnProfile && <th className="py-2.5 px-3 font-medium">Zwift Feed (All-Time)</th>}
                {isOwnProfile && <th className="py-2.5 px-3 font-medium">Zwift Feed (Recent)</th>}
                <th className="py-2.5 px-3 font-medium">ZwiftPower Race Best</th>
                <th className="py-2.5 px-3 font-medium">ZwiftRacing (90d / CP)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80">
              {rows.map((row) => {
                const barPct =
                  maxPeakWatts > 0 && row.peakWatts
                    ? Math.max(4, Math.round((row.peakWatts / maxPeakWatts) * 100))
                    : 0;
                return (
                  <tr key={row.seconds} className="hover:bg-slate-900/50 align-top">
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      <div className="font-semibold text-slate-200">{row.label}</div>
                      {barPct > 0 && (
                        <div className="mt-1 h-1.5 w-24 rounded-full bg-slate-800 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-[#fc6719]"
                            style={{ width: `${barPct}%` }}
                          />
                        </div>
                      )}
                    </td>
                    {isOwnProfile && (
                      <td className="py-2.5 px-3">
                        <EffortCell effort={row.zwiftAllTime} />
                      </td>
                    )}
                    {isOwnProfile && (
                      <td className="py-2.5 px-3">
                        <EffortCell effort={row.zwiftRecent} />
                      </td>
                    )}
                    <td className="py-2.5 px-3">
                      <EffortCell
                        effort={row.zpRaceBest}
                        tag={row.zpRaceBest?.isSustainedRaceAvg ? 'race avg' : undefined}
                      />
                    </td>
                    <td className="py-2.5 px-3">
                      {row.zr90d ? (
                        <EffortCell effort={row.zr90d} />
                      ) : row.zrCpModel ? (
                        <EffortCell effort={row.zrCpModel} prefix="~" tag="CP model" />
                      ) : (
                        <span className="text-slate-500">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {isOwnProfile && powerProfileState?.status === 'loaded' && rawProfileRows.length > 0 && (
        <details className="rounded-xl bg-slate-950/60 border border-slate-800 p-3">
          <summary className="cursor-pointer text-xs text-slate-300 font-medium">
            All Zwift Power Profile (<code>/api/power-curve/power-profile</code>) attributes (
            {rawProfileRows.length} fields)
          </summary>
          <AttributeList rows={rawProfileRows} />
        </details>
      )}
    </section>
  );
}
