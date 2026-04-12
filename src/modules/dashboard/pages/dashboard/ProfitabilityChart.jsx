import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';

export default function ProfitabilityChart({ data }) {
  return (
    <div className="bg-white rounded-xl shadow-sm p-5">
      <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-4">
        Export Profitability Trend
      </h2>
      <div className="h-48 sm:h-64 lg:h-72">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={data}
            margin={{ top: 5, right: 20, left: 0, bottom: 5 }}
          >
            <defs>
              <linearGradient id="colorExport" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.15} />
                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="colorMill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#10b981" stopOpacity={0.15} />
                <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis
              dataKey="month"
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 12, fill: '#94a3b8' }}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 12, fill: '#94a3b8' }}
              tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: '#fff',
                border: '1px solid #e2e8f0',
                borderRadius: '8px',
                fontSize: '12px',
              }}
              formatter={(value) => [`$${value.toLocaleString()}`, undefined]}
            />
            <Legend
              verticalAlign="top"
              align="right"
              iconType="circle"
              iconSize={8}
              wrapperStyle={{ fontSize: '12px', paddingBottom: '8px' }}
            />
            <Area
              type="monotone"
              dataKey="export"
              name="Export Profit"
              stroke="#3b82f6"
              strokeWidth={2}
              fillOpacity={1}
              fill="url(#colorExport)"
            />
            <Area
              type="monotone"
              dataKey="mill"
              name="Mill Profit"
              stroke="#10b981"
              strokeWidth={2}
              fillOpacity={1}
              fill="url(#colorMill)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
