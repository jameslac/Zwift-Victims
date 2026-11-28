import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { ZwiftPowerRaceEntry } from '../api/zwiftPower';
import type { ZwiftRacingRiderResponse } from '../api/zwiftRacing';
import type { FavoriteRider } from '../lib/FavoritesContext';
import {
  buildZwiftCompanionEventUrl,
  formatEventCountdown,
  formatEventDateTimeShort,
} from '../lib/eventCalendar';
import { computeHeadToHead } from '../lib/headToHead';
import type { HeadToHeadOutcome } from '../lib/headToHead';
import type { MergedRace } from '../lib/raceHistory';
import { formatDistance } from '../lib/units';
import type { UnitSystem } from '../lib/units';
import { useRiderRaceHistory } from '../lib/useRiderRaceHistory';
import type { AsyncState } from '../lib/useRiderRaceHistory';
import type { VictimSignupItem } from '../lib/useVictimSignups';

function formatShortDate(sec: number | undefined): string {
  if (sec === undefined || sec === null || !Number.isFinite(sec)) return 'Unknown';
  return new Date(sec * 1000).toLocaleDateString(undefined, {
    dateStyle: 'medium',
  });
}

function recordBadgeTone(wins: number, losses: number): string {
  if (wins > losses) return 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300';
  if (losses > wins) return 'bg-red-500/15 border-red-500/40 text-red-300';
  return 'bg-slate-800/80 border-slate-600 text-slate-200';
}

function categoryBadgeTone(cat: string | undefined): string {
  const normalized = cat?.trim().toUpperCase().replace(/\+$/, '');
  switch (normalized) {
    case 'A':
      return 'bg-red-500/15 border-red-500/40 text-red-300';
    case 'B':
      return 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300';
    case 'C':
      return 'bg-sky-500/15 border-sky-500/40 text-sky-300';
    case 'D':
      return 'bg-amber-500/15 border-amber-500/40 text-amber-300';
    case 'E':
      return 'bg-violet-500/15 border-violet-500/40 text-violet-300';
    default:
      return 'bg-slate-800 border-slate-700 text-slate-200';
  }
}

function placeTone(outcome: HeadToHeadOutcome, side: 'profile' | 'friend'): string {
  if (side === 'profile') {
    if (outcome === 'win') return 'text-emerald-300 font-bold';
    if (outcome === 'loss') return 'text-red-300 font-bold';
    return 'text-slate-200 font-semibold';
  }
  if (outcome === 'win') return 'text-slate-400';
  if (outcome === 'loss') return 'text-slate-200 font-semibold';
  return 'text-slate-200 font-semibold';
}

function VictimRow({
  profileId,
  friend,
  includeTeamEvents,
  profileRaces,
  profileZpState,
  profileZrState,
  units,
  upcomingSignups,
  signupsLoading,
  nowMs,
  onRemove,
}: {
  profileId: number;
  friend: FavoriteRider;
  includeTeamEvents: boolean;
  profileRaces: MergedRace[];
  profileZpState: AsyncState<ZwiftPowerRaceEntry[]>;
  profileZrState: AsyncState<ZwiftRacingRiderResponse>;
  units: UnitSystem;
  upcomingSignups: VictimSignupItem[];
  signupsLoading: boolean;
  nowMs: number;
  onRemove: (riderId: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showAllSignups, setShowAllSignups] = useState(false);
  const {
    zpState: friendZpState,
    zrState: friendZrState,
    mergedRaces: friendRaces,
  } = useRiderRaceHistory(friend.id);

  const isLoading =
    profileZpState.status === 'loading' ||
    profileZrState.status === 'loading' ||
    friendZpState.status === 'loading' ||
    friendZrState.status === 'loading';

  const errorMessage =
    profileZpState.status === 'error'
      ? profileZpState.message
      : friendZpState.status === 'error'
        ? friendZpState.message
        : null;

  const summary = useMemo(() => {
    if (profileZpState.status !== 'loaded' || friendZpState.status !== 'loaded') return null;
    return computeHeadToHead(profileRaces, friendRaces, { includeTeamEvents });
  }, [profileZpState.status, friendZpState.status, profileRaces, friendRaces, includeTeamEvents]);

  const friendShortName = friend.name.trim().split(/\s+/)[0] || 'Friend';
  const decided = summary ? summary.wins + summary.losses : 0;
  const winPct = summary && decided > 0 ? Math.round((summary.wins / decided) * 100) : null;
  const hasFallbackPlace = Boolean(
    summary?.races.some(
      (r) =>
        (!r.profileUsedTruePlace && r.profilePlace != null) ||
        (!r.friendUsedTruePlace && r.friendPlace != null),
    ),
  );

  return (
    <article className="rounded-2xl bg-slate-950/75 border border-slate-800 hover:border-slate-700/90 transition-colors overflow-hidden">
      <div className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3.5">
        {/* Top Row on Mobile / Left Identity Block on Desktop */}
        <div className="flex items-start sm:items-center justify-between gap-3 min-w-0 flex-1">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            {friend.imageSrc ? (
              <img
                src={friend.imageSrc}
                alt={friend.name}
                className="w-11 h-11 rounded-full object-cover border border-slate-700 shrink-0"
              />
            ) : (
              <div className="w-11 h-11 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-base font-bold text-slate-200 shrink-0">
                {(friend.name[0] ?? 'Z').toUpperCase()}
              </div>
            )}

            <div className="min-w-0 flex-1">
              <Link
                to={`/riders/${friend.id}`}
                className="block font-extrabold text-base text-slate-100 hover:text-accent-text hover:underline transition-colors leading-snug break-words"
              >
                {friend.name}
              </Link>
              <p className="text-xs text-slate-400 mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span>ID #{friend.id}</span>
                {summary && (
                  <span>
                    · {summary.races.length} shared {summary.races.length === 1 ? 'race' : 'races'}
                    {winPct !== null ? ` · ${winPct}% win` : ''}
                  </span>
                )}
              </p>
            </div>
          </div>

          {/* Category Pill pinned cleanly to the right side */}
          {friend.category && (
            <span
              className={`rounded-full border px-2.5 py-0.5 text-xs font-extrabold tracking-wide shrink-0 ml-auto ${categoryBadgeTone(
                friend.category,
              )}`}
              title={`Competition Category ${friend.category}`}
            >
              Cat {friend.category}
            </span>
          )}
        </div>

        {/* Bottom Action & Win/Loss Bar on Mobile / Right Cluster on Desktop */}
        <div className="flex items-center justify-between sm:justify-end gap-2 pt-2.5 border-t border-slate-800/80 sm:border-t-0 sm:pt-0 shrink-0">
          <div className="flex items-center gap-2">
            {isLoading && (
              <span className="rounded-full bg-slate-800/70 border border-slate-700 px-3 py-1 text-xs text-slate-400">
                Loading…
              </span>
            )}
            {!isLoading && errorMessage && (
              <span className="rounded-full bg-red-500/15 border border-red-500/40 px-3 py-1 text-xs font-semibold text-red-300">
                Unavailable
              </span>
            )}
            {!isLoading && !errorMessage && summary && (
              <span
                className={`rounded-full border px-3 py-1 text-xs sm:text-sm font-extrabold tabular-nums ${recordBadgeTone(
                  summary.wins,
                  summary.losses,
                )}`}
                title="Overall Head-to-Head Win / Loss record"
              >
                {summary.wins}W – {summary.losses}L
                {summary.ties > 0 ? ` – ${summary.ties}T` : ''}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setExpanded((prev) => !prev)}
              aria-expanded={expanded}
              aria-label={`${expanded ? 'Hide' : 'Show'} race history against ${friend.name}`}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-bold text-slate-200 hover:bg-slate-800 hover:border-accent/60 hover:text-accent-text transition-colors"
            >
              <span>{expanded ? 'Hide Races' : 'Races'}</span>
              <svg
                className={`w-3.5 h-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`}
                viewBox="0 0 20 20"
                fill="currentColor"
                aria-hidden="true"
              >
                <path
                  fillRule="evenodd"
                  d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
                  clipRule="evenodd"
                />
              </svg>
            </button>

            <button
              type="button"
              onClick={() => onRemove(friend.id)}
              title={`Remove ${friend.name} from favorites`}
              aria-label={`Remove ${friend.name} from favorites`}
              className="rounded-xl border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-amber-400 hover:bg-slate-800 hover:border-amber-400/50 transition-colors"
            >
              ★
            </button>
          </div>
        </div>
      </div>

      {/* Win-rate progress strip when shared races exist */}
      {!isLoading && !errorMessage && summary && decided > 0 && (
        <div className="h-1 w-full bg-red-500/25 flex overflow-hidden">
          <div
            className="h-full bg-emerald-400 transition-all"
            style={{ width: `${winPct ?? 0}%` }}
          />
        </div>
      )}

      {/* Upcoming Event Signups Strip */}
      {(upcomingSignups.length > 0 || signupsLoading) && (
        <div className="border-t border-slate-800/80 bg-amber-500/5 px-4 py-3 space-y-2">
          {upcomingSignups.length === 0 ? (
            <p className="text-[11px] text-slate-400">Checking upcoming event signups…</p>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-extrabold uppercase tracking-wider text-amber-300">
                  Upcoming Signups ({upcomingSignups.length})
                </span>
                {upcomingSignups.length > 3 && (
                  <button
                    type="button"
                    onClick={() => setShowAllSignups((prev) => !prev)}
                    className="text-[11px] font-semibold text-accent-text hover:underline"
                  >
                    {showAllSignups ? 'Show fewer' : `Show all ${upcomingSignups.length}`}
                  </button>
                )}
              </div>

              <div className="space-y-1.5">
                {(showAllSignups ? upcomingSignups : upcomingSignups.slice(0, 3)).map((item) => {
                  const distStr =
                    item.event.distanceKm !== undefined && item.event.distanceKm > 0
                      ? formatDistance(item.event.distanceKm * 1000, units)
                      : undefined;
                  return (
                    <div
                      key={item.event.eventId}
                      className="rounded-xl bg-slate-950/80 border border-slate-800 px-3 py-2 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                    >
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-bold text-slate-200 tabular-nums">
                            {formatEventDateTimeShort(item.event.startSec)}
                          </span>
                          <span className="text-[11px] text-slate-400 tabular-nums">
                            ({formatEventCountdown(item.event.startSec, nowMs)})
                          </span>
                          {item.pen && (
                            <span
                              className={`rounded-full border px-1.5 py-0 text-[10px] font-extrabold ${categoryBadgeTone(
                                item.pen,
                              )}`}
                            >
                              Cat {item.pen}
                            </span>
                          )}
                          {item.userAlsoSignedUp && (
                            <span className="rounded-full bg-emerald-500/15 border border-emerald-500/40 px-1.5 py-0 text-[10px] font-bold text-emerald-300">
                              ✓ You&apos;re in
                            </span>
                          )}
                        </div>
                        <p className="font-semibold text-slate-100 leading-snug break-words">
                          {item.event.title}
                        </p>
                        {(item.event.routeName || distStr) && (
                          <p className="text-[11px] text-slate-400">
                            {item.event.routeName ?? ''}
                            {item.event.routeName && distStr ? ' · ' : ''}
                            {distStr ?? ''}
                          </p>
                        )}
                      </div>

                      <a
                        href={buildZwiftCompanionEventUrl(item.event.eventId)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center justify-center gap-1 rounded-lg bg-accent hover:bg-accent-hover px-3 py-1.5 text-xs font-extrabold text-accent-foreground shrink-0 transition-colors"
                      >
                        <span>Join</span>
                        <span aria-hidden="true">↗</span>
                      </a>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {expanded && (
        <div className="border-t border-slate-800 bg-slate-900/50 px-4 py-3.5 space-y-3">
          {errorMessage ? (
            <p role="alert" className="text-xs text-red-400">
              {errorMessage}
            </p>
          ) : isLoading || !summary ? (
            <p className="text-xs text-slate-400">Loading head-to-head race results…</p>
          ) : summary.races.length === 0 ? (
            <p className="text-xs text-slate-400">
              No matching same-category races found between you and {friend.name}
              {!includeTeamEvents ? ' (team events excluded)' : ''}.
            </p>
          ) : (
            <>
              {(profileZrState.status === 'error' || friendZrState.status === 'error') && (
                <p className="text-xs text-amber-400">
                  ZwiftRacing.app unavailable for some results; falling back to ZwiftPower placings.
                </p>
              )}

              {/* Mobile Stacked Shared Race Cards (< sm) */}
              <div className="space-y-2 sm:hidden">
                {summary.races.map((race) => {
                  const raceUrl = `/riders/${profileId}/races/${encodeURIComponent(race.eventId)}`;
                  return (
                    <div
                      key={race.eventId}
                      className="rounded-xl bg-slate-950/80 border border-slate-800 p-3 space-y-2"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <Link
                          to={raceUrl}
                          className="text-xs font-bold text-slate-100 hover:text-accent-text hover:underline leading-snug"
                        >
                          {race.title}
                        </Link>
                        <span className="text-[11px] text-slate-400 whitespace-nowrap shrink-0">
                          {formatShortDate(race.date)}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-xs pt-1 border-t border-slate-800/70">
                        <div className="flex items-center justify-between rounded-lg bg-slate-900/80 px-2.5 py-1.5">
                          <span className="text-slate-400">You</span>
                          <span className={placeTone(race.outcome, 'profile')}>
                            {race.profileStatus}
                            {!race.profileUsedTruePlace && race.profilePlace != null ? '*' : ''}
                          </span>
                        </div>
                        <div className="flex items-center justify-between rounded-lg bg-slate-900/80 px-2.5 py-1.5">
                          <span className="text-slate-400 truncate mr-1">{friendShortName}</span>
                          <span className={placeTone(race.outcome, 'friend')}>
                            {race.friendStatus}
                            {!race.friendUsedTruePlace && race.friendPlace != null ? '*' : ''}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Desktop Table (sm+) */}
              <div className="hidden sm:block overflow-x-auto">
                <table className="w-full table-fixed text-xs sm:text-sm">
                  <colgroup>
                    <col className="w-28" />
                    <col />
                    <col className="w-24" />
                    <col className="w-28" />
                  </colgroup>
                  <thead>
                    <tr className="border-b border-slate-800 text-[11px] uppercase tracking-wide text-slate-400">
                      <th className="py-1.5 pr-2 text-left font-semibold">Date</th>
                      <th className="py-1.5 px-2 text-left font-semibold">Race</th>
                      <th className="py-1.5 px-2 text-right font-semibold">You</th>
                      <th className="py-1.5 pl-2 text-right font-semibold truncate">
                        {friendShortName}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70">
                    {summary.races.map((race) => (
                      <tr key={race.eventId} className="hover:bg-slate-950/40">
                        <td className="py-2 pr-2 text-slate-400 whitespace-nowrap align-middle">
                          {formatShortDate(race.date)}
                        </td>
                        <td className="py-2 px-2 align-middle">
                          <Link
                            to={`/riders/${profileId}/races/${encodeURIComponent(race.eventId)}`}
                            className="block truncate text-slate-200 font-medium hover:text-accent-text hover:underline"
                            title={race.title}
                          >
                            {race.title}
                          </Link>
                        </td>
                        <td
                          className={`py-2 px-2 text-right whitespace-nowrap align-middle ${placeTone(
                            race.outcome,
                            'profile',
                          )}`}
                        >
                          {race.profileStatus}
                          {!race.profileUsedTruePlace && race.profilePlace != null ? '*' : ''}
                        </td>
                        <td
                          className={`py-2 pl-2 text-right whitespace-nowrap align-middle ${placeTone(
                            race.outcome,
                            'friend',
                          )}`}
                        >
                          {race.friendStatus}
                          {!race.friendUsedTruePlace && race.friendPlace != null ? '*' : ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {hasFallbackPlace && (
                <p className="text-[11px] text-slate-500">
                  * Uses ZwiftPower placing where ZwiftRacing.app data is unavailable (&gt;90 days or
                  unscored).
                </p>
              )}
            </>
          )}
        </div>
      )}
    </article>
  );
}

export default function ZwiftVictimsSection({
  profileId,
  favorites,
  onRemoveFavorite,
  profileRaces,
  profileZpState,
  profileZrState,
  units = 'metric',
  signupsByRiderId,
  signupsLoading = false,
}: {
  profileId: number;
  favorites: FavoriteRider[];
  onRemoveFavorite: (riderId: number) => void;
  profileRaces: MergedRace[];
  profileZpState: AsyncState<ZwiftPowerRaceEntry[]>;
  profileZrState: AsyncState<ZwiftRacingRiderResponse>;
  units?: UnitSystem;
  signupsByRiderId?: Map<number, VictimSignupItem[]>;
  signupsLoading?: boolean;
}) {
  const navigate = useNavigate();
  const [includeTeamEvents, setIncludeTeamEvents] = useState(false);
  const [rivalIdInput, setRivalIdInput] = useState('');
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const otherFavorites = useMemo(
    () => favorites.filter((f) => f.id !== profileId),
    [favorites, profileId],
  );

  function handleInspectRival(e: FormEvent) {
    e.preventDefault();
    const cleaned = rivalIdInput.trim();
    if (!/^\d+$/.test(cleaned)) return;
    setRivalIdInput('');
    navigate(`/riders/${cleaned}`);
  }

  return (
    <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-8 space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg sm:text-xl font-extrabold text-slate-100">Zwift Victims</h2>
            {otherFavorites.length > 0 && (
              <span className="rounded-full bg-accent/15 border border-accent/40 px-2.5 py-0.5 text-xs font-bold text-accent-text">
                {otherFavorites.length} {otherFavorites.length === 1 ? 'rival' : 'rivals'}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-400">
            Pairwise same-category Head-to-Head Win/Loss records against your favorited rivals.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/70 px-3 py-1.5 text-xs font-medium text-slate-300 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={includeTeamEvents}
              onChange={(e) => setIncludeTeamEvents(e.target.checked)}
              className="h-4 w-4 rounded border-slate-700 bg-slate-950 accent-[var(--zv-accent)]"
            />
            <span>Include team events</span>
          </label>
        </div>
      </div>

      {/* Quick Rival Lookup Bar */}
      <form
        onSubmit={handleInspectRival}
        className="rounded-xl bg-slate-950/70 border border-slate-800 p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
      >
        <div className="text-xs text-slate-300">
          <span className="font-bold text-slate-100">Add or inspect a rival:</span>{' '}
          <span className="text-slate-400">
            Look up any friend by Zwift ID and tap ☆ Add to Victims on their profile.
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={rivalIdInput}
            onChange={(e) => setRivalIdInput(e.target.value)}
            placeholder="Zwift Rider ID…"
            aria-label="Look up rival by Zwift ID"
            className="flex-1 sm:w-40 rounded-xl bg-slate-900 border border-slate-700 px-3 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-accent"
          />
          <button
            type="submit"
            disabled={!/^\d+$/.test(rivalIdInput.trim())}
            className="rounded-xl bg-accent px-3.5 py-1.5 text-xs font-bold text-accent-foreground disabled:opacity-40"
          >
            Inspect Rider →
          </button>
        </div>
      </form>

      {otherFavorites.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-950/40 p-6 text-center space-y-2">
          <p className="text-sm font-bold text-slate-200">No favorited rivals yet</p>
          <p className="text-xs text-slate-400 max-w-md mx-auto">
            Enter a friend&apos;s Zwift ID above (or click any rider in a race leaderboard) and tap{' '}
            <span className="text-amber-300 font-semibold">☆ Add to Victims</span> to track your
            pairwise head-to-head win/loss record here.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {otherFavorites.map((friend) => (
            <VictimRow
              key={friend.id}
              profileId={profileId}
              friend={friend}
              includeTeamEvents={includeTeamEvents}
              profileRaces={profileRaces}
              profileZpState={profileZpState}
              profileZrState={profileZrState}
              units={units}
              upcomingSignups={signupsByRiderId?.get(friend.id) ?? []}
              signupsLoading={signupsLoading}
              nowMs={nowMs}
              onRemove={onRemoveFavorite}
            />
          ))}
        </div>
      )}
    </section>
  );
}
