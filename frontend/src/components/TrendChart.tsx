import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { formatNumber, formatPercent } from "../format";
import type { ChannelOverview } from "../types";

export function TrendChart({ data }: { data: ChannelOverview["trend"] }) {
  return (
    <div className="chart-wrap" aria-label="Views and engagement trend chart">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 12, right: 8, bottom: 0, left: -12 }}>
          <CartesianGrid stroke="#29292f" vertical={false} />
          <XAxis dataKey="date" stroke="#787882" tickLine={false} axisLine={false} fontSize={12} />
          <YAxis yAxisId="views" stroke="#787882" tickLine={false} axisLine={false} fontSize={12} tickFormatter={formatNumber} />
          <YAxis yAxisId="engagement" orientation="right" hide domain={[0, 0.1]} />
          <Tooltip content={<ChartTooltip />} cursor={{ stroke: "#50505a", strokeDasharray: "4 4" }} />
          <Area yAxisId="views" type="monotone" dataKey="views" stroke="#ff2d3d" strokeWidth={2.5} fill="#ff2d3d" fillOpacity={0.12} isAnimationActive={false} activeDot={{ r: 5, fill: "#ff2d3d", stroke: "#0b0b0d", strokeWidth: 3 }} />
          <Line yAxisId="engagement" type="monotone" dataKey="engagementRate" stroke="#32d3e6" strokeWidth={2} dot={false} isAnimationActive={false} activeDot={{ r: 4, fill: "#32d3e6" }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ dataKey: string; value: number }>; label?: string }) {
  if (!active || !payload?.length) return null;
  const views = payload.find((item) => item.dataKey === "views")?.value ?? 0;
  const engagement = payload.find((item) => item.dataKey === "engagementRate")?.value ?? 0;
  return <div className="chart-tooltip"><strong>{label}</strong><span>{formatNumber(views)} views</span><span>{formatPercent(engagement)} engagement</span></div>;
}
