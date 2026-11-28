import { Link } from 'react-router-dom';
import {
  buildZwiftCompanionEventUrl,
  formatDurationSecondsCompact,
  formatEventClockTime,
  formatEventCountdown,
  formatEventDateTimeShort,
} from '../lib/eventCalendar';
import type { CalendarEventType } from '../lib/eventCalendar';
import { buildZwiftPowerEventUrl } from '../lib/raceHistory';
import { formatDistance, formatElevation } from '../lib/units';
import type { UnitSystem } from '../lib/units';
import type { GroupedVictimEvent } from '../lib/useVictimSignups';

const TYPE_BADGE_TONE: Record<CalendarEventType, string> = {
  race: 'bg-accent/15 border-accent/40 text-accent-text',
  tt: 'bg-amber-500/15 border-amber-500/40 text-amber-300',
  ride: 'bg-sky-500/15 border-sky-500/40 text-sky-300',
  workout: 'bg-violet-500/15 border-violet-500/40 text-violet-300',
  run: 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300',
};

function penBadgeTone(pen: string): string {
  const lead = pen.trim().toUpperCase()[0];
  switch (lead) {
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

export default function VictimSignupsPanel({
  groupedEvents,
  loading,
  errorCount,
  rivalsCount,
  units,
  nowMs,
  onRefresh,
}: {
  groupedEvents: GroupedVictimEvent[];
  loading: boolean;
  errorCount: number;
  rivalsCount: number;
  units: UnitSystem;
  nowMs: number;
  onRefresh: () => void;
}) {
  return (
    <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-8 space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg sm:text-xl font-extrabold text-slate-100">
              Upcoming Victim Signups
            </h2>
            {groupedEvents.length > 0 && (
              <span className="rounded-full bg-amber-500/15 border border-amber-400/40 px-2.5 py-0.5 text-xs font-bold text-amber-300">
                {groupedEvents.length} {groupedEvents.length === 1 ? 'event' : 'events'}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-400">
            Upcoming events your favorited rivals have signed up for on ZwiftPower. Tap any event
            to open it directly in the Zwift Companion App and join them.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs font-bold text-slate-200 hover:border-accent/60 hover:text-accent-text disabled:opacity-50 transition-colors"
          >
            {loading ? 'Refreshing…' : 'Refresh Signups'}
          </button>
          <Link
            to="/events"
            className="rounded-xl bg-accent hover:bg-accent-hover px-3.5 py-1.5 text-xs font-bold text-accent-foreground transition-colors"
          >
            Browse Full Calendar →
          </Link>
        </div>
      </div>

      {errorCount > 0 && (
        <p role="alert" className="text-xs text-amber-400">
          Some rival signup feeds could not be fetched ({errorCount} failed).
        </p>
      )}

      {rivalsCount === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-950/40 p-6 text-center space-y-2">
          <p className="text-sm font-bold text-slate-200">No rivals in your Victims list yet</p>
          <p className="text-xs text-slate-400 max-w-md mx-auto">
            Add rivals from any rider profile or race standings table to see their upcoming event
            signups here.
          </p>
        </div>
      ) : loading && groupedEvents.length === 0 ? (
        <p className="text-xs text-slate-400">Checking upcoming signups across your rivals…</p>
      ) : groupedEvents.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-950/40 p-6 text-center space-y-2">
          <p className="text-sm font-bold text-slate-200">No upcoming victim signups found</p>
          <p className="text-xs text-slate-400 max-w-lg mx-auto">
            None of your {rivalsCount} tracked rivals currently show upcoming ZwiftPower signups.
            (Note: ZwiftPower only publishes upcoming signups for riders opted into ZwiftPower, and
            syncs periodically.)
          </p>
          <div className="pt-1">
            <Link
              to="/events"
              className="inline-flex items-center gap-1 text-xs font-bold text-accent-text hover:underline"
            >
              <span>Explore all upcoming Zwift events →</span>
            </Link>
          </div>
        </div>
      ) : (
        <div className="space-y-3.5">
          {groupedEvents.map(({ event, victims, userSignedUp }) => {
            const countdown = formatEventCountdown(event.startSec, nowMs);
            const distanceStr =
              event.distanceKm !== undefined && event.distanceKm > 0
                ? formatDistance(event.distanceKm * 1000, units)
                : undefined;
            const durationStr = formatDurationSecondsCompact(event.durationSec);
            const elevationStr =
              event.elevationM !== undefined
                ? formatElevation(event.elevationM, units)
                : undefined;

            return (
              <article
                key={event.eventId}
                className="rounded-2xl bg-slate-950/80 border border-amber-400/35 p-4 sm:p-5 space-y-3"
              >
                <div className="flex items-start justify-between gap-2.5">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="rounded-lg bg-slate-900 border border-slate-700 px-2 py-0.5 text-xs font-extrabold text-slate-100 tabular-nums">
                        {formatEventDateTimeShort(event.startSec)}
                      </span>
                      <span className="rounded-lg bg-slate-900/70 border border-slate-800 px-2 py-0.5 text-[11px] font-bold text-slate-300 tabular-nums">
                        {countdown}
                      </span>
                      {userSignedUp && (
                        <span className="rounded-full bg-emerald-500/15 border border-emerald-500/40 px-2 py-0.5 text-[11px] font-bold text-emerald-300">
                          ✓ You&apos;re signed up
                        </span>
                      )}
                    </div>

                    <h3 className="font-bold text-base text-slate-100 leading-snug break-words">
                      {event.title}
                    </h3>

                    <p className="text-xs text-slate-400 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                      <span>{formatEventClockTime(event.startSec)}</span>
                      {event.routeName && <span>· {event.routeName}</span>}
                      {event.world && <span>· {event.world}</span>}
                      {distanceStr && <span>· {distanceStr}</span>}
                      {durationStr && <span>· {durationStr}</span>}
                      {elevationStr && <span>· ↗ {elevationStr}</span>}
                      {event.totalSignups > 0 && <span>· {event.totalSignups} signed up</span>}
                    </p>
                  </div>

                  <span
                    className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold shrink-0 ml-auto ${
                      TYPE_BADGE_TONE[event.eventType]
                    }`}
                  >
                    {event.eventTypeLabel}
                  </span>
                </div>

                {/* Signed-up Rivals */}
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-amber-300 mr-1">
                    ★ Signed up:
                  </span>
                  {victims.map(({ rider, pen }) => (
                    <Link
                      key={rider.id}
                      to={`/riders/${rider.id}`}
                      className="inline-flex items-center gap-1.5 rounded-full bg-slate-900 border border-slate-700 px-2.5 py-1 text-xs font-bold text-slate-100 hover:border-amber-400/60 hover:text-amber-200 transition-colors"
                    >
                      {rider.imageSrc && (
                        <img
                          src={rider.imageSrc}
                          alt=""
                          className="w-4 h-4 rounded-full object-cover shrink-0"
                        />
                      )}
                      <span>{rider.name}</span>
                      {pen && (
                        <span
                          className={`rounded-full border px-1.5 py-0 text-[10px] font-extrabold ${penBadgeTone(
                            pen,
                          )}`}
                        >
                          Cat {pen}
                        </span>
                      )}
                    </Link>
                  ))}
                </div>

                <div className="border-t border-slate-800/80 pt-3 flex flex-wrap items-center justify-between gap-2">
                  <a
                    href={buildZwiftCompanionEventUrl(event.eventId)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-xl bg-accent hover:bg-accent-hover px-3.5 py-1.5 text-xs font-extrabold text-accent-foreground shadow-sm transition-colors"
                  >
                    <span>Join in Companion</span>
                    <span aria-hidden="true">↗</span>
                  </a>

                  <a
                    href={buildZwiftPowerEventUrl(event.eventId)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-lg border border-slate-800 bg-slate-900/80 px-2.5 py-1 text-xs font-semibold text-slate-300 hover:border-accent/50 hover:text-accent-text transition-colors"
                  >
                    ZwiftPower ↗
                  </a>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <p className="text-[11px] text-slate-500">
        Upcoming signups reflect riders opted into ZwiftPower and update as ZwiftPower syncs event
        rosters.
      </p>
    </section>
  );
}
