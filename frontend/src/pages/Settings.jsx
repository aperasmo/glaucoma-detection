// src/pages/Settings.jsx
// Settings page - matches mock UI pg-settings exactly.
// Tabs: General, AI Models, Notifications, API Keys, Appearance.
// AI Models tab contains INFERENCE_MODE toggle (clinical/research).
// All settings read from and written to GET/PUT /system-settings/ endpoint.

import { useState, useEffect } from "react";
import Layout from "../components/Layout";
import API from "../api/index";

const V = {
  surface:    "#131D2E",
  surface2:   "#1A2840",
  surface3:   "#1F3050",
  border:     "rgba(255,255,255,0.07)",
  border2:    "rgba(255,255,255,0.12)",
  accent:     "#3B9EFF",
  accent2:    "#5BB8FF",
  accentDim:  "rgba(59,158,255,0.12)",
  accentDim2: "rgba(59,158,255,0.2)",
  pos:        "#22C994",
  posDim:     "rgba(34,201,148,0.12)",
  neg:        "#FF6B6B",
  negDim:     "rgba(255,107,107,0.12)",
  warn:       "#FFB84D",
  warnDim:    "rgba(255,184,77,0.12)",
  text:       "#E8EEF7",
  text2:      "#8FA3BF",
  text3:      "#4E6580",
};

const inputStyle = {
  width: "100%",
  background: V.surface2,
  border: `1px solid ${V.border2}`,
  borderRadius: "8px",
  padding: "9px 13px",
  color: V.text,
  fontSize: "13px",
  fontFamily: "'DM Sans',sans-serif",
  outline: "none",
  boxSizing: "border-box",
};

const labelStyle = {
  fontSize: "12px",
  color: V.text2,
  marginBottom: "6px",
  display: "block",
  fontWeight: "500",
};

const TABS = ["General", "AI Models", "Notifications", "API Keys"];

function Settings() {
  const [activeTab, setActiveTab] = useState("General");
  const [settings, setSettings] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    API.get("/settings/")
      .then(res => {
        // Convert array of {key, value} to object
        const map = {};
        res.data.forEach(s => { map[s.set_code] = s.set_value; });
        setSettings(map);
        setLoading(false);
      })
      .catch(() => {
        // Fall back to defaults if settings not available
        setSettings({ INFERENCE_MODE: "clinical" });
        setLoading(false);
      });
  }, []);

 async function saveSetting(key, value) {
  console.log("Saving:", key, "=", value);
  setSaving(true);
  setSaved(false);
  setError(null);
  try {
    await API.put(`/settings/${key}`, { set_value: value, status: "A" });
    setSettings(prev => ({ ...prev, [key]: value }));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  } catch {
    setError("Failed to save setting.");
  } finally {
    setSaving(false);
  }
}

  function sectionDivider(label) {
    return (
      <div style={{
        fontSize: "11px", color: V.text3,
        textTransform: "uppercase", letterSpacing: "1px",
        margin: "20px 0 14px",
        paddingBottom: "6px",
        borderBottom: `1px solid ${V.border}`,
      }}>
        {label}
      </div>
    );
  }

  return (
    <Layout title="Settings">

      {/* TABS */}
      <div style={{
        display: "flex", gap: "3px", marginBottom: "18px",
        background: V.surface, border: `1px solid ${V.border}`,
        borderRadius: "9px", padding: "3px", width: "fit-content",
      }}>
        {TABS.map(tab => (
          <div
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: "6px 14px", borderRadius: "7px",
              fontSize: "12.5px", cursor: "pointer",
              fontWeight: "500", transition: "all .15s",
              color: activeTab === tab ? V.text : V.text2,
              background: activeTab === tab ? V.surface3 : "transparent",
            }}
          >
            {tab}
          </div>
        ))}
      </div>

      {/* GENERAL TAB */}
      {activeTab === "General" && (
        <div style={{
          background: V.surface, border: `1px solid ${V.border}`,
          borderRadius: "11px", overflow: "hidden",
        }}>
          <div style={{ padding: "14px 18px", borderBottom: `1px solid ${V.border}` }}>
            <span style={{ fontSize: "13.5px", fontWeight: "600", color: V.text }}>
              General Settings
            </span>
          </div>
          <div style={{ padding: "18px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "16px" }}>
              <div>
                <label style={labelStyle}>Clinic Name</label>
                <input
                  style={inputStyle}
                  defaultValue={settings.CLINIC_NAME || "GlaucomaAI Clinical System"}
                />
              </div>
              <div>
                <label style={labelStyle}>Default Language</label>
                <select style={inputStyle}>
                  <option>English</option>
                </select>
              </div>
            </div>

            {sectionDivider("Notifications")}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "16px" }}>
              <div>
                <label style={labelStyle}>High Risk Email Alert</label>
                <select style={inputStyle}>
                  <option>Enabled</option>
                  <option>Disabled</option>
                </select>
              </div>
              <div>
                <label style={labelStyle}>Alert Email</label>
                <input
                  style={inputStyle}
                  defaultValue={settings.ALERT_EMAIL || ""}
                  placeholder="alerts@clinic.com"
                />
              </div>
            </div>

            <div style={{
              display: "flex", gap: "10px", justifyContent: "flex-end",
              marginTop: "20px", paddingTop: "16px",
              borderTop: `1px solid ${V.border}`,
            }}>
              <button style={{
                padding: "6px 13px", borderRadius: "7px",
                fontSize: "12.5px", fontWeight: "500", cursor: "pointer",
                background: V.accent, color: "white", border: "none",
                fontFamily: "'DM Sans',sans-serif",
              }}>
                Save Settings
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AI MODELS TAB */}
      {activeTab === "AI Models" && (
        <div style={{
          background: V.surface, border: `1px solid ${V.border}`,
          borderRadius: "11px", overflow: "hidden",
        }}>
          <div style={{ padding: "14px 18px", borderBottom: `1px solid ${V.border}` }}>
            <span style={{ fontSize: "13.5px", fontWeight: "600", color: V.text }}>
              AI Model Settings
            </span>
          </div>
          <div style={{ padding: "18px" }}>

            {loading ? (
              <p style={{ color: V.text3, fontSize: "13px" }}>Loading settings...</p>
            ) : (
              <>
                {sectionDivider("Inference Mode")}

                {/* Mode toggle - the most important setting */}
                <div style={{ marginBottom: "20px" }}>
                  <label style={labelStyle}>Inference Mode</label>
                  <p style={{ fontSize: "12px", color: V.text3, marginBottom: "12px", lineHeight: "1.6" }}>
                    Clinical Mode runs the ensemble automatically and shows one result.
                    Research Mode shows all three models side by side with individual scores and Grad-CAM++ per model.
                    Only Admin can change this setting.
                  </p>
                  <div style={{ display: "flex", gap: "12px" }}>
                    {["clinical", "research"].map(mode => (
                      <div
                        key={mode}
                        onClick={() => saveSetting("INFERENCE_MODE", mode)}
                        style={{
                          flex: 1, padding: "16px",
                          borderRadius: "10px",
                          border: `2px solid ${settings.INFERENCE_MODE === mode ? V.accent : V.border}`,
                          background: settings.INFERENCE_MODE === mode ? V.accentDim2 : V.surface2,
                          cursor: "pointer", transition: "all .15s",
                        }}
                      >
                        <div style={{
                          fontSize: "14px", fontWeight: "600",
                          color: settings.INFERENCE_MODE === mode ? V.accent2 : V.text,
                          marginBottom: "6px",
                          textTransform: "capitalize",
                        }}>
                          {mode === "clinical" ? "🏥" : "🔬"} {mode} Mode
                          {settings.INFERENCE_MODE === mode && (
                            <span style={{
                              marginLeft: "8px", fontSize: "11px",
                              background: V.accentDim, color: V.accent2,
                              padding: "2px 8px", borderRadius: "10px",
                            }}>
                              Active
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: "12px", color: V.text3, lineHeight: "1.6" }}>
                          {mode === "clinical"
                            ? "Ensemble runs automatically. One result shown. No model selection visible to users."
                            : "All three models run side by side. Individual scores, Grad-CAM++ per model, ensemble consensus."}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {sectionDivider("Threshold Settings")}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "16px" }}>
                  <div>
                    <label style={labelStyle}>High Risk Threshold</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0" max="1"
                      style={inputStyle}
                      defaultValue={settings.HIGH_RISK_THRESHOLD || "0.60"}
                    />
                    <p style={{ fontSize: "11px", color: V.text3, marginTop: "4px" }}>
                      Confidence above this value triggers high risk alert.
                    </p>
                  </div>
                  <div>
                    <label style={labelStyle}>Sensitivity Threshold (Clinical)</label>
                    <input
                      type="number"
                      step="0.001"
                      min="0" max="1"
                      style={inputStyle}
                      defaultValue={settings.SENSITIVITY_THRESHOLD || "0.47"}
                    />
                    <p style={{ fontSize: "11px", color: V.text3, marginTop: "4px" }}>
                      Sensitivity-first threshold. 85.4% sensitivity at 0.47.
                    </p>
                  </div>
                </div>

                {/* Status messages */}
                {saving && (
                  <p style={{ fontSize: "12px", color: V.text3 }}>Saving...</p>
                )}
                {saved && (
                  <p style={{ fontSize: "12px", color: V.pos }}>✓ Setting saved.</p>
                )}
                {error && (
                  <p style={{ fontSize: "12px", color: V.neg }}>{error}</p>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* NOTIFICATIONS TAB */}
      {activeTab === "Notifications" && (
        <div style={{
          background: V.surface, border: `1px solid ${V.border}`,
          borderRadius: "11px", overflow: "hidden",
        }}>
          <div style={{ padding: "14px 18px", borderBottom: `1px solid ${V.border}` }}>
            <span style={{ fontSize: "13.5px", fontWeight: "600", color: V.text }}>
              Notification Settings
            </span>
          </div>
          <div style={{ padding: "18px" }}>
            <p style={{ color: V.text2, fontSize: "13px" }}>
              Email alerts, high-risk patient notifications, and scheduled report settings will be managed here.
            </p>
          </div>
        </div>
      )}

      {/* API KEYS TAB */}
      {activeTab === "API Keys" && (
        <div style={{
          background: V.surface, border: `1px solid ${V.border}`,
          borderRadius: "11px", overflow: "hidden",
        }}>
          <div style={{ padding: "14px 18px", borderBottom: `1px solid ${V.border}` }}>
            <span style={{ fontSize: "13.5px", fontWeight: "600", color: V.text }}>
              API Key Settings
            </span>
          </div>
          <div style={{ padding: "18px" }}>
            {sectionDivider("OpenAI")}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "16px" }}>
              <div>
                <label style={labelStyle}>OpenAI API Key</label>
                <input
                  type="password"
                  style={inputStyle}
                  placeholder="sk-••••••••••••••••••••"
                />
              </div>
              <div>
                <label style={labelStyle}>GPT Model</label>
                <select style={inputStyle}>
                  <option>gpt-4o</option>
                  <option>gpt-4o-mini</option>
                </select>
              </div>
            </div>
            <div style={{
              display: "flex", gap: "10px", justifyContent: "flex-end",
              marginTop: "20px", paddingTop: "16px",
              borderTop: `1px solid ${V.border}`,
            }}>
              <button style={{
                padding: "6px 13px", borderRadius: "7px",
                fontSize: "12.5px", fontWeight: "500", cursor: "pointer",
                background: V.accent, color: "white", border: "none",
                fontFamily: "'DM Sans',sans-serif",
              }}>
                Save API Keys
              </button>
            </div>
          </div>
        </div>
      )}

    </Layout>
  );
}

export default Settings;