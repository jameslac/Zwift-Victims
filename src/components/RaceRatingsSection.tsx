import type { ZwiftPowerRaceEntry } from '../api/zwiftPower';
import type {
  ZwiftRacingEventPen,
  ZwiftRacingEventRider,
  ZwiftRacingRaceEntry,
} from '../api/zwiftRacing';

type Tone = 'positive' | 'negative' | undefined;

const FACTOR_LABELS: Record<string, string> = {
  flat: 'Flat',
  rolling: 'Rolling',
  hilly: 'Hilly',
  mountainous: 'Mountainous',
  climb: 'Climb',
  sprint: 'Sprint',
  punch: 'Punch',
  pursuit: 'Pursuit',
  endurance: 'Endurance',
  tt: 'Time Trial',
  timetrial: 'Time Trial',
  race: 'Race',
};

function parseFiniteNum(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string') {
    const trimmed = v.trim();
    if (!trimmed) return undefined;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function deltaTone(val: number | undefined): Tone {
  if (val == null || !Number.isFinite(val) || val === 0) return undefined;
  return val > 0 ? 'positive' : 'negative';
}

function formatSigned(val: number, decimals: number): string {
  const fixed = Math.abs(val).toFixed(decimals);
  if (val > 0) return `+${fixed}`;
  if (val < 0) return `-${fixed}`;
  return fixed;
}

function humanizeFactorKey(key: string): string {
  const compact = key.trim().toLowerCase().replace(/[\s_-]+/g, '');
  if (FACTOR_LABELS[compact]) return FACTOR_LABELS[compact];
  return key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function formatFactorNumber(n: number): string {
  return Math.abs(n) < 10 ? n.toFixed(2) : n.toFixed(1);
}

function cardToneClasses(tone: Tone): string {
  if (tone === 'positive') return 'bg-emerald-500/10 border-emerald-500/30';
  if (tone === 'negative') return 'bg-red-500/10 border-red-500/30';
  return 'bg-slate-950/70 border-slate-800';
}

function badgeToneClasses(tone: Tone): string {
  if (tone === 'positive') return 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300';
  if (tone === 'negative') return 'bg-red-500/20 border-red-500/40 text-red-300';
  return 'bg-slate-800 border-slate-700 text-slate-300';
}

function MovementCard({
  label,
  badgeText,
  badgeTitle,
  mainText,
  subText,
  subTitle,
  tone,
}: {
  label: string;
  badgeText?: string;
  badgeTitle?: string;
  mainText: string;
  subText: string;
  subTitle?: string;
  tone?: Tone;
}) {
  return (
    <div className={`rounded-xl border p-4 space-y-1.5 ${cardToneClasses(tone)}`}>
      <div className="flex items-start justify-between gap-2">
        <span className="text-[11px] uppercase tracking-wide font-semibold text-slate-400">
          {label}
        </span>
        {badgeText && (
          <span
            title={badgeTitle}
            className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold font-mono ${badgeToneClasses(tone)}`}
          >
            {badgeText}
          </span>
        )}
      </div>
      <p className="text-lg font-bold font-mono text-slate-100">{mainText}</p>
      <p className="text-[11px] text-slate-400" title={subTitle}>
        {subText}
      </p>
    </div>
  );
}

export default function RaceRatingsSection({
  zrEntry,
  zrEventRider,
  zrEventPen,
  bestZpEntry,
  coreZrs,
  fallbackZrsScore,
  bestVerifiedPlace,
}: {
  zrEntry?: ZwiftRacingRaceEntry;
  zrEventRider?: ZwiftRacingEventRider;
  zrEventPen?: ZwiftRacingEventPen;
  bestZpEntry?: ZwiftPowerRaceEntry;
  coreZrs: {
    score?: number;
    previousScore?: number;
    delta?: number;
    changeType?: string;
    hasEventScore?: boolean;
  };
  fallbackZrsScore?: number | null;
  bestVerifiedPlace?: number;
}) {
  // 1. ZwiftRacing vELO
  const eloBefore = parseFiniteNum(zrEntry?.velo?.elo?.before ?? zrEventRider?.velo?.elo?.before);
  const eloAfter = parseFiniteNum(
    zrEntry?.velo?.elo?.after ?? zrEventRider?.velo?.elo?.after ?? zrEventRider?.riderVelo?.race,
  );
  const eloAdjDelta = parseFiniteNum(
    zrEntry?.velo?.elo?.adjustedChange ?? zrEventRider?.velo?.elo?.adjustedChange,
  );
  const eloRawDelta = parseFiniteNum(
    zrEntry?.velo?.elo?.rawChange ?? zrEventRider?.velo?.elo?.rawChange,
  );
  const eloDeltaVal =
    eloBefore != null && eloAfter != null ? eloAfter - eloBefore : eloAdjDelta;
  const hasVelo = eloBefore != null || eloAfter != null || eloAdjDelta != null;

  // 2. Zwift Racing Score (ZRS)
  const zrsScore = coreZrs.score ?? parseFiniteNum(fallbackZrsScore);
  const zrsPrev = coreZrs.previousScore;
  const zrsDelta = coreZrs.delta;
  const hasZrs = zrsScore != null;
  const zrsChanged = zrsDelta != null && Math.abs(zrsDelta) >= 0.05;

  // 3. ZwiftPower Rank (lower score = better rank; negative gain = improved)
  const zpSkillNum = parseFiniteNum(bestZpEntry?.skill);
  const zpSkillBeforeNum = parseFiniteNum(bestZpEntry?.skill_b);
  const zpSkillGainNum = parseFiniteNum(bestZpEntry?.skill_gain);
  const hasZpRank = zpSkillNum != null || zpSkillBeforeNum != null || zpSkillGainNum != null;
  const zpChanged = zpSkillGainNum != null && Math.abs(zpSkillGainNum) >= 0.05;
  const zpTone = zpChanged ? deltaTone(-zpSkillGainNum!) : undefined;

  // 4. vELO Legacy (v1)
  const legacyBefore = parseFiniteNum(zrEntry?.legacy?.ratingBefore ?? zrEventRider?.ratingBefore);
  const legacyAfter = parseFiniteNum(zrEntry?.legacy?.rating ?? zrEventRider?.rating);
  const legacyDelta =
    parseFiniteNum(zrEntry?.legacy?.ratingDelta ?? zrEventRider?.ratingDelta) ??
    (legacyBefore != null && legacyAfter != null ? legacyAfter - legacyBefore : undefined);
  const hasLegacy = legacyBefore != null || legacyAfter != null;

  const hasAnyMovement = hasVelo || hasZrs || hasZpRank || hasLegacy;

  // Terrain & Skill Factor Adjustments
  const eloFactorsMap = zrEntry?.velo?.elo?.factors ?? zrEventRider?.velo?.elo?.factors;
  const eloFactors = eloFactorsMap ? Object.entries(eloFactorsMap) : [];

  // Context & Points: True Pen SOF vs Rider Course vELO
  const penRatedVelos = (zrEventPen?.riders ?? [])
    .map((r) => parseFiniteNum(r.velo?.elo?.eventRating ?? r.velo?.elo?.before ?? r.riderVelo?.race))
    .filter((n): n is number => n !== undefined && n > 0);
  const penAvgVelo =
    penRatedVelos.length > 0
      ? penRatedVelos.reduce((acc, n) => acc + n, 0) / penRatedVelos.length
      : undefined;
  const riderCourseVelo = parseFiniteNum(
    zrEntry?.velo?.elo?.eventRating ?? zrEventRider?.velo?.elo?.eventRating,
  );
  const riderRefVelo =
    riderCourseVelo ?? eloBefore ?? parseFiniteNum(zrEventRider?.riderVelo?.race);
  const legacyPenAvg = parseFiniteNum(zrEventPen?.results?.averageRating);

  // Course-weighted vELO v2 expectation vs Seed & Overall/Legacy expectations
  const eventExpectedPos = parseFiniteNum(
    zrEntry?.velo?.elo?.expectedPosition ?? zrEventRider?.velo?.elo?.expectedPosition,
  );
  const overallExpectedPos = parseFiniteNum(zrEventRider?.expectedPosition);
  const expectedPos = eventExpectedPos ?? overallExpectedPos;
  const seedExpectedPos = parseFiniteNum(
    zrEntry?.velo?.seed?.expectedPosition ?? zrEventRider?.velo?.seed?.expectedPosition,
  );
  const expectedRange = zrEventRider?.expectedPlaceRange;
  const expectedBeat =
    bestVerifiedPlace != null && expectedPos != null
      ? Math.round(expectedPos) - bestVerifiedPlace
      : undefined;

  const expectedSubParts: string[] = [];
  if (expectedPos != null) {
    const baseText =
      eventExpectedPos != null
        ? `Course-weighted vELO est. ${eventExpectedPos.toFixed(1)}`
        : `Overall est. ${overallExpectedPos!.toFixed(1)}`;
    expectedSubParts.push(
      expectedRange?.low != null && expectedRange?.high != null
        ? `${baseText} (range ${expectedRange.low}–${expectedRange.high})`
        : baseText,
    );
  }
  if (seedExpectedPos != null) {
    expectedSubParts.push(`Seed est. ${seedExpectedPos.toFixed(1)}`);
  }
  if (
    eventExpectedPos != null &&
    overallExpectedPos != null &&
    Math.round(eventExpectedPos) !== Math.round(overallExpectedPos)
  ) {
    expectedSubParts.push(`Overall/Legacy est. #${Math.round(overallExpectedPos)}`);
  }

  const intensity = parseFiniteNum(zrEntry?.velo?.intensity ?? zrEventRider?.velo?.intensity);

  const zrPointsObj =
    zrEntry?.velo?.points ??
    (zrEventRider?.velo as { points?: ZwiftRacingRaceEntry['velo'] extends infer _ ? Record<string, unknown> : never } | undefined)
      ?.points;
  const zrPointsTotal = parseFiniteNum(zrPointsObj?.value);
  const zrPointDisciplines = (
    [
      { label: 'GC', value: parseFiniteNum(zrPointsObj?.gc) },
      { label: 'Sprint', value: parseFiniteNum(zrPointsObj?.sprint) },
      { label: 'Climb', value: parseFiniteNum(zrPointsObj?.climb) },
      { label: 'TT', value: parseFiniteNum(zrPointsObj?.tt) },
    ] as const
  ).filter((d): d is { label: typeof d.label; value: number } => d.value != null);
  const hasZrPoints = zrPointsTotal != null || zrPointDisciplines.length > 0;

  const zpPtsNum = parseFiniteNum(bestZpEntry?.pts);
  const hasZpPts = zpPtsNum != null && zpPtsNum > 0;

  const hasSofTile = penAvgVelo != null || legacyPenAvg != null || riderCourseVelo != null;
  const hasContext =
    expectedPos != null || hasSofTile || intensity != null || hasZrPoints || hasZpPts;

  return (
    <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-8 space-y-6">
      <div>
        <h2 className="text-lg font-bold">Ratings &amp; Performance Impact</h2>
        <p className="text-xs text-slate-400 mt-1">
          How this race moved your ratings, terrain skill factors, and event difficulty context.
        </p>
      </div>

      {!hasAnyMovement && eloFactors.length === 0 && !hasContext ? (
        <p className="text-sm text-slate-400">
          No rating movements or scoring adjustments recorded for this race.
        </p>
      ) : (
        <>
          {/* Part A: Rating Movement Cards */}
          {hasAnyMovement && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {hasVelo && (
                <MovementCard
                  label="ZwiftRacing vELO"
                  tone={deltaTone(eloDeltaVal)}
                  badgeText={
                    eloDeltaVal != null
                      ? Math.abs(eloDeltaVal) >= 0.05
                        ? `${eloDeltaVal > 0 ? '▲' : '▼'} ${formatSigned(eloDeltaVal, 1)}`
                        : '0.0'
                      : undefined
                  }
                  mainText={
                    eloBefore != null && eloAfter != null
                      ? `${eloBefore.toFixed(1)} → ${eloAfter.toFixed(1)}`
                      : eloAfter != null
                        ? eloAfter.toFixed(1)
                        : eloBefore != null
                          ? eloBefore.toFixed(1)
                          : formatSigned(eloAdjDelta!, 1)
                  }
                  subText={
                    eloRawDelta != null &&
                    eloAdjDelta != null &&
                    Math.abs(eloRawDelta - eloAdjDelta) >= 0.05
                      ? `Raw Δ ${formatSigned(eloRawDelta, 2)} · Adjusted ${formatSigned(eloAdjDelta, 2)}`
                      : 'Skill rating (higher is better)'
                  }
                  subTitle={
                    eloRawDelta != null && eloAdjDelta != null
                      ? 'Raw change from finish vs. expected rank, before field-size, podium, and power-best adjustments'
                      : undefined
                  }
                />
              )}

              {hasZrs && (
                <MovementCard
                  label="Zwift Racing Score"
                  tone={zrsChanged ? deltaTone(zrsDelta) : undefined}
                  badgeText={
                    zrsChanged
                      ? `${zrsDelta! > 0 ? '▲' : '▼'} ${
                          Math.abs(zrsDelta!) < 1
                            ? formatSigned(zrsDelta!, 1)
                            : formatSigned(Math.round(zrsDelta!), 0)
                        }`
                      : zrsPrev != null && coreZrs.score != null
                        ? 'No change'
                        : undefined
                  }
                  mainText={
                    zrsPrev != null && coreZrs.score != null && zrsChanged
                      ? `${Math.round(zrsPrev)} → ${Math.round(coreZrs.score)}`
                      : String(Math.round(zrsScore!))
                  }
                  subText={
                    zrsPrev != null && coreZrs.score != null
                      ? !zrsChanged
                        ? coreZrs.changeType
                          ? `${coreZrs.changeType} · Unchanged in this event`
                          : 'Unchanged in this event (0–1000)'
                        : coreZrs.changeType
                          ? `${coreZrs.changeType} · Zwift pen score (0–1000, higher is better)`
                          : 'Zwift pen score (0–1000, higher is better)'
                      : coreZrs.hasEventScore
                        ? 'Event ZRS · per-race delta not returned by Zwift'
                        : 'Current profile ZRS · per-race change only returned on ZRS-ranked events'
                  }
                />
              )}

              {hasZpRank && (
                <MovementCard
                  label="ZwiftPower Rank"
                  tone={zpTone}
                  badgeText={
                    zpChanged
                      ? zpSkillGainNum! < 0
                        ? `↓ ${Math.abs(zpSkillGainNum!).toFixed(1)} improved`
                        : `↑ +${zpSkillGainNum!.toFixed(1)}`
                      : 'No change'
                  }
                  badgeTitle={
                    zpChanged
                      ? 'Change in your 5-best 90-day ZwiftPower ranking (lower score = stronger rank)'
                      : "Result didn't replace your top-5 90-day average"
                  }
                  mainText={
                    zpSkillBeforeNum != null && zpChanged
                      ? `${zpSkillBeforeNum.toFixed(1)} → ${(zpSkillBeforeNum + zpSkillGainNum!).toFixed(1)}`
                      : zpSkillBeforeNum != null
                        ? zpSkillBeforeNum.toFixed(1)
                        : zpSkillNum!.toFixed(1)
                  }
                  subText={`${zpSkillNum != null ? `Race score ${zpSkillNum.toFixed(1)} · ` : ''}Lower is better (best 5 in 90d)`}
                />
              )}

              {hasLegacy && (
                <MovementCard
                  label="vELO Legacy (v1)"
                  tone={deltaTone(legacyDelta)}
                  badgeText={
                    legacyDelta != null && Math.abs(legacyDelta) >= 0.05
                      ? `${legacyDelta > 0 ? '▲' : '▼'} ${formatSigned(legacyDelta, 1)}`
                      : undefined
                  }
                  mainText={
                    legacyBefore != null && legacyAfter != null
                      ? `${legacyBefore.toFixed(0)} → ${legacyAfter.toFixed(0)}`
                      : (legacyAfter ?? legacyBefore)!.toFixed(0)
                  }
                  subText="Classic v1 scale (higher is better)"
                />
              )}
            </div>
          )}

          {/* Part B: Terrain & Skill Factor Adjustments */}
          {eloFactors.length > 0 && (
            <div className="space-y-2.5">
              <div>
                <h3 className="text-xs uppercase tracking-wide text-slate-400 font-semibold">
                  Terrain &amp; Skill Factor Adjustments
                </h3>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Individual terrain and discipline multipliers adjusted by ZwiftRacing after this
                  race.
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                {eloFactors.map(([rawKey, val]) => {
                  const rec =
                    val && typeof val === 'object' && !Array.isArray(val)
                      ? (val as Record<string, unknown>)
                      : null;
                  const before = rec ? parseFiniteNum(rec.before) : undefined;
                  const after = rec ? parseFiniteNum(rec.after) : undefined;
                  const explicitDelta = rec ? parseFiniteNum(rec.skillDelta) : undefined;
                  const diff =
                    explicitDelta ??
                    (before != null && after != null ? after - before : undefined);
                  const numericVal = !rec ? parseFiniteNum(val) : undefined;

                  const tone = deltaTone(diff);
                  const decimals = before != null && Math.abs(before) < 10 ? 2 : 1;
                  const valueText =
                    before != null && after != null
                      ? `${formatFactorNumber(before)} → ${formatFactorNumber(after)}`
                      : numericVal != null
                        ? formatFactorNumber(numericVal)
                        : after != null
                          ? formatFactorNumber(after)
                          : String(val);

                  return (
                    <div
                      key={rawKey}
                      className={`rounded-xl border px-3.5 py-2.5 flex items-center justify-between gap-2 ${cardToneClasses(tone)}`}
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-slate-300">
                          {humanizeFactorKey(rawKey)}
                        </p>
                        <p className="text-xs font-mono text-slate-100 mt-0.5 truncate">
                          {valueText}
                        </p>
                      </div>
                      {diff != null && Math.abs(diff) >= 0.005 && (
                        <span
                          className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold font-mono ${badgeToneClasses(tone)}`}
                        >
                          {diff > 0 ? '▲' : '▼'} {formatSigned(diff, decimals)}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Part C: Race Difficulty & Event Points */}
          {hasContext && (
            <div className="space-y-2.5">
              <h3 className="text-xs uppercase tracking-wide text-slate-400 font-semibold">
                Race Difficulty &amp; Event Points
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {expectedPos != null && (
                  <div
                    className={`rounded-xl border p-3.5 space-y-1 ${cardToneClasses(deltaTone(expectedBeat))}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] uppercase tracking-wide text-slate-400 font-semibold">
                        Expected vs. Actual Finish
                      </span>
                      {expectedBeat != null && (
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${badgeToneClasses(deltaTone(expectedBeat))}`}
                        >
                          {expectedBeat > 0
                            ? `Beat by ${expectedBeat}`
                            : expectedBeat < 0
                              ? `Missed by ${Math.abs(expectedBeat)}`
                              : 'On target'}
                        </span>
                      )}
                    </div>
                    <p className="text-base font-bold font-mono text-slate-100">
                      Est. #{Math.round(expectedPos)}
                    </p>
                    <p className="text-[11px] text-slate-400">{expectedSubParts.join(' · ')}</p>
                  </div>
                )}

                {penAvgVelo != null ? (
                  (() => {
                    const sofDiff = riderRefVelo != null ? riderRefVelo - penAvgVelo : undefined;
                    let badgeText: string | undefined;
                    let badgeCls = 'bg-slate-800 border-slate-700 text-slate-300';
                    let subText = `Avg pen vELO across ${penRatedVelos.length} rated riders`;
                    if (sofDiff != null) {
                      if (sofDiff >= 15) {
                        badgeText = `Stronger (${formatSigned(Math.round(sofDiff), 0)})`;
                        badgeCls = 'bg-sky-500/20 border-sky-400/40 text-sky-300';
                        subText = `Your race vELO (${Math.round(riderRefVelo!)}) was above pen avg (${penRatedVelos.length} riders)`;
                      } else if (sofDiff <= -15) {
                        badgeText = `Weaker (${formatSigned(Math.round(sofDiff), 0)})`;
                        badgeCls = 'bg-amber-500/20 border-amber-400/40 text-amber-300';
                        subText = `Your race vELO (${Math.round(riderRefVelo!)}) was below pen avg — tougher field (${penRatedVelos.length} riders)`;
                      } else {
                        badgeText = `Average (${sofDiff >= 0 ? '+' : ''}${Math.round(sofDiff)})`;
                        subText = `Your race vELO (${Math.round(riderRefVelo!)}) was right around pen avg (${penRatedVelos.length} riders)`;
                      }
                    }
                    return (
                      <div
                        title="True average ZwiftRacing vELO v2 rating across riders in this pen"
                        className="rounded-xl border border-slate-800 bg-slate-950/70 p-3.5 space-y-1"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[11px] uppercase tracking-wide text-slate-400 font-semibold">
                            Strength of Field (SOF)
                          </span>
                          {badgeText && (
                            <span
                              className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${badgeCls}`}
                            >
                              {badgeText}
                            </span>
                          )}
                        </div>
                        <p className="text-base font-bold font-mono text-slate-100">
                          {Math.round(penAvgVelo)}
                        </p>
                        <p className="text-[11px] text-slate-400">{subText}</p>
                      </div>
                    );
                  })()
                ) : legacyPenAvg != null ? (
                  (() => {
                    const legacyDiff = legacyBefore != null ? legacyBefore - legacyPenAvg : undefined;
                    let badgeText: string | undefined;
                    let badgeCls = 'bg-slate-800 border-slate-700 text-slate-300';
                    if (legacyDiff != null) {
                      if (legacyDiff >= 40) {
                        badgeText = `Stronger (${formatSigned(Math.round(legacyDiff), 0)})`;
                        badgeCls = 'bg-sky-500/20 border-sky-400/40 text-sky-300';
                      } else if (legacyDiff <= -40) {
                        badgeText = `Weaker (${formatSigned(Math.round(legacyDiff), 0)})`;
                        badgeCls = 'bg-amber-500/20 border-amber-400/40 text-amber-300';
                      } else {
                        badgeText = `Average (${legacyDiff >= 0 ? '+' : ''}${Math.round(legacyDiff)})`;
                      }
                    }
                    return (
                      <div
                        title="Average ZwiftRacing Legacy v1 rating of competitors in this pen"
                        className="rounded-xl border border-slate-800 bg-slate-950/70 p-3.5 space-y-1"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[11px] uppercase tracking-wide text-slate-400 font-semibold">
                            Strength of Field (SOF)
                          </span>
                          {badgeText && (
                            <span
                              className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${badgeCls}`}
                            >
                              {badgeText}
                            </span>
                          )}
                        </div>
                        <p className="text-base font-bold font-mono text-slate-100">
                          {Math.round(legacyPenAvg)}
                        </p>
                        <p className="text-[11px] text-slate-400">Avg pen rating (Legacy v1)</p>
                      </div>
                    );
                  })()
                ) : riderCourseVelo != null ? (
                  <div
                    title="Your ZwiftRacing vELO v2 rating weighted by this route's terrain factors"
                    className="rounded-xl border border-slate-800 bg-slate-950/70 p-3.5 space-y-1"
                  >
                    <span className="text-[11px] uppercase tracking-wide text-slate-400 font-semibold">
                      Event Rating (Course vELO)
                    </span>
                    <p className="text-base font-bold font-mono text-slate-100">
                      {Math.round(riderCourseVelo)}
                    </p>
                    <p className="text-[11px] text-slate-400">
                      Your course-weighted vELO for this route
                    </p>
                  </div>
                ) : null}

                {intensity != null && (
                  <div
                    title="ZwiftRacing measure of how hard or selective this race effort was"
                    className="rounded-xl border border-slate-800 bg-slate-950/70 p-3.5 space-y-1"
                  >
                    <span className="text-[11px] uppercase tracking-wide text-slate-400 font-semibold">
                      Race Intensity
                    </span>
                    <p className="text-base font-bold font-mono text-slate-100">
                      {intensity.toFixed(2)}
                    </p>
                    <p className="text-[11px] text-slate-400">Race effort / selectivity score</p>
                  </div>
                )}

                {hasZrPoints && (
                  <div
                    title="Points scored toward ZwiftRacing seasonal discipline leaderboards based on finish & SOF"
                    className="rounded-xl border border-slate-800 bg-slate-950/70 p-3.5 space-y-1.5"
                  >
                    <span className="text-[11px] uppercase tracking-wide text-slate-400 font-semibold">
                      ZwiftRacing Leaderboard Points
                    </span>
                    {zrPointsTotal != null && (
                      <p className="text-base font-bold font-mono text-slate-100">
                        {zrPointsTotal.toFixed(1)} pts
                      </p>
                    )}
                    {zrPointDisciplines.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {zrPointDisciplines.map((d) => (
                          <span
                            key={d.label}
                            className="rounded-md bg-slate-900 border border-slate-700 px-2 py-0.5 text-[11px] font-mono text-slate-200"
                          >
                            {d.label}: {d.value.toFixed(1)}
                          </span>
                        ))}
                      </div>
                    )}
                    <p className="text-[11px] text-slate-400">
                      Points toward ZR discipline leaderboards
                    </p>
                  </div>
                )}

                {hasZpPts && (
                  <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3.5 space-y-1">
                    <span className="text-[11px] uppercase tracking-wide text-slate-400 font-semibold">
                      ZwiftPower League Points
                    </span>
                    <p className="text-base font-bold font-mono text-slate-100">
                      {bestZpEntry?.pts} pts
                      {bestZpEntry?.pts_pos ? ` (#${bestZpEntry.pts_pos})` : ''}
                    </p>
                    <p className="text-[11px] text-slate-400">ZwiftPower series/league points</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}