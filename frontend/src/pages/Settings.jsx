// src/pages/Settings.jsx
// Settings page - Tailwind CSS implementation.
// Tabs: General, AI Models, Notifications, API Keys.

import { useState, useEffect } from "react";
import Layout from "../components/Layout";
import API from "../api/index";

const inputClass = "w-full bg-surface2 border border-white/12 rounded-lg px-3 py-2.5 text-sm text-text1 outline-none placeholder:text-text3 focus:border-accent transition-colors font-sans";

function SectionDivider({ label }) {
  return (
    <div className="text-xs text-text3 uppercase tracking-widest mt-5 mb-3.5 pb-1.5 border-b border-white/7">
      {label}
    </div>
  );
}

function FormField({ label, hint, children }) {
  return (
    <div>
      <label className="block text-xs font-medium text-text2 mb-1.5">{label}</label>
      {children}
      {hint && <p className="text-xs text-text3 mt-1">{hint}</p>}
    </div>
  );
}

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
        const map = {};
        res.data.forEach(s => { map[s.set_code] = s.set_value; });
        setSettings(map);
        setLoading(false);
      })
      .catch(() => {
        setSettings({ INFERENCE_MODE: "clinical" });
        setLoading(false);
      });
  }, []);

  async function saveSetting(key, value) {
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

  return (
    <Layout title="Settings">

      {/* TABS */}
      <div className="flex gap-1 mb-5 bg-surface border border-white/7 rounded-xl p-1 w-fit">
        {TABS.map(tab => (
          <div
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-all ${
              activeTab === tab ? "bg-surface3 text-text1" : "text-text2 hover:text-text1"
            }`}
          >
            {tab}
          </div>
        ))}
      </div>

      {/* GENERAL TAB */}
      {activeTab === "General" && (
        <div className="bg-surface border border-white/7 rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-white/7">
            <span className="text-sm font-semibold text-text1">General Settings</span>
          </div>
          <div className="p-5">
            <SectionDivider label="Clinic Information" />
            <div className="grid grid-cols-2 gap-4 mb-4">
              <FormField label="Clinic Name">
                <input style={{}} className={inputClass}
                  defaultValue={settings.CLINIC_NAME || "GlaucomaAI Clinical System"} />
              </FormField>
              <FormField label="Default Language">
                <select className={`${inputClass} cursor-pointer`}>
                  <option>English</option>
                </select>
              </FormField>
            </div>

            <SectionDivider label="Notifications" />
            <div className="grid grid-cols-2 gap-4 mb-4">
              <FormField label="High Risk Email Alert">
                <select className={`${inputClass} cursor-pointer`}>
                  <option>Enabled</option>
                  <option>Disabled</option>
                </select>
              </FormField>
              <FormField label="Alert Email">
                <input className={inputClass}
                  defaultValue={settings.ALERT_EMAIL || ""}
                  placeholder="alerts@clinic.com" />
              </FormField>
            </div>

            <div className="flex justify-end pt-4 border-t border-white/7">
              <button className="px-4 py-2 text-xs font-medium text-white bg-accent hover:bg-accent2 rounded-lg border-0 transition-colors cursor-pointer font-sans">
                Save Settings
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AI MODELS TAB */}
      {activeTab === "AI Models" && (
        <div className="bg-surface border border-white/7 rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-white/7">
            <span className="text-sm font-semibold text-text1">AI Model Settings</span>
          </div>
          <div className="p-5">
            {loading ? (
              <p className="text-text3 text-sm">Loading settings...</p>
            ) : (
              <>
                <SectionDivider label="Inference Mode" />

                <div className="mb-5">
                  <p className="text-xs text-text3 mb-3 leading-relaxed">
                    Clinical Mode runs the ensemble automatically and shows one result.
                    Research Mode shows all three models side by side with individual Grad-CAM++ per model.
                    Only Admin can change this setting.
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    {["clinical", "research"].map(mode => (
                      <div
                        key={mode}
                        onClick={() => saveSetting("INFERENCE_MODE", mode)}
                        className={`p-4 rounded-xl border-2 cursor-pointer transition-all ${
                          settings.INFERENCE_MODE === mode
                            ? "border-accent bg-accent/10"
                            : "border-white/7 bg-surface2 hover:border-white/20"
                        }`}
                      >
                        <div className={`text-sm font-semibold mb-1.5 capitalize flex items-center gap-2 ${
                          settings.INFERENCE_MODE === mode ? "text-accent2" : "text-text1"
                        }`}>
                          {mode === "clinical" ? "🏥" : "🔬"} {mode} Mode
                          {settings.INFERENCE_MODE === mode && (
                            <span className="text-xs bg-accent/20 text-accent2 px-2 py-0.5 rounded-full">
                              Active
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-text3 leading-relaxed">
                          {mode === "clinical"
                            ? "Ensemble runs automatically. One result shown. No model selection visible."
                            : "All three models run side by side. Individual scores and Grad-CAM++ per model."}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <SectionDivider label="Threshold Settings" />
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <FormField
                    label="High Risk Threshold"
                    hint="Confidence above this value triggers high risk alert."
                  >
                    <input type="number" step="0.01" min="0" max="1"
                      className={inputClass}
                      defaultValue={settings.HIGH_RISK_THRESHOLD || "0.60"} />
                  </FormField>
                  <FormField
                    label="Sensitivity Threshold (Clinical)"
                    hint="Sensitivity-first threshold. 85.4% sensitivity at 0.47."
                  >
                    <input type="number" step="0.001" min="0" max="1"
                      className={inputClass}
                      defaultValue={settings.SENSITIVITY_THRESHOLD || "0.47"} />
                  </FormField>
                </div>

                {saving && <p className="text-xs text-text3">Saving...</p>}
                {saved  && <p className="text-xs text-pos">✓ Setting saved.</p>}
                {error  && <p className="text-xs text-neg">{error}</p>}
              </>
            )}
          </div>
        </div>
      )}

      {/* NOTIFICATIONS TAB */}
      {activeTab === "Notifications" && (
        <div className="bg-surface border border-white/7 rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-white/7">
            <span className="text-sm font-semibold text-text1">Notification Settings</span>
          </div>
          <div className="p-5">
            <SectionDivider label="Email Alerts" />
            <div className="grid grid-cols-2 gap-4 mb-4">
              <FormField label="Notification Email">
                <input className={inputClass}
                  defaultValue={settings.NOTIFICATION_EMAIL || ""}
                  placeholder="alerts@clinic.com" />
              </FormField>
              <FormField label="Notify on OHTS Tiers">
                <input className={inputClass}
                  defaultValue={settings.NOTIFICATION_THRESHOLD || "critical,possible"} />
              </FormField>
            </div>
            <div className="flex justify-end pt-4 border-t border-white/7">
              <button className="px-4 py-2 text-xs font-medium text-white bg-accent hover:bg-accent2 rounded-lg border-0 transition-colors cursor-pointer font-sans">
                Save Notifications
              </button>
            </div>
          </div>
        </div>
      )}

      {/* API KEYS TAB */}
      {activeTab === "API Keys" && (
        <div className="bg-surface border border-white/7 rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-white/7">
            <span className="text-sm font-semibold text-text1">API Key Settings</span>
          </div>
          <div className="p-5">
            <SectionDivider label="OpenAI" />
            <div className="grid grid-cols-2 gap-4 mb-4">
              <FormField label="OpenAI API Key">
                <input type="password" className={inputClass}
                  placeholder="sk-••••••••••••••••••••" />
              </FormField>
              <FormField label="GPT Model">
                <select className={`${inputClass} cursor-pointer`}>
                  <option>gpt-4o</option>
                  <option>gpt-4o-mini</option>
                </select>
              </FormField>
            </div>

            <SectionDivider label="Groq (LLaMA)" />
            <div className="mb-4">
              <FormField label="Groq API Key">
                <input type="password" className={inputClass}
                  placeholder="gsk_••••••••••••••••••••" />
              </FormField>
            </div>

            <SectionDivider label="Google Gemini" />
            <div className="mb-4">
              <FormField label="Gemini API Key">
                <input type="password" className={inputClass}
                  placeholder="AIza••••••••••••••••••••" />
              </FormField>
            </div>

            <div className="flex justify-end pt-4 border-t border-white/7">
              <button className="px-4 py-2 text-xs font-medium text-white bg-accent hover:bg-accent2 rounded-lg border-0 transition-colors cursor-pointer font-sans">
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