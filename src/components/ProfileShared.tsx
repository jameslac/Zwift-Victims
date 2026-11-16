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

export function MetricGrid({
  items,
  columnsClass = 'grid-cols-2 sm:grid-cols-3 md:grid-cols-6',
}: {
  items: Array<{ label: string; value: string | number | undefined }>;
  columnsClass?: string;
}) {
  return (
    <dl className={`grid ${columnsClass} gap-2 text-xs`}>
      {items.map((item) => (
        <div key={item.label} className="rounded-lg bg-slate-900/70 border border-slate-800/80 p-2.5">
          <dt className="text-slate-400">{item.label}</dt>
          <dd className="mt-0.5 font-semibold text-sm">{item.value ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}
