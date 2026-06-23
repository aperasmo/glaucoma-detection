// src/pages/ScreeningHistory.jsx
// Screening History page - Tailwind CSS implementation.
// Lists all screenings across all patients with pagination.
// Connects to GET /screenings/?skip=0&limit=20

import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import Layout from "../components/Layout";
import API from "../api/index";
import {
  formatDate,
  getReferralResult,
  normaliseSignatoryText,
} from "../components/screening-results/ResultShared";

const GRADIENTS = [
  "from-accent to-accent2",
  "from-pos to-emerald-700",
  "from-warn to-amber-700",
  "from-purple-500 to-purple-800",
  "from-neg to-red-800",
];

function Avatar({ name, index = 0 }) {
  const initials = name
    ? name.trim().split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2)
    : "?";
  return (
    <div className={`w-8 h-8 rounded-full bg-gradient-to-br ${GRADIENTS[index % GRADIENTS.length]} flex items-center justify-center text-white text-xs font-semibold flex-shrink-0`}>
      {initials}
    </div>
  );
}

function ResultBadge({ prediction }) {
  const map = {
    glaucoma: { cls: "bg-neg/10 text-neg border-neg/20",    label: "Positive" },
    normal:   { cls: "bg-pos/10 text-pos border-pos/20",    label: "Negative" },
    pending:  { cls: "bg-warn/10 text-warn border-warn/20", label: "Pending"  },
  };
  const c = map[prediction?.toLowerCase()] || map.pending;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${c.cls}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current" />
      {c.label}
    </span>
  );
}

function StatusBadge({ status }) {
  const map = {
    complete:   { cls: "bg-pos/10 text-pos border-pos/20",     label: "Complete"   },
    processing: { cls: "bg-accent/10 text-accent2 border-accent/20", label: "Processing" },
    pending:    { cls: "bg-warn/10 text-warn border-warn/20",  label: "Pending"    },
    failed:     { cls: "bg-neg/10 text-neg border-neg/20",     label: "Failed"     },
  };
  const c = map[status?.toLowerCase()] || map.pending;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${c.cls}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current" />
      {c.label}
    </span>
  );
}

function OHTSTierBadge({ tier }) {
  if (!tier) return <span className="text-xs text-text3">—</span>;
  const map = {
    critical: { cls: "bg-neg/10 text-neg border-neg/20",    label: "Critical" },
    possible: { cls: "bg-warn/10 text-warn border-warn/20", label: "Possible" },
    low:      { cls: "bg-pos/10 text-pos border-pos/20",    label: "Low"      },
  };
  const c = map[tier?.toLowerCase()] || map.low;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${c.cls}`}>
      {c.label}
    </span>
  );
}

function RiskBar({ score }) {
  if (!score) return <span className="text-xs text-text3">—</span>;
  const pct = Math.round(parseFloat(score) * 100);
  const color = pct > 70 ? "bg-neg" : pct > 50 ? "bg-warn" : "bg-pos";
  return (
    <div className="flex items-center gap-2">
      <div className="w-14 h-1 bg-surface3 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-text2 font-mono">{(pct / 100).toFixed(2)}</span>
    </div>
  );
}

const LIMIT = 20;

function ScreeningHistory() {
  const navigate = useNavigate();
  const [screenings, setScreenings] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [skip, setSkip] = useState(0);
  const [search, setSearch] = useState("");
  const [filterResult, setFilterResult] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");

  useEffect(() => {
    Promise.all([
      API.get(`/screenings/?skip=0&limit=${LIMIT}`),
      API.get("/screenings/stats"),
    ])
      .then(([screeningsRes, statsRes]) => {
        setScreenings(screeningsRes.data);
        setStats(statsRes.data);
        setHasMore(screeningsRes.data.length === LIMIT);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  function loadMore() {
    const nextSkip = skip + LIMIT;
    setLoadingMore(true);
    API.get(`/screenings/?skip=${nextSkip}&limit=${LIMIT}`)
      .then(res => {
        setScreenings(prev => [...prev, ...res.data]);
        setSkip(nextSkip);
        setHasMore(res.data.length === LIMIT);
        setLoadingMore(false);
      })
      .catch(() => setLoadingMore(false));
  }

  // function formatDate(d) {
  //   if (!d) return "-";
  //   return new Date(d).toLocaleDateString("en-NZ", {
  //     day: "2-digit", month: "short", year: "numeric",
  //     hour: "2-digit", minute: "2-digit",
  //     timeZone: "Pacific/Auckland",
  //   });
  // }

  // Filter screenings
  const filtered = screenings.filter(s => {
    const name = s.patient_name?.toLowerCase() || "";
    const code = s.patient_code?.toLowerCase() || "";
    const q = search.toLowerCase();
    const matchSearch = name.includes(q) || code.includes(q);
    const matchResult = filterResult === "all" || s.prediction === filterResult;
    const matchStatus = filterStatus === "all" || s.status === filterStatus;
    return matchSearch && matchResult && matchStatus;
  });

  // Top bar actions
  const actions = (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-2 bg-surface2 border border-white/12 rounded-lg px-3 py-1.5 w-44">
        <span className="text-text3 text-sm">🔍</span>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search patient..."
          className="bg-transparent border-0 outline-none text-text1 text-xs w-full font-sans placeholder:text-text3"
        />
      </div>
      <select
        value={filterResult}
        onChange={e => setFilterResult(e.target.value)}
        className="bg-surface2 border border-white/12 rounded-lg px-3 py-1.5 text-xs text-text2 outline-none cursor-pointer font-sans"
      >
        <option value="all">All Results</option>
        <option value="glaucoma">Positive</option>
        <option value="normal">Normal</option>
      </select>
      <select
        value={filterStatus}
        onChange={e => setFilterStatus(e.target.value)}
        className="bg-surface2 border border-white/12 rounded-lg px-3 py-1.5 text-xs text-text2 outline-none cursor-pointer font-sans"
      >
        <option value="all">All Status</option>
        <option value="complete">Complete</option>
        <option value="pending">Pending</option>
        <option value="failed">Failed</option>
      </select>
    </div>
  );

  return (
    <Layout title="Screening History" actions={actions}>

      {/* STAT CARDS */}
      <div className="grid grid-cols-4 gap-3 mb-5">
        <div className="bg-surface border border-white/7 rounded-xl p-4">
          <div className="text-xs text-text3 uppercase tracking-wider mb-2">Total Screenings</div>
          <div className="text-2xl font-semibold font-mono text-text1">
            {loading ? "-" : screenings.length}
          </div>
        </div>
        <div className="bg-surface border border-white/7 rounded-xl p-4">
          <div className="text-xs text-text3 uppercase tracking-wider mb-2">Glaucoma Positive</div>
          <div className="text-2xl font-semibold font-mono text-neg">
            {loading ? "-" : stats?.glaucoma_positive ?? "—"}
          </div>
        </div>
        <div className="bg-surface border border-white/7 rounded-xl p-4">
          <div className="text-xs text-text3 uppercase tracking-wider mb-2">Normal</div>
          <div className="text-2xl font-semibold font-mono text-pos">
            {loading ? "-" : screenings.filter(s => s.prediction === "normal").length}
          </div>
        </div>
        <div className="bg-surface border border-white/7 rounded-xl p-4">
          <div className="text-xs text-text3 uppercase tracking-wider mb-2">Pending</div>
          <div className="text-2xl font-semibold font-mono text-warn">
            {loading ? "-" : stats?.pending_count ?? "—"}
          </div>
        </div>
      </div>

      {/* TABLE */}
      <div className="bg-surface border border-white/7 rounded-xl overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-3.5 border-b border-white/7">
          <span className="text-sm font-semibold text-text1 flex-1">All Screenings</span>
          <span className="text-xs text-text3">{filtered.length} records</span>
        </div>

        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-white/7">
              {["Patient", "Eye", "Status", "Result", "Confidence", "OHTS Tier", "Model", "Date", "Actions"].map(h => (
                <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold text-text3 uppercase tracking-wider bg-white/[0.02]">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-text3 text-sm">
                  Loading screenings...
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-text3 text-sm">
                  No screenings found.
                </td>
              </tr>
            ) : (
              filtered.map((s, i) => (
                <tr
                  key={s.screening_id}
                  onClick={() => navigate(`/results/${s.screening_id}`)}
                  className="border-b border-white/[0.04] hover:bg-accent/[0.06] transition-colors cursor-pointer"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Avatar name={s.patient_name} index={i} />
                      <div>
                        <div className="text-sm font-medium text-text1">{s.patient_name}</div>
                        <div className="text-xs text-text3 font-mono">#{s.patient_code}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-text2 capitalize">{s.eye_side}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={s.status} />
                  </td>
                  <td className="px-4 py-3">
                    <ResultBadge prediction={s.prediction} />
                  </td>
                  <td className="px-4 py-3">
                    <RiskBar score={s.confidence_score} />
                  </td>
                  <td className="px-4 py-3">
                    <OHTSTierBadge tier={s.ohts_tier} />
                  </td>
                  <td className="px-4 py-3 text-xs text-text3 capitalize">
                    {s.model_used || "—"}
                  </td>
                  <td className="px-4 py-3 text-xs text-text2 font-mono">
                    {formatDate(s.created_at)}
                  </td>
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

        {/* Load More */}
        {hasMore && !loading && (
          <div className="px-5 py-4 border-t border-white/7 text-center">
            <button
              onClick={loadMore}
              disabled={loadingMore}
              className="px-6 py-2 text-xs font-medium text-text2 border border-white/12 rounded-lg bg-transparent hover:bg-white/5 transition-colors cursor-pointer font-sans disabled:opacity-50"
            >
              {loadingMore ? "Loading..." : "Load More"}
            </button>
          </div>
        )}
      </div>

    </Layout>
  );
}

export default ScreeningHistory;