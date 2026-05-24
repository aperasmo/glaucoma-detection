// src/pages/Dashboard.jsx
// Matches mock UI dashboard exactly.
// Sections: stat cards, recent screenings + quick actions, high risk patients table.

import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import Layout from "../components/Layout";
import API from "../api/index";

const V = {
  surface:   "#131D2E",
  surface2:  "#1A2840",
  surface3:  "#1F3050",
  border:    "rgba(255,255,255,0.07)",
  border2:   "rgba(255,255,255,0.12)",
  accent:    "#3B9EFF",
  accent2:   "#5BB8FF",
  accentDim: "rgba(59,158,255,0.12)",
  accentDim2:"rgba(59,158,255,0.2)",
  pos:       "#22C994",
  posDim:    "rgba(34,201,148,0.12)",
  neg:       "#FF6B6B",
  negDim:    "rgba(255,107,107,0.12)",
  warn:      "#FFB84D",
  warnDim:   "rgba(255,184,77,0.12)",
  text:      "#E8EEF7",
  text2:     "#8FA3BF",
  text3:     "#4E6580",
};

// Avatar initials with gradient
function Avatar({ name, size = 28, gradient = "linear-gradient(135deg,#3B9EFF,#1A5FBB)" }) {
  const initials = name
    ? name.trim().split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2)
    : "?";
  return (
    <div style={{
      width: size, height: size,
      borderRadius: "50%",
      background: gradient,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: size * 0.38, fontWeight: "600", color: "white",
      flexShrink: 0,
    }}>
      {initials}
    </div>
  );
}

// Result badge
function ResultBadge({ prediction }) {
  const map = {
    glaucoma: { cls: "bpos", label: "Positive" },
    normal:   { cls: "bneg", label: "Negative" },
    pending:  { cls: "bpen", label: "Pending" },
  };
  const { cls, label } = map[prediction?.toLowerCase()] || map.pending;
  const colors = {
    bpos: { bg: V.negDim,  color: V.neg },
    bneg: { bg: V.posDim,  color: V.pos },
    bpen: { bg: V.warnDim, color: V.warn },
  };
  const c = colors[cls];
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: "4px",
      padding: "3px 8px", borderRadius: "20px",
      fontSize: "11.5px", fontWeight: "500",
      background: c.bg, color: c.color,
    }}>
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: "currentColor", display: "inline-block" }} />
      {label}
    </span>
  );
}

// Risk score bar
function RiskBar({ score }) {
  const pct = Math.round((score || 0) * 100);
  const color = pct > 70 ? V.neg : pct > 50 ? V.warn : V.pos;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "7px" }}>
      <div style={{ width: 70, height: 4, background: V.surface3, borderRadius: 3, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 3 }} />
      </div>
      <span style={{ fontSize: "11.5px", color: V.text2, fontFamily: "'DM Mono',monospace" }}>
        {score?.toFixed(2) ?? "-"}
      </span>
    </div>
  );
}

// Stat card matching mock sc class
function StatCard({ label, value, sub, subColor, accent }) {
  return (
    <div style={{
      background: V.surface,
      border: `1px solid ${V.border}`,
      borderRadius: "11px",
      padding: "16px 18px",
      flex: 1,
      position: "relative",
      overflow: "hidden",
    }}>
      <div style={{ fontSize: "11px", color: V.text3, textTransform: "uppercase", letterSpacing: "0.8px", marginBottom: "7px" }}>
        {label}
      </div>
      <div style={{ fontSize: "26px", fontWeight: "600", color: V.text, fontFamily: "'DM Mono',monospace", lineHeight: 1, marginBottom: "5px" }}>
        {value}
      </div>
      <div style={{ fontSize: "11.5px", color: subColor || V.text3 }}>
        {sub}
      </div>
    </div>
  );
}

// Btn styles
const btn = {
  primary: {
    padding: "6px 13px", borderRadius: "7px", fontSize: "12.5px",
    fontWeight: "500", cursor: "pointer", border: "none",
    fontFamily: "'DM Sans',sans-serif",
    background: V.accent, color: "white",
    display: "inline-flex", alignItems: "center", gap: "5px",
  },
  ghost: {
    padding: "6px 13px", borderRadius: "7px", fontSize: "12.5px",
    fontWeight: "500", cursor: "pointer",
    fontFamily: "'DM Sans',sans-serif",
    background: "transparent", color: V.text2,
    border: `1px solid ${V.border2}`,
    display: "inline-flex", alignItems: "center", gap: "5px",
  },
};

function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [patients, setPatients] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    API.get("/patients/")
      .then(res => { setPatients(res.data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const totalPatients = patients.length;
  const activePatients = patients.filter(p => p.is_active).length;

  const gradients = [
    "linear-gradient(135deg,#3B9EFF,#1A5FBB)",
    "linear-gradient(135deg,#22C994,#0F7A58)",
    "linear-gradient(135deg,#FFB84D,#A06B00)",
    "linear-gradient(135deg,#9B59B6,#6C3483)",
    "linear-gradient(135deg,#E74C3C,#922B21)",
  ];

  function formatDate(d) {
    if (!d) return "-";
    return new Date(d).toLocaleDateString("en-NZ", {
      day: "2-digit", month: "short", year: "numeric",
      timeZone: "Pacific/Auckland",
    });
  }

  return (
    <Layout title="Dashboard">

      {/* STAT CARDS */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "14px", marginBottom: "20px" }}>
        <StatCard
          label="Total Patients"
          value={loading ? "-" : totalPatients}
          sub={<><span style={{ color: V.pos }}>+{activePatients}</span> active</>}
        />
        <StatCard
          label="Glaucoma Positive"
          value="—"
          sub="Pending screening data"
          subColor={V.neg}
        />
        <StatCard
          label="Ensemble AUC"
          value="0.9270"
          sub={<><span style={{ color: V.pos }}>Best</span> overall model</>}
        />
        <StatCard
          label="Sensitivity"
          value="85.4%"
          sub={<span style={{ color: V.warn }}>At clinical threshold</span>}
        />
      </div>

      {/* RECENT SCREENINGS + QUICK ACTIONS */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "18px" }}>

        {/* Recent Screenings */}
        <div style={{ background: V.surface, border: `1px solid ${V.border}`, borderRadius: "11px", overflow: "hidden" }}>
          <div style={{ padding: "14px 18px", borderBottom: `1px solid ${V.border}`, display: "flex", alignItems: "center", gap: "10px" }}>
            <span style={{ fontSize: "13.5px", fontWeight: "600", color: V.text, flex: 1 }}>Recent Screenings</span>
            <button style={btn.ghost} onClick={() => navigate("/screenings")}>View All</button>
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${V.border}` }}>
                {["Patient", "Result", "Model", "Date"].map(h => (
                  <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontSize: "11px", fontWeight: "600", color: V.text3, textTransform: "uppercase", letterSpacing: "0.7px", background: "rgba(255,255,255,.02)" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {patients.slice(0, 3).map((p, i) => (
                <tr
                  key={p.patient_id}
                  onClick={() => navigate(`/patients/${p.patient_id}`)}
                  style={{ borderBottom: `1px solid ${V.border}`, cursor: "pointer", transition: "background .1s" }}
                  onMouseEnter={e => e.currentTarget.style.background = V.accentDim}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                >
                  <td style={{ padding: "12px 14px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "9px" }}>
                      <Avatar name={`${p.first_name} ${p.last_name}`} gradient={gradients[i % gradients.length]} />
                      <span style={{ fontWeight: "500", fontSize: "13px" }}>{p.first_name} {p.last_name}</span>
                    </div>
                  </td>
                  <td style={{ padding: "12px 14px" }}>
                    <ResultBadge prediction="pending" />
                  </td>
                  <td style={{ padding: "12px 14px", color: V.text3, fontSize: "12px" }}>—</td>
                  <td style={{ padding: "12px 14px", color: V.text3, fontSize: "12px", fontFamily: "'DM Mono',monospace" }}>
                    {formatDate(p.created_at)}
                  </td>
                </tr>
              ))}
              {patients.length === 0 && !loading && (
                <tr>
                  <td colSpan={4} style={{ padding: "24px", textAlign: "center", color: V.text3, fontSize: "13px" }}>
                    No screenings yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Quick Actions */}
        <div style={{ background: V.surface, border: `1px solid ${V.border}`, borderRadius: "11px", overflow: "hidden" }}>
          <div style={{ padding: "14px 18px", borderBottom: `1px solid ${V.border}` }}>
            <span style={{ fontSize: "13.5px", fontWeight: "600", color: V.text }}>Quick Actions</span>
          </div>
          <div style={{ padding: "18px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
            <button
              onClick={() => navigate("/patients/new")}
              style={{ ...btn.primary, justifyContent: "center", padding: "14px", fontSize: "13px" }}
            >
              ➕ New Patient
            </button>
            <button
              onClick={() => navigate("/screenings/new")}
              style={{ ...btn.ghost, justifyContent: "center", padding: "14px", fontSize: "13px" }}
            >
              🔬 Run Screening
            </button>
            <button
              onClick={() => navigate("/reports")}
              style={{ ...btn.ghost, justifyContent: "center", padding: "14px", fontSize: "13px" }}
            >
              📄 Reports
            </button>
            <button
              onClick={() => navigate("/analytics")}
              style={{ ...btn.ghost, justifyContent: "center", padding: "14px", fontSize: "13px" }}
            >
              📊 Analytics
            </button>
          </div>
        </div>
      </div>

      {/* HIGH RISK PATIENTS */}
      <div style={{ background: V.surface, border: `1px solid ${V.border}`, borderRadius: "11px", overflow: "hidden" }}>
        <div style={{ padding: "14px 18px", borderBottom: `1px solid ${V.border}`, display: "flex", alignItems: "center", gap: "10px" }}>
          <span style={{ fontSize: "13.5px", fontWeight: "600", color: V.text, flex: 1 }}>High Risk Patients</span>
          <span style={{ fontSize: "12px", color: V.text3 }}>Requires follow-up</span>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${V.border}` }}>
              {["Patient", "Last Screening", "Risk Score", "Model", "Action"].map(h => (
                <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontSize: "11px", fontWeight: "600", color: V.text3, textTransform: "uppercase", letterSpacing: "0.7px", background: "rgba(255,255,255,.02)" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {patients.slice(0, 2).map((p, i) => (
              <tr
                key={p.patient_id}
                onClick={() => navigate(`/patients/${p.patient_id}`)}
                style={{ borderBottom: `1px solid ${V.border}`, cursor: "pointer", transition: "background .1s" }}
                onMouseEnter={e => e.currentTarget.style.background = V.accentDim}
                onMouseLeave={e => e.currentTarget.style.background = "transparent"}
              >
                <td style={{ padding: "12px 14px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "9px" }}>
                    <Avatar name={`${p.first_name} ${p.last_name}`} gradient={gradients[i % gradients.length]} />
                    <div>
                      <div style={{ fontWeight: "500", fontSize: "13px" }}>{p.first_name} {p.last_name}</div>
                      <div style={{ fontSize: "11px", color: V.text3, fontFamily: "'DM Mono',monospace" }}>{p.patient_code}</div>
                    </div>
                  </div>
                </td>
                <td style={{ padding: "12px 14px", color: V.text2, fontSize: "12px", fontFamily: "'DM Mono',monospace" }}>
                  {formatDate(p.created_at)}
                </td>
                    <td style={{ padding: "12px 14px" }}>
                    <RiskBar score={null} />
                    </td>
                    <td style={{ padding: "12px 14px", color: V.text3, fontSize: "12px" }}>
                    —
                    </td>
                <td style={{ padding: "12px 14px" }}>
                  <button
                    onClick={e => { e.stopPropagation(); navigate("/screenings/new"); }}
                    style={{ ...btn.ghost, fontSize: "11px", padding: "4px 10px" }}
                  >
                    Screen Again
                  </button>
                </td>
              </tr>
            ))}
            {patients.length === 0 && !loading && (
              <tr>
                <td colSpan={5} style={{ padding: "24px", textAlign: "center", color: V.text3, fontSize: "13px" }}>
                  No high risk patients.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

    </Layout>
  );
}

export default Dashboard;