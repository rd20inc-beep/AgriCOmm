import { Link } from 'react-router-dom';
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

export default function YieldDistributionChart({ data }) {
  return (
    <div className="bg-white rounded-xl shadow-sm p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">
          Yield Distribution
        </h2>
        <Link to="/milling" className="text-xs text-blue-600 hover:text-blue-800 font-medium">View All &rarr;</Link>
      </div>
      <div className="h-48 sm:h-52">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={50}
              outerRadius={80}
              dataKey="value"
              paddingAngle={2}
            >
              {data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.fill} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                backgroundColor: '#fff',
                border: '1px solid #e2e8f0',
                borderRadius: '8px',
                fontSize: '12px',
              }}
              formatter={(value) => [`${value}%`, undefined]}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 mt-3">
        {data.map((item) => (
          <div key={item.name} className="flex items-center gap-1.5 text-xs text-gray-600">
            <span
              className="w-2.5 h-2.5 rounded-full inline-block"
              style={{ backgroundColor: item.fill }}
            />
            {item.name} {item.value}%
          </div>
        ))}
      </div>
    </div>
  );
}
