import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchPublicEvent } from '../api/zwiftCore';
import type { ZwiftPublicEvent } from '../api/zwiftCore';
import { fetchZwiftPowerEventSignups } from '../api/zwiftPower';
import type { ZwiftPowerEventSignupEntry } from '../api/zwiftPower';
import { useAuth } from '../auth/AuthContext';
import { useFavorites } from '../lib/FavoritesContext';
import {
  buildZwiftCompanionEventUrl,
  formatCoreRuleLabel,
  formatDurationSecondsCompact,
  formatEventClockTime,
  formatEventCountdown,
  formatSubgroupPaceRange,
  penLabelFromNumber,
} from '../lib/eventCalendar';
import type { CalendarEvent, CalendarEventType, VictimInEvent } from '../lib/eventCalendar';
import {
  buildZwiftPowerEventUrl,
  buildZwifterBikesRouteUrl,
  decodeHtmlEntities,
  subgroupCategoryLabel,
} from '../lib/raceHistory';
import { formatDistance, formatElevation } from '../lib/units';
import type { UnitSystem } from '../lib/units';

interface EventDetailPayload {
  publicEvent: ZwiftPublicEvent | null;
  signups: ZwiftPowerEventSignupEntry[];
}

const eventDetailCache = new Map<string, EventDetailPayload>();

const EVENT_TYPE_BADGE_TONE: Record<CalendarEventType, string> = {
  race: 'bg-accent/15 border-accent/40 text-accent-text',
  tt: 'bg-amber-500/15 border-amber-500/40 text-amber-300',
  ride: 'bg-sky-500/15 border-sky-500/40 text-sky-300',
  workout: 'bg-violet-500/15 border-violet-500/40 text-violet-300',
  run: 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300',
};

const TERRAIN_LABEL: Record<NonNullable<CalendarEvent['terrain']>, string> = {
  flat: 'Flat',
  hilly: 'Hilly',
  mountain: 'Mountain',
};

function penPillTone(label: string): string {
  const lead = label.trim().toUpperCase()[0];
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

export default function EventCalendarCard({
  event,
  units,
  victims,
  userSignedUp,
  nowMs,
}: {
  event: CalendarEvent;
  units: UnitSystem;
  victims: VictimInEvent[];
  userSignedUp: boolean;
  nowMs: number;
}) {
  const { getAccessToken } = useAuth();
  const { isFavorite } = useFavorites();
  const [expanded, setExpanded] = useState(false);
  const [detailState, setDetailState] = useState<
    | { status: 'idle' }
    | { status: 'loading' }
    | { status: 'error'; message: string }
    | { status: 'loaded'; data: EventDetailPayload }
  >(() => {
    const cached = eventDetailCache.get(event.eventId);
    return cached ? { status: 'loaded', data: cached } : { status: 'idle' };
  });

  useEffect(() => {
    if (!expanded) return;
    const cached = eventDetailCache.get(event.eventId);
    if (cached) return;

    let cancelled = false;
    getAccessToken()
      .then((token) =>
        Promise.allSettled([
          fetchPublicEvent(token, event.eventId),
          fetchZwiftPowerEventSignups(token, event.eventId),
        ]),
      )
      .then(([coreRes, zpRes]) => {
        if (cancelled) return;
        const publicEvent = coreRes.status === 'fulfilled' ? coreRes.value : null;
        const signups = zpRes.status === 'fulfilled' ? zpRes.value : [];
        if (
          coreRes.status === 'rejected' &&
          zpRes.status === 'rejected'
        ) {
          setDetailState({
            status: 'error',
            message: 'Could not load event details or entrant list.',
          });
          return;
        }
        const payload = { publicEvent, signups };
        eventDetailCache.set(event.eventId, payload);
        setDetailState({ status: 'loaded', data: payload });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setDetailState({
            status: 'error',
            message: err instanceof Error ? err.message : 'Failed to load event details.',
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [expanded, event.eventId, getAccessToken]);

  function handleToggleDetails() {
    const next = !expanded;
    setExpanded(next);
    if (next && detailState.status === 'idle' && !eventDetailCache.has(event.eventId)) {
      setDetailState({ status: 'loading' });
    }
  }

  const countdown = formatEventCountdown(event.startSec, nowMs);
  const isLive = countdown === 'Live';
  const distanceStr =
    event.distanceKm !== undefined && event.distanceKm > 0
      ? formatDistance(event.distanceKm * 1000, units)
      : undefined;
  const durationStr = formatDurationSecondsCompact(event.durationSec);
  const elevationStr =
    event.elevationM !== undefined ? formatElevation(event.elevationM, units) : undefined;
  const routeUrl = event.routeName ? buildZwifterBikesRouteUrl(event.routeName) : undefined;
  const companionUrl = buildZwiftCompanionEventUrl(event.eventId);

  const loadedDetail = detailState.status === 'loaded' ? detailState.data : null;

  const subgroupRows = useMemo(() => {
    const publicEvent = loadedDetail?.publicEvent;
    const signups = loadedDetail?.signups ?? [];
    if (!publicEvent?.eventSubgroups?.length) return null;

    const countsByPen = new Map<string, number>();
    for (const row of signups) {
      const pen = penLabelFromNumber(row.label);
      if (pen) countsByPen.set(pen, (countsByPen.get(pen) ?? 0) + 1);
    }

    return [...publicEvent.eventSubgroups]
      .sort((a, b) => (a.label ?? 99) - (b.label ?? 99))
      .map((sg) => {
        const label = subgroupCategoryLabel(sg) ?? String(sg.label ?? '—');
        const zpCount = countsByPen.get(label);
        const fallbackCount =
          typeof sg.totalSignedUpCount === 'number' && sg.totalSignedUpCount > 0
            ? sg.totalSignedUpCount
            : event.pens.find((p) => p.label === label)?.signups;
        const count = zpCount ?? fallbackCount ?? 0;
        const distMeters = sg.distanceInMeters ?? publicEvent.distanceInMeters;
        const durSec = sg.durationInSeconds ?? publicEvent.durationInSeconds;
        return {
          id: sg.id,
          label,
          paceRange: formatSubgroupPaceRange(sg),
          laps: sg.laps ?? publicEvent.laps,
          distance:
            typeof distMeters === 'number' && distMeters > 0
              ? formatDistance(distMeters, units)
              : undefined,
          duration:
            typeof durSec === 'number' && durSec > 0
              ? formatDurationSecondsCompact(durSec)
              : undefined,
          count,
        };
      });
  }, [loadedDetail, event.pens, units]);

  const sortedEntrants = useMemo(() => {
    const signups = loadedDetail?.signups ?? [];
    if (signups.length === 0) return [];
    const copy = [...signups];
    copy.sort((a, b) => {
      const aFav = typeof a.zwid === 'number' && isFavorite(a.zwid) ? 0 : 1;
      const bFav = typeof b.zwid === 'number' && isFavorite(b.zwid) ? 0 : 1;
      if (aFav !== bFav) return aFav - bFav;
      const aPen = Number(a.label ?? 99);
      const bPen = Number(b.label ?? 99);
      if (aPen !== bPen) return aPen - bPen;
      return String(a.name ?? '').localeCompare(String(b.name ?? ''));
    });
    return copy;
  }, [loadedDetail, isFavorite]);

  return (
    <article
      className={`rounded-2xl bg-slate-950/90 border p-4 sm:p-5 space-y-3 transition-colors ${
        victims.length > 0
          ? 'border-amber-400/50 shadow-lg shadow-amber-500/5'
          : 'border-slate-800 hover:border-slate-700'
      }`}
    >
      {/* Top Row: Time, Title & Badges */}
      <div className="flex items-start justify-between gap-2.5">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded-lg bg-slate-900 border border-slate-700 px-2 py-0.5 text-xs font-extrabold text-slate-100 tabular-nums">
              {formatEventClockTime(event.startSec)}
            </span>
            <span
              className={`rounded-lg border px-2 py-0.5 text-[11px] font-bold tabular-nums ${
                isLive
                  ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300'
                  : 'bg-slate-900/70 border-slate-800 text-slate-300'
              }`}
            >
              {countdown}
            </span>
            {userSignedUp && (
              <span className="rounded-full bg-emerald-500/15 border border-emerald-500/40 px-2 py-0.5 text-[11px] font-bold text-emerald-300">
                ✓ Signed up
              </span>
            )}
          </div>

          <h3 className="font-bold text-base text-slate-100 leading-snug break-words">
            {event.title}
          </h3>

          <p className="text-xs text-slate-400 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
            <span>
              {event.routeName ?? (event.routeId ? `Route #${event.routeId}` : 'Route TBD')}
            </span>
            {event.world && <span>· {event.world}</span>}
            {event.laps && event.laps > 1 && <span>· {event.laps} laps</span>}
            {event.subType && <span>· {event.subType}</span>}
            {event.organizer && event.organizer !== 'ZWIFT' && (
              <span>· {event.organizer}</span>
            )}
            <span>· #{event.eventId}</span>
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-1.5 shrink-0 ml-auto">
          <span
            className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
              EVENT_TYPE_BADGE_TONE[event.eventType]
            }`}
          >
            {event.eventTypeLabel}
          </span>
          {event.terrain && (
            <span className="rounded-full bg-slate-900 border border-slate-700 px-2 py-0.5 text-[11px] font-semibold text-slate-300">
              {TERRAIN_LABEL[event.terrain]}
            </span>
          )}
          {event.dominantTerrainFactor && (
            <span className="rounded-full bg-accent/10 border border-accent/30 px-2 py-0.5 text-[11px] font-semibold text-accent-text">
              {event.dominantTerrainFactor}
            </span>
          )}
        </div>
      </div>

      {/* Victim Highlight Strip */}
      {victims.length > 0 && (
        <div className="rounded-xl bg-amber-500/10 border border-amber-400/35 px-3 py-2 flex flex-wrap items-center gap-2">
          <span className="text-xs font-extrabold text-amber-300 shrink-0">
            ★ {victims.length} {victims.length === 1 ? 'Victim' : 'Victims'} going:
          </span>
          <div className="flex flex-wrap items-center gap-1.5">
            {victims.map(({ rider, pen }) => (
              <Link
                key={rider.id}
                to={`/riders/${rider.id}`}
                className="inline-flex items-center gap-1.5 rounded-full bg-slate-950/90 border border-amber-400/40 px-2.5 py-0.5 text-xs font-bold text-slate-100 hover:border-amber-300 hover:text-amber-200 transition-colors"
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
                    className={`rounded-full border px-1.5 py-0 text-[10px] font-extrabold ${penPillTone(
                      pen,
                    )}`}
                  >
                    Cat {pen}
                  </span>
                )}
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Specs & Pen Counts */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {distanceStr && (
          <span className="rounded-lg bg-slate-900/90 border border-slate-800 px-2.5 py-1 font-semibold text-slate-200 tabular-nums">
            {distanceStr}
          </span>
        )}
        {durationStr && (
          <span className="rounded-lg bg-slate-900/90 border border-slate-800 px-2.5 py-1 font-semibold text-slate-200 tabular-nums">
            {durationStr}
          </span>
        )}
        {elevationStr && (
          <span className="rounded-lg bg-slate-900/90 border border-slate-800 px-2.5 py-1 font-semibold text-slate-300 tabular-nums">
            ↗ {elevationStr}
          </span>
        )}
        <span className="rounded-lg bg-slate-900/90 border border-slate-800 px-2.5 py-1 font-bold text-slate-200 tabular-nums">
          {event.totalSignups} {event.totalSignups === 1 ? 'rider' : 'riders'}
        </span>

        {event.pens.length > 0 && (
          <div className="flex flex-wrap items-center gap-1">
            {event.pens.map((pen) => (
              <span
                key={pen.label}
                className={`rounded-md border px-1.5 py-0.5 text-[11px] font-bold tabular-nums ${penPillTone(
                  pen.label,
                )}`}
              >
                {pen.label}:{pen.signups}
              </span>
            ))}
          </div>
        )}

        {event.badges.map((badge) => (
          <span
            key={badge}
            className="rounded-md bg-slate-900/70 border border-slate-800 px-2 py-0.5 text-[11px] font-medium text-slate-400"
          >
            {badge}
          </span>
        ))}
      </div>

      {/* Footer Actions */}
      <footer className="border-t border-slate-800/80 pt-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <a
            href={companionUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-xl bg-accent hover:bg-accent-hover px-3.5 py-1.5 text-xs font-extrabold text-accent-foreground shadow-sm transition-colors"
          >
            <span>Open in Companion</span>
            <span aria-hidden="true">↗</span>
          </a>

          <button
            type="button"
            onClick={handleToggleDetails}
            aria-expanded={expanded}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-bold text-slate-200 hover:border-accent/60 hover:text-accent-text transition-colors"
          >
            <span>{expanded ? 'Hide Details' : 'Details'}</span>
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
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <a
            href={buildZwiftPowerEventUrl(event.eventId)}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg border border-slate-800 bg-slate-900/80 px-2.5 py-1 font-semibold text-slate-300 hover:border-accent/50 hover:text-accent-text transition-colors"
          >
            ZwiftPower ↗
          </a>
          {(event.hasZwiftRacing || event.eventType === 'race' || event.eventType === 'tt') && (
            <a
              href={`https://zwiftracing.app/events/${encodeURIComponent(event.eventId)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg border border-slate-800 bg-slate-900/80 px-2.5 py-1 font-semibold text-slate-300 hover:border-accent/50 hover:text-accent-text transition-colors"
            >
              ZwiftRacing ↗
            </a>
          )}
          {routeUrl && (
            <a
              href={routeUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg border border-slate-800 bg-slate-900/80 px-2.5 py-1 font-semibold text-slate-300 hover:border-accent/50 hover:text-accent-text transition-colors"
            >
              ZwifterBikes ↗
            </a>
          )}
        </div>
      </footer>

      {/* Expandable Inline Details */}
      {expanded && (
        <div className="border-t border-slate-800 bg-slate-900/60 rounded-xl p-3.5 sm:p-4 space-y-3.5">
          {detailState.status === 'loading' && (
            <p className="text-xs text-slate-400">Loading full event description, rules &amp; entrants…</p>
          )}
          {detailState.status === 'error' && (
            <p role="alert" className="text-xs text-amber-400">
              {detailState.message}
            </p>
          )}

          {loadedDetail?.publicEvent && (
            <div className="space-y-3">
              {loadedDetail.publicEvent.description && (
                <p className="text-xs text-slate-300 whitespace-pre-line leading-relaxed max-h-48 overflow-y-auto pr-1">
                  {decodeHtmlEntities(loadedDetail.publicEvent.description)}
                </p>
              )}

              {(loadedDetail.publicEvent.categoryEnforcement ||
                (loadedDetail.publicEvent.rulesSet &&
                  loadedDetail.publicEvent.rulesSet.length > 0)) && (
                <div className="flex flex-wrap gap-1.5">
                  {loadedDetail.publicEvent.categoryEnforcement && (
                    <span className="rounded-full bg-accent/15 border border-accent/40 px-2.5 py-0.5 text-[11px] font-bold text-accent-text">
                      Category Enforcement On
                    </span>
                  )}
                  {(loadedDetail.publicEvent.rulesSet ?? []).map((rule) => (
                    <span
                      key={rule}
                      className="rounded-full bg-slate-950 border border-slate-700 px-2.5 py-0.5 text-[11px] font-semibold text-slate-300"
                    >
                      {formatCoreRuleLabel(rule)}
                    </span>
                  ))}
                </div>
              )}

              {subgroupRows && subgroupRows.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    Category Pens
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {subgroupRows.map((sg) => (
                      <div
                        key={sg.id}
                        className="rounded-xl bg-slate-950/80 border border-slate-800 px-3 py-2 flex items-center justify-between gap-2 text-xs"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className={`rounded-md border px-2 py-0.5 font-extrabold shrink-0 ${penPillTone(
                              sg.label,
                            )}`}
                          >
                            Cat {sg.label}
                          </span>
                          <span className="text-slate-300 truncate">
                            {sg.paceRange ?? sg.distance ?? sg.duration ?? 'Open'}
                          </span>
                        </div>
                        <span className="text-slate-400 font-semibold tabular-nums shrink-0">
                          {sg.count} {sg.count === 1 ? 'rider' : 'riders'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {sortedEntrants.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                Signed-up Riders ({sortedEntrants.length} on ZwiftPower)
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {sortedEntrants.slice(0, 16).map((entrant, idx) => {
                  const riderId = entrant.zwid;
                  const fav = typeof riderId === 'number' && isFavorite(riderId);
                  const pen = penLabelFromNumber(entrant.label);
                  const displayName =
                    decodeHtmlEntities(entrant.name) ||
                    (riderId ? `Rider #${riderId}` : `Entrant ${idx + 1}`);
                  const team = decodeHtmlEntities(entrant.tname);
                  return (
                    <div
                      key={`${riderId ?? 'anon'}-${idx}`}
                      className={`rounded-lg border px-2.5 py-1.5 flex items-center justify-between gap-2 text-xs ${
                        fav
                          ? 'bg-amber-500/10 border-amber-400/40'
                          : 'bg-slate-950/70 border-slate-800/80'
                      }`}
                    >
                      <div className="min-w-0 flex items-center gap-1.5">
                        {fav && (
                          <span className="text-amber-300 shrink-0" aria-hidden="true">
                            ★
                          </span>
                        )}
                        {typeof riderId === 'number' ? (
                          <Link
                            to={`/riders/${riderId}`}
                            className="font-semibold text-slate-100 hover:text-accent-text hover:underline truncate"
                          >
                            {displayName}
                          </Link>
                        ) : (
                          <span className="font-semibold text-slate-200 truncate">
                            {displayName}
                          </span>
                        )}
                        {team && (
                          <span className="text-[11px] text-slate-400 truncate">· {team}</span>
                        )}
                      </div>
                      {pen && (
                        <span
                          className={`rounded-full border px-1.5 py-0 text-[10px] font-extrabold shrink-0 ${penPillTone(
                            pen,
                          )}`}
                        >
                          {pen}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
              {sortedEntrants.length > 16 && (
                <p className="text-[11px] text-slate-500">
                  Showing first 16 of {sortedEntrants.length} ZwiftPower signups.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </article>
  );
}
