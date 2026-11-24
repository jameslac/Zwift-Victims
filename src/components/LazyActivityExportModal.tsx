import { Suspense, lazy } from 'react';
import type { ComponentProps } from 'react';

const ActivityExportModal = lazy(() => import('./ActivityExportModal'));

export default function LazyActivityExportModal(props: ComponentProps<typeof ActivityExportModal>) {
  return (
    <Suspense
      fallback={
        <div
          role="status"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
        >
          <div className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-xs font-semibold text-slate-200 shadow-2xl">
            Loading telemetry exporter…
          </div>
        </div>
      }
    >
      <ActivityExportModal {...props} />
    </Suspense>
  );
}
