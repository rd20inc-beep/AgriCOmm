/**
 * Skeleton loading components for smooth UX during data fetching.
 */

export function SkeletonBox({ className = '', style }) {
  return <div className={`skeleton ${className}`} style={style} />;
}

export function SkeletonText({ lines = 3, className = '' }) {
  return (
    <div className={`space-y-2 ${className}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="skeleton skeleton-text" style={{ width: `${80 - i * 15}%` }} />
      ))}
    </div>
  );
}

export function SkeletonKPIGrid({ count = 6 }) {
  return (
    <div className="kpi-grid">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="bg-white rounded-xl border border-gray-100 p-5">
          <div className="flex items-start justify-between">
            <div className="flex-1 space-y-3">
              <div className="skeleton skeleton-text-sm" />
              <div className="skeleton" style={{ height: '1.75rem', width: '50%' }} />
              <div className="skeleton skeleton-text-sm" style={{ width: '70%' }} />
            </div>
            <div className="skeleton skeleton-circle" style={{ width: '2.5rem', height: '2.5rem' }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function SkeletonTable({ rows = 5, cols = 5 }) {
  return (
    <div className="table-container">
      <div className="table-scroll">
        <table className="w-full">
          <thead>
            <tr>
              {Array.from({ length: cols }).map((_, i) => (
                <th key={i} className="px-4 py-3">
                  <div className="skeleton skeleton-text-sm" style={{ width: `${60 + (i % 3) * 10}%` }} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rows }).map((_, r) => (
              <tr key={r}>
                {Array.from({ length: cols }).map((_, c) => (
                  <td key={c} className="px-4 py-3">
                    <div className="skeleton skeleton-text" style={{ width: `${50 + ((r + c) % 4) * 12}%` }} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function SkeletonChart({ height = '16rem' }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-5">
      <div className="skeleton skeleton-text-sm mb-4" style={{ width: '30%' }} />
      <div className="skeleton" style={{ height }} />
    </div>
  );
}

export function SkeletonDashboard() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <div className="skeleton skeleton-heading" />
          <div className="skeleton skeleton-text-sm" style={{ width: '12rem' }} />
        </div>
        <div className="skeleton" style={{ width: '8rem', height: '2.25rem' }} />
      </div>
      <SkeletonKPIGrid count={8} />
      <div className="skeleton" style={{ height: '5rem', borderRadius: 'var(--radius-lg)' }} />
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <div className="lg:col-span-3 space-y-4">
          <SkeletonChart />
          <SkeletonChart />
        </div>
        <div className="lg:col-span-2 space-y-4">
          <SkeletonChart height="12rem" />
          <SkeletonChart height="12rem" />
        </div>
      </div>
    </div>
  );
}

export function SkeletonPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <div className="skeleton skeleton-heading" />
          <div className="skeleton skeleton-text-sm" style={{ width: '16rem' }} />
        </div>
      </div>
      <div className="flex gap-3">
        {[1,2,3].map(i => <div key={i} className="skeleton" style={{ width: '6rem', height: '2.25rem' }} />)}
      </div>
      <SkeletonTable rows={8} cols={6} />
    </div>
  );
}
