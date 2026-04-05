const colorMap = {
  blue:    { bg: 'bg-blue-50',    icon: 'text-blue-600',    ring: 'ring-blue-100' },
  green:   { bg: 'bg-emerald-50', icon: 'text-emerald-600', ring: 'ring-emerald-100' },
  red:     { bg: 'bg-red-50',     icon: 'text-red-600',     ring: 'ring-red-100' },
  amber:   { bg: 'bg-amber-50',   icon: 'text-amber-600',   ring: 'ring-amber-100' },
  purple:  { bg: 'bg-purple-50',  icon: 'text-purple-600',  ring: 'ring-purple-100' },
  violet:  { bg: 'bg-violet-50',  icon: 'text-violet-600',  ring: 'ring-violet-100' },
  indigo:  { bg: 'bg-indigo-50',  icon: 'text-indigo-600',  ring: 'ring-indigo-100' },
  cyan:    { bg: 'bg-cyan-50',    icon: 'text-cyan-600',    ring: 'ring-cyan-100' },
  orange:  { bg: 'bg-orange-50',  icon: 'text-orange-600',  ring: 'ring-orange-100' },
  emerald: { bg: 'bg-emerald-50', icon: 'text-emerald-600', ring: 'ring-emerald-100' },
};

export default function KPICard({ icon: Icon, title, value, subtitle, trend, color = 'blue' }) {
  const colors = colorMap[color] || colorMap.blue;

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4 sm:p-5 hover:shadow-md transition-shadow group">
      <div className="flex items-start gap-3">
        {Icon && (
          <div className={`flex items-center justify-center w-10 h-10 rounded-xl ${colors.bg} ring-1 ${colors.ring} flex-shrink-0 group-hover:scale-105 transition-transform`}>
            <Icon size={20} className={colors.icon} />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide truncate">{title}</p>
          <p className="mt-1 text-lg sm:text-xl font-bold text-gray-900 tabular-nums truncate">{value}</p>
          {subtitle && (
            <p className="mt-1 text-xs text-gray-400 truncate">{typeof trend === 'string' && trend !== 'up' && trend !== 'down' ? trend : subtitle}</p>
          )}
        </div>
      </div>
    </div>
  );
}
