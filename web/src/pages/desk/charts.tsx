import { useState } from "react";

// Drawn at about the size it shows in a half-width panel, so 13px text stays 13px.
const W = 420;
const PAD = { top: 18, right: 10, bottom: 28, left: 28 };

type Tip = { x: number; y: number; text: string } | null;

// Positions are in SVG units; percentages keep the tip on its mark as the chart scales.
function Tooltip({ tip, height }: { tip: Tip; height: number }) {
  if (!tip) return null;
  return (
    <div
      className="chart-tip"
      style={{ left: `${(tip.x / W) * 100}%`, top: `${(tip.y / height) * 100}%` }}
      role="presentation"
    >
      {tip.text}
    </div>
  );
}

// A column with a 4px rounded top and a square base.
function columnPath(x: number, y: number, w: number, h: number) {
  const r = Math.min(4, h, w / 2);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

type ColumnProps = {
  title: string;
  values: { day: number; value: number }[];
  max: number;
  ticks: number[];
  unit: (value: number) => string;
  // How the tooltip names a day. The demo says "Day 3"; real data says the date.
  tipLabel?: (day: number) => string;
};

export function ColumnChart({ title, values, max, ticks, unit, tipLabel = (d) => `Day ${d}` }: ColumnProps) {
  const [hover, setHover] = useState<number | null>(null);
  const H = 170;
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const band = plotW / values.length;
  const barW = Math.min(16, band * 0.6);
  const y = (v: number) => PAD.top + plotH - (v / max) * plotH;
  const last = values[values.length - 1];
  const tip: Tip =
    hover === null
      ? null
      : {
          x: PAD.left + band * hover + band / 2,
          y: y(values[hover].value) - 8,
          text: `${tipLabel(values[hover].day)}: ${unit(values[hover].value)}`,
        };

  return (
    <figure className="chart">
      <figcaption>{title}</figcaption>
      <div className="chart-box">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}, 14 days. Last day: ${unit(last.value)}.`}>
          {ticks.map((t) => (
            <g key={t}>
              <line className="chart-grid" x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} />
              <text className="chart-axis" x={PAD.left - 8} y={y(t) + 4} textAnchor="end">
                {t}
              </text>
            </g>
          ))}
          {values.map((d, i) => {
            const x = PAD.left + band * i + (band - barW) / 2;
            const h = Math.max(0, y(0) - y(d.value));
            return (
              <g key={d.day}>
                {h > 0 ? (
                  <path
                    className={hover === i ? "chart-col chart-col-on" : "chart-col"}
                    d={columnPath(x, y(d.value), barW, h)}
                  />
                ) : null}
                {d.day % 2 === 1 || i === values.length - 1 ? (
                  <text className="chart-axis" x={x + barW / 2} y={H - 8} textAnchor="middle">
                    {d.day}
                  </text>
                ) : null}
                <rect
                  className="chart-hit"
                  x={PAD.left + band * i}
                  y={PAD.top}
                  width={band}
                  height={plotH}
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                />
              </g>
            );
          })}
          <text
            className="chart-value"
            x={PAD.left + band * (values.length - 1) + band / 2}
            y={y(last.value) - 6}
            textAnchor="middle"
          >
            {last.value}
          </text>
        </svg>
        <Tooltip tip={tip} height={H} />
      </div>
      <p className="chart-x" aria-hidden="true">Day</p>
    </figure>
  );
}

type Level = string;

type DotProps = {
  title: string;
  levels: Level[];
  values: { day: number; level: Level | null }[];
  emptyLabel: string;
  tipLabel?: (day: number) => string;
};

// Ordinal dots: one row per level, a hollow tick on the baseline when nothing was said.
export function DotChart({ title, levels, values, emptyLabel, tipLabel = (d) => `Day ${d}` }: DotProps) {
  const [hover, setHover] = useState<number | null>(null);
  const rows = [...levels, emptyLabel];
  const H = 26 * rows.length + PAD.top + PAD.bottom;
  const left = 72;
  const plotW = W - left - PAD.right;
  const band = plotW / values.length;
  const rowY = (index: number) => PAD.top + 8 + index * 26;
  const tip: Tip =
    hover === null
      ? null
      : {
          x: left + band * hover + band / 2,
          y: rowY(values[hover].level ? levels.indexOf(values[hover].level!) : rows.length - 1) - 12,
          text: `${tipLabel(values[hover].day)}: ${values[hover].level ?? emptyLabel}`,
        };

  return (
    <figure className="chart">
      <figcaption>{title}</figcaption>
      <div className="chart-box">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}, 14 days.`}>
          {rows.map((row, r) => (
            <g key={row}>
              <line className="chart-grid" x1={left} x2={W - PAD.right} y1={rowY(r)} y2={rowY(r)} />
              <text className="chart-axis" x={left - 10} y={rowY(r) + 4} textAnchor="end">
                {row}
              </text>
            </g>
          ))}
          {values.map((d, i) => {
            const cx = left + band * i + band / 2;
            const r = d.level ? levels.indexOf(d.level) : rows.length - 1;
            return (
              <g key={d.day}>
                {d.level ? (
                  <circle className="chart-dot" cx={cx} cy={rowY(r)} r={hover === i ? 7 : 5.5} />
                ) : (
                  <circle className="chart-dot-empty" cx={cx} cy={rowY(r)} r={4} />
                )}
                {d.day % 2 === 1 || i === values.length - 1 ? (
                  <text className="chart-axis" x={cx} y={H - 8} textAnchor="middle">
                    {d.day}
                  </text>
                ) : null}
                <rect
                  className="chart-hit"
                  x={left + band * i}
                  y={PAD.top}
                  width={band}
                  height={H - PAD.top - PAD.bottom}
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                />
              </g>
            );
          })}
        </svg>
        <Tooltip tip={tip} height={H} />
      </div>
      <p className="chart-x" aria-hidden="true">Day</p>
    </figure>
  );
}
