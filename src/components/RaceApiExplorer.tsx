import { useMemo } from 'react';
import type {
  ZwiftActivity,
  ZwiftActivityDetail,
  ZwiftPublicEvent,
  ZwiftRaceResultEntry,
} from '../api/zwiftCore';
import type { ZwiftPowerRaceEntry } from '../api/zwiftPower';
import type {
  ZwiftRacingEventResponse,
  ZwiftRacingEventRider,
  ZwiftRacingRaceEntry,
} from '../api/zwiftRacing';
import { collectKeys, flatten } from '../lib/raceHistory';
import type { AsyncState } from '../lib/raceHistory';
import { AttributeKeysSummary, AttributeList } from './RaceUi';

export interface ApiSourceStatus {
  id: string;
  provider: string;
  endpoint: string;
  status: 'loading' | 'loaded' | 'error' | 'unavailable';
  summary: string;
}

function StatusPill({ status }: { status: ApiSourceStatus['status'] }) {
  const styles: Record<ApiSourceStatus['status'], string> = {
    loaded: 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300',
    loading: 'bg-slate-700/40 border-slate-600 text-slate-300',
    error: 'bg-red-500/20 border-red-500/40 text-red-300',
    unavailable: 'bg-slate-800 border-slate-700 text-slate-400',
  };
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${styles[status]}`}>
      {status}
    </span>
  );
}

function PayloadAccordion({
  title,
  data,
  allKeys,
  allKeysLabel,
}: {
  title: string;
  data: unknown;
  allKeys?: string[];
  allKeysLabel?: string;
}) {
  const rows = useMemo(() => (data !== undefined ? flatten(data) : []), [data]);
  if (data === undefined && (!allKeys || allKeys.length === 0)) return null;

  return (
    <div className="space-y-2">
      {allKeys && allKeys.length > 0 && allKeysLabel && (
        <AttributeKeysSummary label={allKeysLabel} keys={allKeys} />
      )}
      {data !== undefined && (
        <details className="rounded-xl bg-slate-950/70 border border-slate-800 p-4">
          <summary className="cursor-pointer text-sm font-medium text-slate-300">
            {title} ({rows.length} fields)
          </summary>
          <AttributeList rows={rows} />
        </details>
      )}
    </div>
  );
}

export default function RaceApiExplorer({
  sources,
  zpProfileEntry,
  zpViewEntry,
  zpZwiftEntry,
  zpViewAll,
  zpZwiftAll,
  zrEntry,
  zrEvent,
  zrEventRider,
  publicEvent,
  coreSubgroupEntry,
  coreSubgroupAll,
  matchedActivity,
  activityDetail,
}: {
  sources: ApiSourceStatus[];
  zpProfileEntry?: ZwiftPowerRaceEntry;
  zpViewEntry?: ZwiftPowerRaceEntry;
  zpZwiftEntry?: ZwiftPowerRaceEntry;
  zpViewAll: AsyncState<ZwiftPowerRaceEntry[]>;
  zpZwiftAll: AsyncState<ZwiftPowerRaceEntry[]>;
  zrEntry?: ZwiftRacingRaceEntry;
  zrEvent: AsyncState<ZwiftRacingEventResponse | null>;
  zrEventRider?: ZwiftRacingEventRider;
  publicEvent: AsyncState<ZwiftPublicEvent>;
  coreSubgroupEntry?: ZwiftRaceResultEntry;
  coreSubgroupAll: AsyncState<ZwiftRaceResultEntry[]> | null;
  matchedActivity?: ZwiftActivity;
  activityDetail: AsyncState<ZwiftActivityDetail> | null;
}) {
  const zpViewKeys = useMemo(
    () => (zpViewAll.status === 'loaded' ? collectKeys(zpViewAll.data) : []),
    [zpViewAll],
  );
  const zpZwiftKeys = useMemo(
    () => (zpZwiftAll.status === 'loaded' ? collectKeys(zpZwiftAll.data) : []),
    [zpZwiftAll],
  );
  const zrEventRiderKeys = useMemo(() => {
    if (zrEvent.status !== 'loaded' || !zrEvent.data) return [];
    const riders = (zrEvent.data.pens ?? []).flatMap((p) => p.riders ?? []);
    return collectKeys(riders);
  }, [zrEvent]);
  const zrEventMeta = useMemo(() => {
    if (zrEvent.status !== 'loaded' || !zrEvent.data) return undefined;
    const { courseProfile: _cp, pens, ...rest } = zrEvent.data;
    return {
      ...rest,
      courseProfilePoints: zrEvent.data.courseProfile?.points?.length ?? 0,
      pens: pens?.map(({ riders, ...penMeta }) => ({
        ...penMeta,
        riderCount: riders?.length ?? 0,
      })),
    };
  }, [zrEvent]);
  const coreSubgroupKeys = useMemo(
    () => (coreSubgroupAll?.status === 'loaded' ? collectKeys(coreSubgroupAll.data) : []),
    [coreSubgroupAll],
  );

  return (
    <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-8 space-y-4">
      <div>
        <h2 className="text-lg font-bold">API Data Coverage &amp; Raw Payloads</h2>
        <p className="text-xs text-slate-400">
          Overview of every race API endpoint queried for this event and all raw fields returned so
          we can decide what to keep or trim.
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="border-b border-slate-800 text-slate-400 uppercase tracking-wide">
              <th className="py-2 pr-3">Provider</th>
              <th className="py-2 pr-3">Endpoint</th>
              <th className="py-2 pr-3">Status</th>
              <th className="py-2">Result</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/70">
            {sources.map((src) => (
              <tr key={src.id}>
                <td className="py-2 pr-3 font-medium whitespace-nowrap">{src.provider}</td>
                <td className="py-2 pr-3 font-mono text-slate-400 break-all">{src.endpoint}</td>
                <td className="py-2 pr-3 whitespace-nowrap">
                  <StatusPill status={src.status} />
                </td>
                <td className="py-2 text-slate-300">{src.summary}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="space-y-2 pt-2">
        <PayloadAccordion
          title="ZwiftPower Profile History Entry (/cache3/profile/{riderId}_all.json)"
          data={zpProfileEntry}
        />
        <PayloadAccordion
          title="ZwiftPower Event _view Rider Entry"
          data={zpViewEntry}
          allKeys={zpViewKeys}
          allKeysLabel="All keys in ZwiftPower _view.json"
        />
        <PayloadAccordion
          title="ZwiftPower Event _zwift Rider Entry"
          data={zpZwiftEntry}
          allKeys={zpZwiftKeys}
          allKeysLabel="All keys in ZwiftPower _zwift.json"
        />
        <PayloadAccordion
          title="ZwiftRacing.app Event Metadata (/api/zwiftracing/events/{eventId})"
          data={zrEventMeta}
        />
        <PayloadAccordion
          title="ZwiftRacing.app Event Rider Entry"
          data={zrEventRider}
          allKeys={zrEventRiderKeys}
          allKeysLabel="All keys in ZwiftRacing.app event riders"
        />
        <PayloadAccordion
          title="ZwiftRacing.app Rider History Entry (overview.history)"
          data={zrEntry}
        />
        <PayloadAccordion
          title="Zwift Core Public Event (/api/public/events/{eventId})"
          data={publicEvent.status === 'loaded' ? publicEvent.data : undefined}
        />
        <PayloadAccordion
          title="Zwift Core Subgroup Entry (/api/race-results/entries)"
          data={coreSubgroupEntry}
          allKeys={coreSubgroupKeys}
          allKeysLabel="All keys in Zwift Core /api/race-results/entries"
        />
        <PayloadAccordion
          title="Zwift Core Activity Feed Item (/api/profiles/{riderId}/activities)"
          data={matchedActivity}
        />
        <PayloadAccordion
          title="Zwift Core Activity Detail (/api/activities/{id_str}?fetchSnapshots=true&fetchEvent=true)"
          data={activityDetail?.status === 'loaded' ? activityDetail.data : undefined}
        />
      </div>
    </section>
  );
}
