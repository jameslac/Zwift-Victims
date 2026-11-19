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
