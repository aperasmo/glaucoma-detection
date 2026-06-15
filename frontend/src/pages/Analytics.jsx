// src/pages/Analytics.jsx
// Analytics Dashboard - Tailwind CSS implementation.
// Connects to GET /screenings/stats and GET /screenings/analytics?days=30

import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import Layout from "../components/Layout";
import API from "../api/index";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  BarChart, Bar, Cell,
  PieChart, Pie, Sector,
} from "recharts";

// Stat card with icon
function StatCard({ label, value, sub, subColor, icon, iconBg }) {
  return (
    <div className="bg-surface border border-white/7 rounded-xl p-4 flex items-center gap-4">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-xl flex-shrink-0 ${iconBg || "bg-accent/20"}`}>
        {icon}
      </div>
      <div>
        <div className="text-xs text-text3 uppercase tracking-wider mb-1">{label}</div>
        <div className="text-2xl font-bold font-mono text-text1 leading-none mb-1">{value ?? "—"}</div>
        {sub && <div className={`text-xs ${subColor || "text-text3"}`}>{sub}</div>}
      </div>
    </div>
  );
}

// Result badge
function ResultBadge({ prediction }) {
  const map = {
    glaucoma: "bg-neg/10 text-neg border-neg/20",
    normal:   "bg-pos/10 text-pos border-pos/20",
  };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border capitalize ${map[prediction?.toLowerCase()] || "bg-warn/10 text-warn border-warn/20"}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current" />
      {prediction || "—"}
    </span>
  );
}

// OHTS badge
function OHTSBadge({ tier }) {
  const map = {
    critical: "bg-neg/10 text-neg border-neg/20",
    possible: "bg-warn/10 text-warn border-warn/20",
    low:      "bg-pos/10 text-pos border-pos/20",
  };
  return tier ? (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border capitalize ${map[tier?.toLowerCase()] || ""}`}>
      {tier}
    </span>
  ) : <span className="text-text3 text-xs">—</span>;
}

// Risk bar
function RiskBar({ score }) {
  if (!score) return <span className="text-text3 text-xs">—</span>;
  const pct = Math.round(parseFloat(score) * 100);
  const color = pct > 70 ? "bg-neg" : pct > 50 ? "bg-warn" : "bg-pos";
  return (
    <div className="flex items-center gap-2">
      <div className="w-14 h-1.5 bg-surface3 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-text2 font-mono">{parseFloat(score).toFixed(2)}</span>
    </div>
  );
}

const RANGE_OPTIONS = [
  { label: "Last 7 Days", value: "7" },
  { label: "Last 30 Days", value: "30" },
  { label: "Last 90 Days", value: "90" },
  { label: "Custom Date Range", value: "custom" },
];

function toDateInputValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function getTodayInputValue() {
  return toDateInputValue(new Date());
}

function getDaysAgoInputValue(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);

  return toDateInputValue(date);
}

const CHART_COLORS = {
  accent: "#3B9EFF",
  neg:    "#FF6B6B",
  pos:    "#22C994",
  warn:   "#FFB84D",
  text3:  "#4E6580",
};

// Custom donut label
function DonutLabel({ cx, cy, label, sub }) {
  return (
    <>
      <text x={cx} y={cy - 8} textAnchor="middle" fill="#E8EEF7" fontSize={22} fontWeight={700} fontFamily="DM Mono,monospace">
        {label}
      </text>
      <text x={cx} y={cy + 14} textAnchor="middle" fill="#8FA3BF" fontSize={11} fontFamily="DM Sans,sans-serif">
        {sub}
      </text>
    </>
  );
}

function Analytics() {
const navigate = useNavigate();
const [rangeType, setRangeType] = useState("7");
const [startDate, setStartDate] = useState(getDaysAgoInputValue(7));
const [endDate, setEndDate] = useState(getTodayInputValue());

const [stats, setStats] = useState(null);
const [analytics, setAnalytics] = useState(null);
const [loading, setLoading] = useState(true);
const [page, setPage] = useState(1);
const PER_PAGE = 5;

const isCustomRange = rangeType === "custom";
const isInvalidDateRange =
  isCustomRange &&
  startDate &&
  endDate &&
  startDate > endDate;

useEffect(() => {
  if (isCustomRange && (!startDate || !endDate || isInvalidDateRange)) {
    return;
  }

  const params = new URLSearchParams();

  if (isCustomRange) {
    params.set("start_date", startDate);
    params.set("end_date", endDate);
  } else {
    params.set("days", rangeType);
  }

  setLoading(true);

  Promise.all([
    API.get("/screenings/stats"),
    API.get(`/screenings/analytics?${params.toString()}`),
  ])
    .then(([statsRes, analyticsRes]) => {
      setStats(statsRes.data);
      setAnalytics(analyticsRes.data);
      setLoading(false);
      setPage(1);
    })
    .catch(() => setLoading(false));
}, [rangeType, startDate, endDate, isCustomRange, isInvalidDateRange]);

function handleRangeTypeChange(value) {
  setRangeType(value);
  setPage(1);

  if (value !== "custom") {
    const selectedDays = Number(value);
    setStartDate(getDaysAgoInputValue(selectedDays));
    setEndDate(getTodayInputValue());
  }
}

  function formatDate(d) {
    if (!d) return "-";
    return new Date(d).toLocaleDateString("en-NZ", {
      day: "2-digit", month: "short", year: "numeric",
      timeZone: "Pacific/Auckland",
    });
  }

  function formatShortDate(d) {
    if (!d) return "";
    return new Date(d).toLocaleDateString("en-NZ", {
      day: "numeric", month: "short",
      timeZone: "Pacific/Auckland",
    });
  }

  function calcAge(dob) {
    if (!dob) return "-";
    return Math.floor((Date.now() - new Date(dob).getTime()) / (1000 * 60 * 60 * 24 * 365.25));
  }

  // Pagination for high risk table
  const highRisk = analytics?.high_risk_screenings || [];
  const totalPages = Math.ceil(highRisk.length / PER_PAGE);
  const paginatedRisk = highRisk.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  // Donut chart data
  const predictionData = [
    { name: "Normal",   value: stats?.normal_count        || 0, color: CHART_COLORS.pos },
    { name: "Glaucoma", value: stats?.glaucoma_positive   || 0, color: CHART_COLORS.neg },
  ];
  const totalPredictions = (stats?.normal_count || 0) + (stats?.glaucoma_positive || 0);
  const normalPct = totalPredictions > 0 ? Math.round((stats?.normal_count || 0) / totalPredictions * 100) : 0;

  const statusData = analytics ? [
    { name: "Complete",   value: analytics.status_distribution?.complete   || 0, color: CHART_COLORS.pos },
    { name: "Pending",    value: analytics.status_distribution?.pending    || 0, color: CHART_COLORS.warn },
    { name: "Failed",     value: analytics.status_distribution?.failed     || 0, color: CHART_COLORS.neg },
  ] : [];
  const totalStatus = statusData.reduce((a, b) => a + b.value, 0);
  const completePct = totalStatus > 0 ? Math.round((analytics?.status_distribution?.complete || 0) / totalStatus * 100) : 0;

  // OHTS bar data
  const ohtsData = analytics ? [
    { name: "Low",      value: analytics.ohts_distribution?.low      || 0, color: CHART_COLORS.pos },
    { name: "Possible", value: analytics.ohts_distribution?.possible  || 0, color: CHART_COLORS.warn },
    { name: "Critical", value: analytics.ohts_distribution?.critical  || 0, color: CHART_COLORS.neg },
  ] : [];

  // Model usage bar data
  const modelData = analytics ? [
    { name: "Clinical Mode",  value: analytics.model_usage?.clinical_mode  || 0 },
    { name: "Research Mode",  value: analytics.model_usage?.research_mode  || 0 },
  ] : [];

  // Screenings over time
  const timeData = (analytics?.screenings_over_time || []).map(d => ({
    ...d,
    date: formatShortDate(d.date),
  }));

  // Top bar actions
    const actions = (
    <div className="flex items-center gap-2">
        <select
        value={rangeType}
        onChange={e => handleRangeTypeChange(e.target.value)}
        className="bg-surface2 border border-border2 rounded-lg px-3 py-1.5 text-xs text-text2 outline-none cursor-pointer font-sans"
        >
        {RANGE_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>
            {o.label}
            </option>
        ))}
        </select>

        {isCustomRange && (
        <>
            <input
            type="date"
            value={startDate}
            max={endDate || undefined}
            onChange={e => setStartDate(e.target.value)}
            className="bg-surface2 border border-border2 rounded-lg px-3 py-1.5 text-xs text-text2 outline-none font-sans"
            />

            <span className="text-xs text-text3">to</span>

            <input
            type="date"
            value={endDate}
            min={startDate || undefined}
            onChange={e => setEndDate(e.target.value)}
            className="bg-surface2 border border-border2 rounded-lg px-3 py-1.5 text-xs text-text2 outline-none font-sans"
            />
        </>
        )}

        {isInvalidDateRange && (
        <span className="text-xs text-neg">
            Invalid date range
        </span>
        )}

        <button className="px-3 py-1.5 text-xs font-medium text-text2 border border-border2 rounded-lg bg-transparent hover:bg-surface2 transition-colors cursor-pointer font-sans flex items-center gap-1.5">
        📤 Export
        </button>
    </div>
    );
  if (loading) return (
    <Layout title="Analytics Dashboard" actions={actions}>
      <p className="text-text3 text-sm">Loading analytics...</p>
    </Layout>
  );

  return (
    <Layout title="Analytics Dashboard" actions={actions}>

      {/* Subtitle */}
      <p className="text-xs text-text3 mb-5">Clinical screening overview and insights</p>

      {/* STATS ROW 1 */}
      <div className="grid grid-cols-6 gap-3 mb-3">
        <StatCard label="Total Patients"    value={stats?.total_patients}    sub="Active patients"        icon="👥" iconBg="bg-accent/20" />
        <StatCard label="Total Screenings"  value={stats?.total_screenings ?? (stats?.glaucoma_positive + stats?.normal_count)}  sub="Completed screenings" icon="📋" iconBg="bg-accent/20" />
        <StatCard label="High Risk (Glaucoma)" value={stats?.glaucoma_positive} sub={`${stats?.glaucoma_percent ?? 0}% of total`} subColor="text-neg" icon="🛡" iconBg="bg-neg/20" />
        <StatCard label="Normal"            value={stats?.normal_count}      sub={`${100 - (stats?.glaucoma_percent ?? 0)}% of total`} subColor="text-pos" icon="✅" iconBg="bg-pos/20" />
        <StatCard label="Pending Review"    value={stats?.pending_count}     sub="Need attention"         icon="⏰" iconBg="bg-warn/20" subColor="text-warn" />
        <StatCard label="Failed Screenings" value={stats?.failed_count}      sub="Reprocess needed"       icon="⚠️" iconBg="bg-neg/20" subColor="text-neg" />
      </div>

      {/* STATS ROW 2 */}
      <div className="grid grid-cols-4 gap-3 mb-5">
        <StatCard label="Avg Confidence Score" value={stats?.avg_confidence_score?.toFixed(2)} sub="Across all screenings" icon="📊" iconBg="bg-accent/20" />
        <StatCard label="Avg CDR"           value={stats?.avg_cdr?.toFixed(2)}           sub="Across all screenings" icon="👁" iconBg="bg-accent/20" />
        <StatCard label="Possible OHTS"     value={stats?.possible_ohts_count}           sub={`${stats?.total_patients > 0 ? Math.round(stats?.possible_ohts_count / (stats?.glaucoma_positive + stats?.normal_count) * 100) : 0}% of total`} subColor="text-warn" icon="🛡" iconBg="bg-warn/20" />
        <StatCard label="Critical OHTS"     value={stats?.critical_ohts_count}           sub={`${stats?.total_patients > 0 ? Math.round(stats?.critical_ohts_count / (stats?.glaucoma_positive + stats?.normal_count) * 100) : 0}% of total`} subColor="text-neg" icon="🚨" iconBg="bg-neg/20" />
      </div>

      {/* CHARTS ROW 1 */}
      <div className="grid grid-cols-2 gap-4 mb-4">

        {/* Screenings Over Time */}
        <div className="bg-surface border border-white/7 rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-white/7">
            <span className="text-sm font-semibold text-text1">Screenings Over Time</span>
          </div>
          <div className="p-4">
            {timeData.length === 0 ? (
              <div className="h-48 flex items-center justify-center text-text3 text-sm">No data available</div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={timeData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="date" tick={{ fill: CHART_COLORS.text3, fontSize: 10 }} />
                  <YAxis tick={{ fill: CHART_COLORS.text3, fontSize: 10 }} />
                  <Tooltip
                    contentStyle={{ background: "#1A2840", border: "1px solid rgba(255,255,255,0.12)", borderRadius: "8px", fontSize: "12px" }}
                    labelStyle={{ color: "#E8EEF7" }}
                  />
                  <Legend wrapperStyle={{ fontSize: "11px", paddingTop: "8px" }} />
                  <Line type="monotone" dataKey="total"    name="Total Screenings" stroke={CHART_COLORS.accent} strokeWidth={2} dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="positive" name="Positive Cases"   stroke={CHART_COLORS.neg}    strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Positive vs Negative */}
        <div className="bg-surface border border-white/7 rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-white/7">
            <span className="text-sm font-semibold text-text1">Positive vs Negative</span>
          </div>
          <div className="p-4 flex items-center justify-center gap-8">
            <PieChart width={180} height={180}>
              <Pie
                data={predictionData}
                cx={90} cy={90}
                innerRadius={55} outerRadius={80}
                dataKey="value"
                startAngle={90} endAngle={-270}
              >
                {predictionData.map((entry, i) => (
                  <Cell key={i} fill={entry.color} />
                ))}
                <DonutLabel cx={90} cy={90} label={`${normalPct}%`} sub="Normal" />
              </Pie>
            </PieChart>
            <div className="flex flex-col gap-3">
              {predictionData.map(d => (
                <div key={d.name} className="flex items-center gap-3">
                  <div className="w-3 h-3 rounded-sm flex-shrink-0" style={{ background: d.color }} />
                  <div>
                    <div className="text-sm font-semibold text-text1">{d.name}</div>
                    <div className="text-xs text-text3 font-mono">
                      {totalPredictions > 0 ? Math.round(d.value / totalPredictions * 100) : 0}% &nbsp; {d.value} cases
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* CHARTS ROW 2 */}
      <div className="grid grid-cols-3 gap-4 mb-4">

        {/* OHTS Risk Tier Distribution */}
        <div className="bg-surface border border-white/7 rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-white/7">
            <span className="text-sm font-semibold text-text1">OHTS Risk Tier Distribution</span>
          </div>
          <div className="p-4">
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={ohtsData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                <XAxis dataKey="name" tick={{ fill: CHART_COLORS.text3, fontSize: 11 }} />
                <YAxis tick={{ fill: CHART_COLORS.text3, fontSize: 10 }} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ background: "#1A2840", border: "1px solid rgba(255,255,255,0.12)", borderRadius: "8px", fontSize: "12px" }}
                />
                <Bar dataKey="value" radius={[4, 4, 0, 0]} label={{ position: "top", fill: CHART_COLORS.text3, fontSize: 10 }}>
                  {ohtsData.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <div className="text-xs text-text3 text-center mt-1">OHTS Risk Tier</div>
          </div>
        </div>

        {/* Screening Status */}
        <div className="bg-surface border border-white/7 rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-white/7">
            <span className="text-sm font-semibold text-text1">Screening Status</span>
          </div>
          <div className="p-4 flex items-center justify-center gap-6">
            <PieChart width={150} height={150}>
              <Pie
                data={statusData.filter(d => d.value > 0).length > 0 ? statusData : [{ name: "No data", value: 1, color: "#1F3050" }]}
                cx={75} cy={75}
                innerRadius={45} outerRadius={65}
                dataKey="value"
                startAngle={90} endAngle={-270}
              >
                {statusData.map((entry, i) => (
                  <Cell key={i} fill={entry.color} />
                ))}
                <DonutLabel cx={75} cy={75} label={`${completePct}%`} sub="Complete" />
              </Pie>
            </PieChart>
            <div className="flex flex-col gap-2">
              {statusData.map(d => (
                <div key={d.name} className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: d.color }} />
                  <div>
                    <div className="text-xs font-medium text-text1">{d.name}</div>
                    <div className="text-xs text-text3 font-mono">
                      {d.value} ({totalStatus > 0 ? Math.round(d.value / totalStatus * 100) : 0}%)
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Model Usage */}
        <div className="bg-surface border border-white/7 rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-white/7">
            <span className="text-sm font-semibold text-text1">Model Usage Breakdown</span>
          </div>
          <div className="p-4">
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={modelData} layout="vertical" margin={{ top: 0, right: 30, left: 10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" horizontal={false} />
                <XAxis type="number" tick={{ fill: CHART_COLORS.text3, fontSize: 10 }} allowDecimals={false} />
                <YAxis type="category" dataKey="name" tick={{ fill: CHART_COLORS.text3, fontSize: 11 }} width={90} />
                <Tooltip
                  contentStyle={{ background: "#1A2840", border: "1px solid rgba(255,255,255,0.12)", borderRadius: "8px", fontSize: "12px" }}
                />
                <Bar dataKey="value" radius={[0, 4, 4, 0]} label={{ position: "right", fill: CHART_COLORS.text3, fontSize: 10 }}>
                  <Cell fill={CHART_COLORS.accent} />
                  <Cell fill={CHART_COLORS.warn} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <div className="text-xs text-text3 text-center mt-1">Number of Screenings</div>
          </div>
        </div>
      </div>

      {/* HIGH RISK TABLE */}
      <div className="bg-surface border border-white/7 rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-white/7">
          <span className="text-sm font-semibold text-text1">Recent High-Risk Screenings</span>
        </div>
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-white/7">
              {["Patient Code", "Patient Name", "Eye Side", "Prediction", "Confidence Score", "OHTS Tier", "CDR", "Screening Date", "Actions"].map(h => (
                <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold text-text3 uppercase tracking-wider bg-white/[0.02]">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paginatedRisk.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-text3 text-sm">
                  No high-risk screenings found.
                </td>
              </tr>
            ) : (
              paginatedRisk.map(s => (
                <tr key={s.screening_id}
                  className="border-b border-white/[0.04] hover:bg-accent/[0.06] transition-colors cursor-pointer"
                  onClick={() => navigate(`/results/${s.screening_id}`)}>
                  <td className="px-4 py-3 text-xs text-text2 font-mono">{s.patient_code}</td>
                  <td className="px-4 py-3 text-sm font-medium text-text1">{s.patient_name}</td>
                  <td className="px-4 py-3 text-xs text-text2 capitalize">{s.eye_side}</td>
                  <td className="px-4 py-3"><ResultBadge prediction={s.prediction || "glaucoma"} /></td>
                  <td className="px-4 py-3"><RiskBar score={s.confidence_score} /></td>
                  <td className="px-4 py-3"><OHTSBadge tier={s.ohts_tier} /></td>
                  <td className="px-4 py-3 text-xs text-text2 font-mono">{s.cdr ? parseFloat(s.cdr).toFixed(3) : "—"}</td>
                  <td className="px-4 py-3 text-xs text-text2 font-mono">{formatDate(s.created_at)}</td>
                  <td className="px-4 py-3">
                    <button
                      onClick={e => { e.stopPropagation(); navigate(`/results/${s.screening_id}`); }}
                      className="px-2.5 py-1 text-xs text-text2 border border-white/12 rounded-lg bg-transparent hover:bg-white/5 transition-colors cursor-pointer font-sans"
                    >
                      View
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="px-5 py-3 border-t border-white/7 flex items-center justify-center gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-1 text-xs text-text2 border border-white/12 rounded-lg bg-transparent hover:bg-white/5 disabled:opacity-50 cursor-pointer font-sans"
            >
              ←
            </button>
            <span className="text-xs text-text3 px-2">{page}</span>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="px-3 py-1 text-xs text-text2 border border-white/12 rounded-lg bg-transparent hover:bg-white/5 disabled:opacity-50 cursor-pointer font-sans"
            >
              →
            </button>
          </div>
        )}
      </div>

    </Layout>
  );
}

export default Analytics;