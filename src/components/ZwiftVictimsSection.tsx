import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ZwiftPowerRaceEntry } from '../api/zwiftPower';
import type { ZwiftRacingRiderResponse } from '../api/zwiftRacing';
import type { FavoriteRider } from '../lib/FavoritesContext';
import { computeHeadToHead } from '../lib/headToHead';
import type { HeadToHeadOutcome } from '../lib/headToHead';
import type { MergedRace } from '../lib/raceHistory';
import { useRiderRaceHistory } from '../lib/useRiderRaceHistory';
import type { AsyncState } from '../lib/useRiderRaceHistory';

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
  friend,
  includeTeamEvents,
  profileRaces,
  profileZpState,
  profileZrState,
  onRemove,
}: {
  friend: FavoriteRider;
  includeTeamEvents: boolean;
  profileRaces: MergedRace[];
  profileZpState: AsyncState<ZwiftPowerRaceEntry[]>;
  profileZrState: AsyncState<ZwiftRacingRiderResponse>;
  onRemove: (riderId: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
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
      (r) => !r.usedTruePlace && (r.profilePlace != null || r.friendPlace != null),
    ),
  );

  return (
    <article className="rounded-xl bg-slate-950/70 border border-slate-800 overflow-hidden">
      <div className="p-3.5 sm:p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          {friend.imageSrc ? (
            <img
              src={friend.imageSrc}
              alt={friend.name}
              className="w-10 h-10 rounded-full object-cover border border-slate-700 shrink-0"
            />
          ) : (
            <div className="w-10 h-10 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-sm font-bold text-slate-200 shrink-0">
              {(friend.name[0] ?? 'Z').toUpperCase()}
            </div>
          )}

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 min-w-0">
              <Link
                to={`/riders/${friend.id}`}
                className="font-bold text-sm sm:text-base text-slate-100 hover:text-[#fc6719] hover:underline transition-colors truncate"
              >
                {friend.name}
              </Link>
              {friend.category && (
                <span className="rounded-full bg-slate-800 border border-slate-700 px-2 py-0.5 text-[11px] font-semibold text-slate-300 shrink-0">
                  Cat {friend.category}
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400 mt-0.5 flex flex-wrap items-center gap-x-2">
              <span>ID {friend.id}</span>
              {summary && (
                <span>
                  · {summary.races.length} shared {summary.races.length === 1 ? 'race' : 'races'}
                  {winPct !== null ? ` · ${winPct}% win` : ''}
                </span>
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {isLoading && (
            <span className="rounded-full bg-slate-800/70 border border-slate-700 px-2.5 py-1 text-xs text-slate-400">
              Loading…
            </span>
          )}
          {!isLoading && errorMessage && (
            <span className="rounded-full bg-red-500/15 border border-red-500/40 px-2.5 py-1 text-xs font-semibold text-red-300">
              Unavailable
            </span>
          )}
          {!isLoading && !errorMessage && summary && (
            <span
              className={`rounded-full border px-3 py-1 text-xs sm:text-sm font-extrabold tabular-nums ${recordBadgeTone(summary.wins, summary.losses)}`}
              title="Overall Head-to-Head Win / Loss record"
            >
              {summary.wins}W – {summary.losses}L
              {summary.ties > 0 ? ` – ${summary.ties}T` : ''}
            </span>
          )}

          <button
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            aria-expanded={expanded}
            aria-label={`${expanded ? 'Hide' : 'Show'} race history against ${friend.name}`}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-800 hover:text-white transition-colors"
          >
            <span>{expanded ? 'Hide' : 'Races'}</span>
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
            className="rounded-lg border border-slate-700 px-2 py-1.5 text-xs text-amber-400 hover:bg-slate-800 hover:border-amber-400/50 transition-colors"
          >
            ★
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-slate-800 bg-slate-900/50 px-3.5 py-3 sm:px-4 sm:py-3.5 space-y-2.5">
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

              <div className="overflow-x-auto">
                <table className="w-full table-fixed text-xs sm:text-sm">
                  <colgroup>
                    <col className="w-[5.75rem] sm:w-28" />
                    <col />
                    <col className="w-16 sm:w-24" />
                    <col className="w-20 sm:w-28" />
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
                      <tr key={race.eventId}>
                        <td className="py-2 pr-2 text-slate-400 whitespace-nowrap align-middle">
                          {formatShortDate(race.date)}
                        </td>
                        <td className="py-2 px-2 align-middle">
                          <div className="truncate text-slate-200 font-medium" title={race.title}>
                            {race.title}
                          </div>
                        </td>
                        <td
                          className={`py-2 px-2 text-right whitespace-nowrap align-middle ${placeTone(race.outcome, 'profile')}`}
                        >
                          {race.profileStatus}
                          {!race.usedTruePlace && race.profilePlace != null ? '*' : ''}
                        </td>
                        <td
                          className={`py-2 pl-2 text-right whitespace-nowrap align-middle ${placeTone(race.outcome, 'friend')}`}
                        >
                          {race.friendStatus}
                          {!race.usedTruePlace && race.friendPlace != null ? '*' : ''}
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
}: {
  profileId: number;
  favorites: FavoriteRider[];
  onRemoveFavorite: (riderId: number) => void;
  profileRaces: MergedRace[];
  profileZpState: AsyncState<ZwiftPowerRaceEntry[]>;
  profileZrState: AsyncState<ZwiftRacingRiderResponse>;
}) {
  const [includeTeamEvents, setIncludeTeamEvents] = useState(false);

  const otherFavorites = useMemo(
    () => favorites.filter((f) => f.id !== profileId),
    [favorites, profileId],
  );

  return (
    <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-8 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold">Zwift Victims</h2>
            {otherFavorites.length > 0 && (
              <span className="rounded-full bg-slate-800 border border-slate-700 px-2.5 py-0.5 text-xs font-semibold text-slate-300">
                {otherFavorites.length} {otherFavorites.length === 1 ? 'rival' : 'rivals'}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-400">
            Same-category head-to-head win/loss records against your favorited riders.
          </p>
        </div>

        <label className="inline-flex items-center gap-2 text-xs text-slate-300 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={includeTeamEvents}
            onChange={(e) => setIncludeTeamEvents(e.target.checked)}
            className="h-4 w-4 rounded border-slate-700 bg-slate-950 accent-[#fc6719]"
          />
          <span>Include team events</span>
        </label>
      </div>

      {otherFavorites.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-800 bg-slate-950/40 p-5 text-center space-y-1.5">
          <p className="text-sm font-medium text-slate-300">No favorited riders yet</p>
          <p className="text-xs text-slate-400">
            Search for a friend by Zwift ID at the top of the page and click{' '}
            <span className="text-amber-300 font-semibold">☆ Favorite</span> on their profile to
            track your head-to-head win/loss record here.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {otherFavorites.map((friend) => (
            <VictimRow
              key={friend.id}
              friend={friend}
              includeTeamEvents={includeTeamEvents}
              profileRaces={profileRaces}
              profileZpState={profileZpState}
              profileZrState={profileZrState}
              onRemove={onRemoveFavorite}
            />
          ))}
        </div>
      )}
    </section>
  );
}
