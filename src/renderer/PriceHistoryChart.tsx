import type { FavoritePricePoint } from "../shared/types";

export function PriceHistoryChart({ points }: { points: FavoritePricePoint[] }) {
  const sorted = [...points].sort((left, right) => left.recordedAt - right.recordedAt);
  const values = sorted.flatMap((point) => [point.salePrice, point.costPrice]).filter((value): value is number => value !== null);
  if (!values.length) return <div className="chart-empty">最近三天还没有可用价格记录；完成一次覆盖全部页数的查询后会自动记录。</div>;

  const width = 760;
  const height = 280;
  const padding = { left: 58, right: 24, top: 28, bottom: 44 };
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const range = Math.max(1, maxValue - minValue);
  const minTime = sorted[0]?.recordedAt ?? Date.now();
  const maxTime = sorted.at(-1)?.recordedAt ?? minTime;
  const timeRange = Math.max(1, maxTime - minTime);
  const x = (time: number) => padding.left + ((time - minTime) / timeRange) * (width - padding.left - padding.right);
  const y = (value: number) => padding.top + ((maxValue - value) / range) * (height - padding.top - padding.bottom);
  const pathFor = (field: "salePrice" | "costPrice") => sorted
    .filter((point) => point[field] !== null)
    .map((point, index) => `${index ? "L" : "M"}${x(point.recordedAt).toFixed(1)},${y(point[field]!).toFixed(1)}`)
    .join(" ");
  const timeLabel = (time: number) => new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(time);

  return (
    <div className="history-chart-wrap">
      <div className="chart-legend"><span className="sale-line">售价</span><span className="cost-line">成本价</span><span>30 分钟内取最低价</span></div>
      <svg className="history-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="收藏商品最近三天价格曲线">
        {[0, 0.5, 1].map((ratio) => {
          const value = maxValue - range * ratio;
          const lineY = padding.top + (height - padding.top - padding.bottom) * ratio;
          return <g key={ratio}><line x1={padding.left} x2={width - padding.right} y1={lineY} y2={lineY} className="chart-grid" /><text x={padding.left - 8} y={lineY + 4} textAnchor="end">¥{value.toFixed(2)}</text></g>;
        })}
        {pathFor("salePrice") && <path d={pathFor("salePrice")} className="chart-path chart-sale" />}
        {pathFor("costPrice") && <path d={pathFor("costPrice")} className="chart-path chart-cost" />}
        {sorted.map((point) => <g key={point.recordedAt}>
          {point.salePrice !== null && <circle cx={x(point.recordedAt)} cy={y(point.salePrice)} r="4" className="chart-dot chart-sale-dot"><title>{timeLabel(point.recordedAt)} 售价 ¥{point.salePrice} 库存 {point.stock ?? "—"}</title></circle>}
          {point.costPrice !== null && <circle cx={x(point.recordedAt)} cy={y(point.costPrice)} r="3.5" className="chart-dot chart-cost-dot"><title>{timeLabel(point.recordedAt)} 成本价 ¥{point.costPrice}</title></circle>}
        </g>)}
        <text x={padding.left} y={height - 12}>{timeLabel(minTime)}</text>
        <text x={width - padding.right} y={height - 12} textAnchor="end">{timeLabel(maxTime)}</text>
      </svg>
    </div>
  );
}
