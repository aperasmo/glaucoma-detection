// src/pages/Dashboard.jsx
// Main dashboard - Tailwind CSS implementation.
// Fixed: uses recentScreenings for both Recent Screenings and High Risk tables.
// Removed unused patients state.

import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
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

function RiskBar({ score }) {
  const pct = Math.round((score || 0) * 100);
  const color = pct > 70 ? "bg-neg" : pct > 50 ? "bg-warn" : "bg-pos";
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-1 bg-surface3 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-text2 font-mono">
        {score ? parseFloat(score).toFixed(2) : "-"}
      </span>
    </div>
  );
}

function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [stats, setStats] = useState(null);
  const [recentScreenings, setRecentScreenings] = useState([]);
  const [loading, setLoading] = useState(true);

  const { user:currentUser } = useAuth();
  const isDemo = user?.full_name?.toLowerCase().endsWith(" user");

  useEffect(() => {
    Promise.all([
      API.get("/screenings/stats"),
      API.get("/screenings/recent?limit=5"),
    ])
      .then(([statsRes, recentRes]) => {
        setStats(statsRes.data);
        setRecentScreenings(recentRes.data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  // function formatDate(d) {
  //   if (!d) return "-";
  //   return new Date(d).toLocaleDateString("en-NZ", {
  //     day: "2-digit", month: "short", year: "numeric",
  //     timeZone: "Pacific/Auckland",
  //   });
  // }

  //const greeting = new Date().getHours() < 12 ? "Good morning" : "Good afternoons";

  const hour = new Date().getHours();

  const greeting =
    hour < 12
      ? "Good morning"
      : hour < 18
        ? "Good afternoon"
        : "Good evening";


  const today = new Date().toLocaleDateString("en-NZ", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
    timeZone: "Pacific/Auckland",
  });

  const highRisk = recentScreenings.filter(s =>
    s.prediction === "glaucoma" ||
    s.ohts_tier === "critical" ||
    s.ohts_tier === "possible"
  );

  return (
    <Layout title="Dashboard">

      {/* Header */}
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-text1 mb-0.5">
          {greeting}, {user?.full_name ?? `${user?.first_name ?? ""} ${user?.last_name ?? ""}`}...
        </h2>
        <p className="text-xs text-text3">{today}</p>
      </div>

      {/* STAT CARDS */}
      <div className="grid grid-cols-4 gap-3 mb-5">
        <div className="bg-surface border border-white/7 rounded-xl p-4">
          <div className="text-xs text-text3 uppercase tracking-wider mb-2">Total Patients</div>
          <div className="text-2xl font-semibold font-mono text-text1 mb-1">
            {loading ? "-" : stats?.total_patients ?? "-"}
          </div>
          <div className="text-xs text-pos">
            +{loading ? "-" : stats?.new_this_month ?? "0"} this month
          </div>
        </div>

        <div className="bg-surface border border-white/7 rounded-xl p-4">
          <div className="text-xs text-text3 uppercase tracking-wider mb-2">Glaucoma Positive</div>
          <div className="text-2xl font-semibold font-mono text-neg mb-1">
            {loading ? "-" : stats?.glaucoma_positive ?? "-"}
          </div>
          <div className="text-xs text-text3">
            {loading ? "-" : stats?.glaucoma_percent ?? "-"}% of screenings
          </div>
        </div>

        <div className="bg-surface border border-white/7 rounded-xl p-4">
          <div className="text-xs text-text3 uppercase tracking-wider mb-2">Screenings Today</div>
          <div className="text-2xl font-semibold font-mono text-accent2 mb-1">
            {loading ? "-" : stats?.screenings_today ?? "-"}
          </div>
          <div className="text-xs text-pos">
            +{loading ? "-" : stats?.screenings_vs_yesterday ?? "0"} vs yesterday
          </div>
        </div>

        <div className="bg-surface border border-white/7 rounded-xl p-4">
          <div className="text-xs text-text3 uppercase tracking-wider mb-2">Pending Review</div>
          <div className="text-2xl font-semibold font-mono text-warn mb-1">
            {loading ? "-" : stats?.pending_count ?? "-"}
          </div>
          <div className="text-xs text-warn">Needs attention</div>
        </div>
      </div>

      {/* RECENT SCREENINGS + QUICK ACTIONS */}
      <div className="grid grid-cols-2 gap-4 mb-4">

        {/* Recent Screenings */}
        <div className="bg-surface border border-white/7 rounded-xl overflow-hidden">
          <div className="flex items-center gap-3 px-5 py-3.5 border-b border-white/7">
            <span className="text-sm font-semibold text-text1 flex-1">Recent Screenings</span>
            <button
              onClick={() => navigate("/screenings")}
              className="px-3 py-1 text-xs text-text2 border border-white/12 rounded-lg bg-transparent hover:bg-white/5 transition-colors cursor-pointer font-sans"
            >
              View All
            </button>
          </div>
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-white/7">
                {["Patient", "Result", "Model", "Date"].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold text-text3 uppercase tracking-wider bg-white/[0.02]">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-text3 text-sm">
                    Loading...
                  </td>
                </tr>
              ) : recentScreenings.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-text3 text-sm">
                    No screenings yet.
                  </td>
                </tr>
              ) : (
                recentScreenings.map((s, i) => (
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
                    <td className="px-4 py-3">
                      <ResultBadge prediction={s.prediction} />
                    </td>
                    <td className="px-4 py-3 text-xs text-text3 capitalize">
                      {s.model_used || "—"}
                    </td>
                    <td className="px-4 py-3 text-xs text-text2 font-mono">
                      {formatDate(s.created_at)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Quick Actions */}
        <div className="bg-surface border border-white/7 rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-white/7">
            <span className="text-sm font-semibold text-text1">Quick Actions</span>
          </div>
          <div className="p-4 grid grid-cols-2 gap-3">
              {!isDemo && (
                <button
                  onClick={() => navigate("/patients/new")}
                  className="flex items-center justify-center gap-1.5 py-3.5 bg-accent hover:bg-accent2 text-white text-sm font-medium rounded-xl border-0 transition-colors cursor-pointer font-sans"
                >
                  ➕ New Patient
                </button>
              )}
            <button
              onClick={() => navigate("/screenings/new")}
              className="flex items-center justify-center gap-1.5 py-3.5 text-text2 border border-white/12 text-sm font-medium rounded-xl bg-transparent hover:bg-white/5 transition-colors cursor-pointer font-sans"
            >
              🔬 Run Screening
            </button>
            <button
              onClick={() => navigate("/reports")}
              className="flex items-center justify-center gap-1.5 py-3.5 text-text2 border border-white/12 text-sm font-medium rounded-xl bg-transparent hover:bg-white/5 transition-colors cursor-pointer font-sans"
            >
              📄 Reports
            </button>
            <button
              onClick={() => navigate("/analytics")}
              className="flex items-center justify-center gap-1.5 py-3.5 text-text2 border border-white/12 text-sm font-medium rounded-xl bg-transparent hover:bg-white/5 transition-colors cursor-pointer font-sans"
            >
              📊 Analytics
            </button>
          </div>
        </div>
      </div>

      {/* HIGH RISK PATIENTS */}
      <div className="bg-surface border border-white/7 rounded-xl overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-3.5 border-b border-white/7">
          <span className="text-sm font-semibold text-text1 flex-1">High Risk Patients</span>
          <span className="text-xs text-text3">Requires follow-up</span>
        </div>
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-white/7">
              {["Patient", "Last Screening", "Risk Score", "Model", "Action"].map(h => (
                <th key={h} className="px-5 py-2.5 text-left text-xs font-semibold text-text3 uppercase tracking-wider bg-white/[0.02]">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="px-5 py-6 text-center text-text3 text-sm">
                  Loading...
                </td>
              </tr>
            ) : highRisk.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-5 py-6 text-center text-text3 text-sm">
                  No high risk patients.
                </td>
              </tr>
            ) : (
              highRisk.slice(0, 3).map((s, i) => (
                <tr
                  key={s.screening_id}
                  onClick={() => navigate(`/results/${s.screening_id}`)}
                  className="border-b border-white/[0.04] hover:bg-accent/[0.06] transition-colors cursor-pointer"
                >
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2.5">
                      <Avatar name={s.patient_name} index={i} />
                      <div>
                        <div className="text-sm font-medium text-text1">{s.patient_name}</div>
                        <div className="text-xs text-text3 font-mono">#{s.patient_code}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3 text-xs text-text2 font-mono">
                    {formatDate(s.created_at)}
                  </td>
                  <td className="px-5 py-3">
                    <RiskBar score={s.confidence_score} />
                  </td>
                  <td className="px-5 py-3 text-xs text-text3 capitalize">
                    {s.model_used || "—"}
                  </td>
                  <td className="px-5 py-3">
                    <button
                      onClick={e => { e.stopPropagation(); navigate("/screenings/new"); }}
                      className="px-2.5 py-1 text-xs text-text2 border border-white/12 rounded-lg bg-transparent hover:bg-white/5 transition-colors cursor-pointer font-sans"
                    >
                      Screen Again
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

    </Layout>
  );
}

export default Dashboard;