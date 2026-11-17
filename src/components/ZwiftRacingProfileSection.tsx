import { useMemo } from 'react';
import type { CSSProperties } from 'react';
import type { ZwiftRacingRiderResponse } from '../api/zwiftRacing';
import { flatten } from '../lib/profileUtils';
import type { AsyncState } from '../lib/useRiderRaceHistory';
import { AttributeList, MetricGrid } from './ProfileShared';

function fmtNum(v: unknown, decimals = 1, suffix = ''): string | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
  return `${v.toFixed(decimals)}${suffix}`;
}

function fmtPct(numerator: number | undefined, denominator: number | undefined): string | undefined {
  if (
    typeof numerator !== 'number' ||
    typeof denominator !== 'number' ||
    !Number.isFinite(numerator) ||
    !Number.isFinite(denominator) ||
    denominator <= 0
  ) {
    return undefined;
  }
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

function safeHexColor(color: unknown): string | undefined {
  if (typeof color !== 'string') return undefined;
  const trimmed = color.trim();
  return /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(trimmed) ? trimmed : undefined;
}

function FactorGroup({
  title,
  record,
}: {
  title: string;
  record: Record<string, unknown> | undefined;
}) {
  if (!record) return null;
  const rawEntries = Object.entries(record).filter(([, val]) => val !== undefined && val !== null);
  if (rawEntries.length === 0) return null;
  const entries = rawEntries.flatMap(([key, val]) =>
    typeof val === 'object' ? flatten(val, key) : [[key, val] as [string, unknown]],
  );

  return (
    <div className="rounded-xl bg-slate-950/60 border border-slate-800 p-3 space-y-2">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</h4>
      <dl className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 text-xs">
        {entries.map(([key, val]) => (
          <div key={key} className="rounded-lg bg-slate-900/70 border border-slate-800/80 p-2">
            <dt className="text-slate-400 font-mono truncate" title={key}>
              {key}
            </dt>
            <dd className="mt-0.5 font-semibold break-all">
              {typeof val === 'number' && Number.isFinite(val)
                ? Number.isInteger(val)
                  ? val
                  : val.toFixed(3)
                : String(val)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export default function ZwiftRacingProfileSection({
  profileId,
  zrState,
}: {
  profileId: number;
  zrState: AsyncState<ZwiftRacingRiderResponse>;
}) {
  const rider = zrState.status === 'loaded' ? zrState.data.rider : null;
  const overview = zrState.status === 'loaded' ? zrState.data.overview : null;

  const rawRows = useMemo(() => {
    if (zrState.status !== 'loaded') return [];
    const overviewSummary = overview
      ? Object.fromEntries(
          Object.entries(overview).filter(([k]) => k !== 'history' && k !== 'latest'),
        )
      : null;
    return flatten({ rider, overview: overviewSummary });
  }, [zrState, rider, overview]);

  const phenotypeScores = useMemo(() => {
    const scores = rider?.phenotype?.scores;
    if (!scores || typeof scores !== 'object') return [];
    return Object.entries(scores).filter(
      ([, v]) => typeof v === 'number' && Number.isFinite(v),
    ) as [string, number][];
  }, [rider]);

  const maxPhenotypeScore = useMemo(
    () => phenotypeScores.reduce((max, [, v]) => Math.max(max, Math.abs(v)), 0),
    [phenotypeScores],
  );

  if (zrState.status === 'loading') {
    return (
      <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-8 space-y-3">
        <h2 className="text-lg font-bold">ZwiftRacing.app Profile</h2>
        <p className="text-sm text-slate-400">Loading ZwiftRacing.app profile attributes…</p>
      </section>
    );
  }

  if (zrState.status === 'error') {
    return (
      <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-8 space-y-3">
        <h2 className="text-lg font-bold">ZwiftRacing.app Profile</h2>
        <p role="alert" className="text-sm text-amber-400">
          ZwiftRacing.app unavailable ({zrState.message}).
        </p>
      </section>
    );
  }

  if (!rider && !overview) {
    return (
      <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-8 space-y-3">
        <h2 className="text-lg font-bold">ZwiftRacing.app Profile</h2>
        <p className="text-sm text-slate-400">
          No ZwiftRacing.app profile found for rider {profileId}.
        </p>
      </section>
    );
  }

  const club = rider?.club;
  const clubStyle: CSSProperties | undefined = club
    ? {
        backgroundColor: safeHexColor(club.backgroundColor),
        color: safeHexColor(club.textColor),
        borderColor: safeHexColor(club.borderColor),
      }
    : undefined;

  const finishes = rider?.race?.finishes;
  const wins = rider?.race?.wins;
  const podiums = rider?.race?.podiums;
  const dnfs = rider?.race?.dnfs;
  const winPct = fmtPct(wins, finishes);
  const podiumPct = fmtPct(podiums, finishes);

  const awc = rider?.power?.AWC;
  const awcFormatted =
    typeof awc === 'number' && Number.isFinite(awc)
      ? `${(awc < 200 ? awc : awc / 1000).toFixed(1)} kJ`
      : undefined;

  const legacyLive = fmtNum(overview?.legacyRatings?.live, 0);
  const legacy30 = fmtNum(overview?.legacyRatings?.max30, 0);
  const legacy90 = fmtNum(overview?.legacyRatings?.max90, 0);
  const legacyRange =
    legacy30 || legacy90 ? `${legacy30 ?? '—'} / ${legacy90 ?? '—'}` : undefined;

  const triageGroups = [
    {
      heading: 'Keep as At-a-Glance Profile Highlights',
      items: [
        {
          name: 'vELO (race / max30 / max90)',
          status: rider?.velo?.race != null ? `${rider.velo.race.toFixed(1)}` : 'missing',
          reason: 'Core skill rating & recent peak tier.',
        },
        {
          name: 'Phenotype (label + bias)',
          status: rider?.phenotype?.label
            ? `${rider.phenotype.label}${rider.phenotype.bias != null ? ` (${rider.phenotype.bias})` : ''}`
            : 'missing',
          reason: 'Immediate rider archetype badge.',
        },
        {
          name: 'Compound Score / Power Rating',
          status:
            rider?.power?.compoundScore != null
              ? `${rider.power.compoundScore.toFixed(0)}`
              : 'missing',
          reason: 'Summarizes absolute + W/kg flat/sprint strength.',
        },
        {
          name: 'CP & AWC',
          status:
            rider?.power?.CP != null
              ? `${Math.round(rider.power.CP)} W${awcFormatted ? ` / ${awcFormatted}` : ''}`
              : 'missing',
          reason: 'Critical power threshold and anaerobic reserve.',
        },
        {
          name: 'Career Race Totals (finishes / wins / podiums / dnfs)',
          status: finishes != null ? `${finishes} / ${wins ?? 0} / ${podiums ?? 0} / ${dnfs ?? 0}` : 'missing',
          reason: 'Clean career snapshot with win & podium percentages.',
        },
        {
          name: 'Club & ZP Category / FTP',
          status: club?.name || rider?.zpCategory ? `${club?.name ?? 'No club'} · Cat ${rider?.zpCategory ?? '—'}` : 'missing',
          reason: 'Team affiliation badge and ZP baseline.',
        },
      ],
    },
    {
      heading: 'Make Fancier with Charts',
      items: [
        {
          name: 'Phenotype Scores (phenotype.scores.*)',
          status: phenotypeScores.length > 0 ? `${phenotypeScores.length} axes` : 'empty',
          reason: 'Radar / spider chart or horizontal profile bars showing Sprinter vs Climber balance.',
        },
        {
          name: 'Power Curve + CP/AWC Curve (power.w5–w1200 + CP + AWC)',
          status: rider?.power?.w5 != null ? 'populated' : 'missing',
          reason: 'Interactive log-scale power-duration curve comparing actual bests vs CP/AWC model.',
        },
        {
          name: 'vELO History & Peak Bands (overview.history + max30/max90)',
          status: (overview?.history?.length ?? 0) > 0 ? `${overview?.history?.length} races` : 'empty',
          reason: 'Time-series line chart of vELO progression with 30d/90d peak reference bands.',
        },
        {
          name: 'vELO Tier Gauge & Skill Multipliers (velo.race, velo.skill.*)',
          status: rider?.velo?.race != null ? 'populated' : 'missing',
          reason: 'Tier gauge (Emerald → Diamond) and skill/factor breakdown.',
        },
      ],
    },
    {
      heading: 'Internal / Secondary (Keep Collapsed or Drop)',
      items: [
        {
          name: 'TT / Handicap / Seed / Legacy vELO',
          status:
            rider?.velo?.timeTrial != null || legacyLive != null ? 'populated' : 'partial/empty',
          reason: 'Niche or deprecated compared to primary v2 race vELO.',
        },
        {
          name: 'seed.factors.* & legacyRatings.max30Expires / max90Expires',
          status: rider?.seed?.factors ? 'populated' : 'empty',
          reason: 'Internal rating math/expiry timestamps; noisy on main profile.',
        },
        {
          name: 'riderId, imageSrc, phenotype.version, visibility, optOut, banned',
          status: rider?.visibility ?? 'present',
          reason: 'Metadata/status flags (only surface banned/optOut if true).',
        },
      ],
    },
  ];

  return (
    <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-8 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">ZwiftRacing.app Profile</h2>
          <p className="text-xs text-slate-400">
            All rider attributes &amp; ratings from{' '}
            <code>zwiftracing.app/riders/{profileId}</code>.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {club?.name && (
            <span
              className="rounded-full border border-slate-700 bg-slate-800 px-3 py-0.5 text-xs font-semibold text-slate-100"
              style={clubStyle}
            >
              {club.name}
            </span>
          )}
          {rider?.zpCategory && (
            <span className="rounded-full bg-[#fc6719]/20 border border-[#fc6719]/40 px-2.5 py-0.5 text-xs font-semibold text-[#fc6719]">
              ZP Cat {rider.zpCategory}
            </span>
          )}
          {rider?.country && (
            <span className="rounded-full bg-slate-800 border border-slate-700 px-2.5 py-0.5 text-xs text-slate-300 uppercase">
              {rider.country}
            </span>
          )}
          {rider?.age && (
            <span className="rounded-full bg-slate-800 border border-slate-700 px-2.5 py-0.5 text-xs text-slate-300">
              Age {rider.age}
            </span>
          )}
          {rider?.visibility && (
            <span className="rounded-full bg-slate-800 border border-slate-700 px-2.5 py-0.5 text-xs text-slate-300">
              {rider.visibility}
            </span>
          )}
          {rider?.banned && (
            <span className="rounded-full bg-red-500/20 border border-red-500/40 px-2.5 py-0.5 text-xs font-semibold text-red-300">
              Banned
            </span>
          )}
          {rider?.optOut && (
            <span className="rounded-full bg-amber-500/20 border border-amber-500/40 px-2.5 py-0.5 text-xs font-semibold text-amber-300">
              Opted Out
            </span>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          vELO &amp; Ratings
        </h3>
        <MetricGrid
          columnsClass="grid-cols-2 sm:grid-cols-3 md:grid-cols-5"
          items={[
            { label: 'vELO (Race)', value: fmtNum(rider?.velo?.race, 1) },
            { label: 'vELO 30d Max', value: fmtNum(rider?.velo?.max30, 1) },
            { label: 'vELO 90d Max', value: fmtNum(rider?.velo?.max90, 1) },
            { label: 'Time Trial vELO', value: fmtNum(rider?.velo?.timeTrial, 1) },
            { label: 'Handicap vELO', value: fmtNum(rider?.velo?.handicap, 1) },
            { label: 'Seed Race vELO', value: fmtNum(rider?.seed?.race, 1) },
            { label: 'Legacy vELO (Live)', value: legacyLive },
            { label: 'Legacy 30d / 90d', value: legacyRange },
            { label: 'GC Overall Place', value: overview?.gcOverallPlace ?? undefined },
            { label: 'History Window', value: overview?.days != null ? `${overview.days}d` : undefined },
          ]}
        />
      </div>

      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          Phenotype &amp; Physiology
        </h3>
        <MetricGrid
          columnsClass="grid-cols-2 sm:grid-cols-3 md:grid-cols-5"
          items={[
            { label: 'Phenotype', value: rider?.phenotype?.label },
            { label: 'Phenotype Value', value: fmtNum(rider?.phenotype?.value, 2) },
            { label: 'Phenotype Bias', value: fmtNum(rider?.phenotype?.bias, 2) },
            {
              label: 'Confidence',
              value:
                typeof rider?.phenotype?.confidence === 'number'
                  ? `${Math.round(rider.phenotype.confidence * (rider.phenotype.confidence <= 1 ? 100 : 1))}%`
                  : undefined,
            },
            { label: 'Compound Score', value: fmtNum(rider?.power?.compoundScore, 0) },
            { label: 'Power Rating', value: fmtNum(rider?.power?.powerRating, 1) },
            {
              label: 'Critical Power (CP)',
              value: rider?.power?.CP != null ? `${Math.round(rider.power.CP)} W` : undefined,
            },
            { label: 'Anaerobic Work (AWC)', value: awcFormatted },
            { label: 'ZP Category', value: rider?.zpCategory },
            { label: 'ZP FTP', value: rider?.zpFTP != null ? `${Math.round(rider.zpFTP)} W` : undefined },
          ]}
        />

        {phenotypeScores.length > 0 && (
          <div className="rounded-xl bg-slate-950/60 border border-slate-800 p-3 space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Phenotype Scores Breakdown
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
              {phenotypeScores.map(([key, score]) => {
                const widthPct =
                  maxPhenotypeScore > 0
                    ? Math.max(4, Math.round((Math.abs(score) / maxPhenotypeScore) * 100))
                    : 0;
                return (
                  <div key={key} className="space-y-1">
                    <div className="flex justify-between">
                      <span className="capitalize text-slate-300">{key}</span>
                      <span className="font-mono font-semibold text-slate-200">
                        {Number.isInteger(score) ? score : score.toFixed(2)}
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-[#fc6719]"
                        style={{ width: `${widthPct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          Career Race Totals
        </h3>
        <MetricGrid
          columnsClass="grid-cols-2 sm:grid-cols-4"
          items={[
            { label: 'Finishes', value: finishes },
            { label: 'Wins', value: wins != null ? `${wins}${winPct ? ` (${winPct})` : ''}` : undefined },
            {
              label: 'Podiums',
              value: podiums != null ? `${podiums}${podiumPct ? ` (${podiumPct})` : ''}` : undefined,
            },
            { label: 'DNFs', value: dnfs },
          ]}
        />
      </div>

      <div className="space-y-3">
        <FactorGroup title="vELO Factors (velo.factors)" record={rider?.velo?.factors} />
        <FactorGroup title="Skill Multipliers (velo.skill)" record={rider?.velo?.skill} />
        <FactorGroup title="Seed Factors (seed.factors)" record={rider?.seed?.factors} />
        <FactorGroup title="Series Points (rider.points)" record={rider?.points} />
        <FactorGroup title="Rankings (overview.rankings)" record={overview?.rankings} />
      </div>

      <details open className="rounded-xl bg-slate-950/60 border border-slate-800 p-4 space-y-3">
        <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-slate-300">
          Attribute Triage &amp; Chart Candidates (Review List)
        </summary>
        <div className="space-y-4 pt-2 text-xs">
          {triageGroups.map((group) => (
            <div key={group.heading} className="space-y-1.5">
              <h4 className="font-semibold text-slate-200">{group.heading}</h4>
              <ul className="divide-y divide-slate-800/80 rounded-lg border border-slate-800 bg-slate-900/50">
                {group.items.map((item) => (
                  <li
                    key={item.name}
                    className="p-2.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1"
                  >
                    <div>
                      <span className="font-medium text-slate-100">{item.name}</span>
                      <p className="text-slate-400">{item.reason}</p>
                    </div>
                    <span className="self-start sm:self-center shrink-0 rounded-full bg-slate-800 border border-slate-700 px-2 py-0.5 font-mono text-[11px] text-slate-300">
                      {item.status}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </details>

      <details className="rounded-xl bg-slate-950/60 border border-slate-800 p-3">
        <summary className="cursor-pointer text-xs text-slate-300 font-medium">
          All ZwiftRacing profile &amp; overview attributes ({rawRows.length} fields)
        </summary>
        <AttributeList rows={rawRows} />
      </details>
    </section>
  );
}
