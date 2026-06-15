// src/pages/Settings.jsx
// Settings page - Tailwind CSS implementation.
// Master Save button in top bar. isDirty navigation guard.
// Inference mode toggle saves immediately - never dirty.

import { useState, useEffect, useCallback } from "react";
import { useBlocker } from "react-router-dom";
import Layout from "../components/Layout";
import API from "../api/index";

import { useTheme } from "../theme/ThemeProvider";
import { THEME_GROUPS } from "../theme/themes";

import { useSettings } from "../context/SettingsContext";

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

const TABS = ["General", "AI Models", "Notifications", "API Keys", "Appearance"];

function ThemeCard({ theme, selected, onSelect }) {
  const badgeClass = {
    Dark: "bg-white/10 text-text3",
    Light: "bg-accent/10 text-accent2",
    "Eye-Safe": "bg-pos/10 text-pos",
    Default: "bg-warn/10 text-warn",
  };

  return (
    <div
      onClick={onSelect}
      className={`relative bg-surface2 border-2 rounded-xl p-3.5 cursor-pointer transition-all hover:-translate-y-0.5 hover:shadow-lg ${
        selected ? "border-accent" : "border-border hover:border-border2"
      }`}
    >
      {selected && (
        <div className="absolute top-2.5 right-2.5 w-5 h-5 rounded-full bg-accent text-white text-xs font-bold flex items-center justify-center">
          ✓
        </div>
      )}

      <div className="flex h-12 rounded-lg overflow-hidden mb-2.5 gap-0.5">
        <div style={{ background: theme.preview[0], flex: 1.2 }} />
        <div style={{ background: theme.preview[1], flex: 2 }} />
        <div style={{ background: theme.preview[2], flex: 0.8 }} />
      </div>

      <div className="text-sm font-semibold text-text1 mb-1.5">
        {theme.name}
      </div>

      <div className="flex gap-1.5 flex-wrap">
        {theme.badges.map(badge => (
          <span
            key={badge}
            className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${badgeClass[badge] || "bg-surface3 text-text3"}`}
          >
            {badge}
          </span>
        ))}
      </div>
    </div>
  );
}

function Settings() {
  const [activeTab, setActiveTab] = useState("General");
  const [settings, setSettings] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);
  const [isDirty, setIsDirty] = useState(false);
  const [showBlockModal, setShowBlockModal] = useState(false);

  const { currentTheme, setTheme, themes } = useTheme();
  const { refreshSettings } = useSettings();
  // Form states
const [general, setGeneral] = useState({
  CLINIC_NAME:               "",
  ALERT_EMAIL:               "",
  EMAIL_NOTIFICATIONS:       "true",
  REFERRING_CLINICIAN_NAME:  "",
  REFERRING_CLINICIAN_TITLE: "",
  CLINIC_ADDRESS:            "",
  CLINIC_PHONE:              "",
  CLINIC_EMAIL:              "",
});
  const [notifications, setNotifications] = useState({
    NOTIFICATION_EMAIL: "",
    NOTIFICATION_THRESHOLD: "critical,possible",
  });

  // API status state
  const [apiStatus, setApiStatus] = useState({});
  const [apiTesting, setApiTesting] = useState({});

  //AI Model thresholds 
const [thresholds, setThresholds] = useState({
  HIGH_RISK_THRESHOLD: "0.60",
  SENSITIVITY_THRESHOLD: "0.47",
});

  // Block navigation when dirty
  const blocker = useBlocker(
    useCallback(({ currentLocation, nextLocation }) =>
      isDirty && currentLocation.pathname !== nextLocation.pathname,
      [isDirty]
    )
  );

  // Show modal when blocker fires
  useEffect(() => {
    if (blocker.state === "blocked") {
      setShowBlockModal(true);
    }
  }, [blocker.state]);

  useEffect(() => {
    API.get("/settings/")
      .then(res => {
        const map = {};
        res.data.forEach(s => { map[s.set_code] = s.set_value; });
        setSettings(map);
        setGeneral({
          CLINIC_NAME:               map.CLINIC_NAME || "",
          ALERT_EMAIL:               map.ALERT_EMAIL || "",
          EMAIL_NOTIFICATIONS:       map.EMAIL_NOTIFICATIONS || "true",
          REFERRING_CLINICIAN_NAME:  map.REFERRING_CLINICIAN_NAME || "",
          REFERRING_CLINICIAN_TITLE: map.REFERRING_CLINICIAN_TITLE || "",
          CLINIC_ADDRESS:            map.CLINIC_ADDRESS || "",
          CLINIC_PHONE:              map.CLINIC_PHONE || "",
          CLINIC_EMAIL:              map.CLINIC_EMAIL || "",
        });
        setNotifications({
          NOTIFICATION_EMAIL:     map.NOTIFICATION_EMAIL || "",
          NOTIFICATION_THRESHOLD: map.NOTIFICATION_THRESHOLD || "critical,possible",
        });
        setThresholds({
          HIGH_RISK_THRESHOLD: map.HIGH_RISK_THRESHOLD || "0.60",
          SENSITIVITY_THRESHOLD: map.SENSITIVITY_THRESHOLD || "0.47",
        });
        setLoading(false);
      })
      .catch(() => {
        setSettings({ INFERENCE_MODE: "clinical" });
        setLoading(false);
      });
  }, []);

  // Mark dirty on any field change
  function updateGeneral(key, value) {
    setGeneral(prev => ({ ...prev, [key]: value }));
    setIsDirty(true);
  }

  function updateNotifications(key, value) {
    setNotifications(prev => ({ ...prev, [key]: value }));
    setIsDirty(true);
  }


  // Inference mode - saves immediately, never dirty
  async function saveSetting(key, value) {
    try {
      await API.put(`/settings/${key}`, { set_value: value, status: "A" });
      await refreshSettings();
      setSettings(prev => ({ ...prev, [key]: value }));
    } catch {
      setError("Failed to save inference mode.");
    }
  }

  // Save all settings using POST upsert
async function saveAll() {
  setSaving(true);
  setSaved(false);
  setError(null);

  // Validate thresholds
  const highRisk = parseFloat(thresholds.HIGH_RISK_THRESHOLD);
  const sensitivity = parseFloat(thresholds.SENSITIVITY_THRESHOLD);
  if (isNaN(highRisk) || highRisk < 0 || highRisk > 1) {
    setError("High Risk Threshold must be between 0 and 1.");
    setSaving(false);
    return;
  }
  if (isNaN(sensitivity) || sensitivity < 0 || sensitivity > 1) {
    setError("Sensitivity Threshold must be between 0 and 1.");
    setSaving(false);
    return;
  }

    const toSave = [
      { set_code: "CLINIC_NAME",           set_value: general.CLINIC_NAME,          category: "General",       set_name: "Clinic Name" },
      { set_code: "ALERT_EMAIL",            set_value: general.ALERT_EMAIL,           category: "General",       set_name: "Alert Email" },
      { set_code: "EMAIL_NOTIFICATIONS",    set_value: general.EMAIL_NOTIFICATIONS,   category: "Email",         set_name: "Email Notifications" },
      { set_code: "NOTIFICATION_EMAIL",     set_value: notifications.NOTIFICATION_EMAIL,     category: "Email", set_name: "Notification Email" },
      { set_code: "NOTIFICATION_THRESHOLD", set_value: notifications.NOTIFICATION_THRESHOLD, category: "Email", set_name: "Notification Threshold" },
      { set_code: "HIGH_RISK_THRESHOLD",   set_value: thresholds.HIGH_RISK_THRESHOLD,   category: "ML", set_name: "High Risk Threshold" },
      { set_code: "SENSITIVITY_THRESHOLD", set_value: thresholds.SENSITIVITY_THRESHOLD, category: "ML", set_name: "Sensitivity Threshold" },
      { set_code: "REFERRING_CLINICIAN_NAME",  set_value: general.REFERRING_CLINICIAN_NAME,  category: "General", set_name: "Referring Clinician Name" },
      { set_code: "REFERRING_CLINICIAN_TITLE", set_value: general.REFERRING_CLINICIAN_TITLE, category: "General", set_name: "Referring Clinician Title" },
      { set_code: "CLINIC_ADDRESS",            set_value: general.CLINIC_ADDRESS,            category: "General", set_name: "Clinic Address" },
      { set_code: "CLINIC_PHONE",              set_value: general.CLINIC_PHONE,              category: "General", set_name: "Clinic Phone" },
      { set_code: "CLINIC_EMAIL",              set_value: general.CLINIC_EMAIL,              category: "General", set_name: "Clinic Email" },
    ];

    try {
      await Promise.all(toSave.map(s => API.post("/settings/", s, {
        headers: { "Content-Type": "application/json" }
      })));
      setSettings(prev => ({
        ...prev,
        ...Object.fromEntries(toSave.map(s => [s.set_code, s.set_value])),
      }));
      setIsDirty(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      setError("Failed to save settings.");
    } finally {
      setSaving(false);
    }
  }

function updateThresholds(key, value) {
  setThresholds(prev => ({ ...prev, [key]: value }));
  setIsDirty(true);
}

  async function testApi(provider) {
    const key = provider || "all";
    setApiTesting(prev => ({ ...prev, [key]: true }));
    try {
      const url = provider
        ? `/settings/api-keys/status?provider=${provider}`
        : "/settings/api-keys/status";
      const res = await API.get(url);
      setApiStatus(prev => ({ ...prev, ...res.data }));
    } catch {
      if (provider) {
        setApiStatus(prev => ({
          ...prev,
          [provider]: { configured: false, valid: false, status: "error" }
        }));
      }
    } finally {
      setApiTesting(prev => ({ ...prev, [key]: false }));
    }
  }

  // Top bar actions
  const actions = (
    <div className="flex items-center gap-3">
      {isDirty && (
        <span className="text-xs text-warn flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-warn" />
          Unsaved changes
        </span>
      )}
      {saving && <span className="text-xs text-text3">Saving...</span>}
      {saved  && <span className="text-xs text-pos">✓ All settings saved.</span>}
      {error  && <span className="text-xs text-neg">{error}</span>}
      <button
        onClick={saveAll}
        disabled={saving || !isDirty}
        className="px-4 py-1.5 text-xs font-medium text-white bg-accent hover:bg-accent2 disabled:bg-surface3 disabled:cursor-not-allowed rounded-lg border-0 transition-colors cursor-pointer font-sans"
      >
        {saving ? "Saving..." : "Save All Settings"}
      </button>
    </div>
  );

  return (
    <Layout title="Settings" actions={actions}>

      {/* UNSAVED CHANGES MODAL */}
      {showBlockModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-surface border border-white/12 rounded-xl w-full max-w-sm mx-4 overflow-hidden">
            <div className="px-5 py-4 border-b border-white/7">
              <span className="text-sm font-semibold text-text1">Unsaved Changes</span>
            </div>
            <div className="p-5">
              <p className="text-sm text-text2 leading-relaxed mb-5">
                You have unsaved changes in Settings. What would you like to do?
              </p>
              <div className="flex gap-2.5 justify-end">
                <button
                  onClick={() => { setShowBlockModal(false); blocker.reset(); }}
                  className="px-4 py-2 text-xs font-medium text-text2 border border-white/12 rounded-lg bg-transparent hover:bg-white/5 transition-colors cursor-pointer font-sans"
                >
                  Cancel
                </button>
                <button
                  onClick={() => { setShowBlockModal(false); setIsDirty(false); blocker.proceed(); }}
                  className="px-4 py-2 text-xs font-medium text-text2 border border-white/12 rounded-lg bg-transparent hover:bg-white/5 transition-colors cursor-pointer font-sans"
                >
                  Leave without saving
                </button>
                <button
                  onClick={async () => {
                    await saveAll();
                    setShowBlockModal(false);
                    blocker.proceed();
                  }}
                  className="px-4 py-2 text-xs font-medium text-white bg-accent hover:bg-accent2 rounded-lg border-0 transition-colors cursor-pointer font-sans"
                >
                  Save & Leave
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TABS */}
      <div className="flex gap-1 mb-5 bg-surface border border-white/7 rounded-xl p-1 w-fit">
        {TABS.map(tab => (
          <div key={tab} onClick={() => setActiveTab(tab)}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-all ${
              activeTab === tab ? "bg-surface3 text-text1" : "text-text2 hover:text-text1"
            }`}>
            {tab}
            {isDirty && (tab === "General" || tab === "Notifications") && activeTab !== tab && (
              <span className="ml-1.5 w-1.5 h-1.5 rounded-full bg-warn inline-block" />
            )}
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
                <input className={inputClass}
                  value={general.CLINIC_NAME}
                  onChange={e => updateGeneral("CLINIC_NAME", e.target.value)}
                  placeholder="GlaucomaAI Clinical System" />
              </FormField>
              <FormField label="Clinic Email">
                <input type="email" className={inputClass}
                  value={general.CLINIC_EMAIL}
                  onChange={e => updateGeneral("CLINIC_EMAIL", e.target.value)}
                  placeholder="clinic@example.com" />
              </FormField>
            </div>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <FormField label="Clinic Phone">
                <input className={inputClass}
                  value={general.CLINIC_PHONE}
                  onChange={e => updateGeneral("CLINIC_PHONE", e.target.value)}
                  placeholder="+64 9 555 0000" />
              </FormField>
              <FormField label="Clinic Address">
                <input className={inputClass}
                  value={general.CLINIC_ADDRESS}
                  onChange={e => updateGeneral("CLINIC_ADDRESS", e.target.value)}
                  placeholder="123 Queen Street, Auckland" />
              </FormField>
            </div>

            <SectionDivider label="Referring Clinician" />
            <div className="p-3 bg-accent/10 border border-accent/20 rounded-lg text-xs text-accent2 mb-4 leading-relaxed">
              ℹ This name and title will be used to sign all AI-generated referral letters. Set this to the designated clinician at your clinic.
            </div>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <FormField label="Referring Clinician Name">
                <input className={inputClass}
                  value={general.REFERRING_CLINICIAN_NAME}
                  onChange={e => updateGeneral("REFERRING_CLINICIAN_NAME", e.target.value)}
                  placeholder="Dr. Smith" />
              </FormField>
              <FormField label="Referring Clinician Title">
                <input className={inputClass}
                  value={general.REFERRING_CLINICIAN_TITLE}
                  onChange={e => updateGeneral("REFERRING_CLINICIAN_TITLE", e.target.value)}
                  placeholder="General Ophthalmologist" />
              </FormField>
            </div>

            <SectionDivider label="Notifications" />
            <div className="grid grid-cols-2 gap-4 mb-4">
              <FormField label="High Risk Email Alert">
                <select
                  className={`${inputClass} cursor-pointer`}
                  value={general.EMAIL_NOTIFICATIONS}
                  onChange={e => updateGeneral("EMAIL_NOTIFICATIONS", e.target.value)}
                >
                  <option value="true">Enabled</option>
                  <option value="false">Disabled</option>
                </select>
              </FormField>
              <FormField label="Alert Email">
                <input
                  className={inputClass}
                  value={general.ALERT_EMAIL}
                  onChange={e => updateGeneral("ALERT_EMAIL", e.target.value)}
                  placeholder="alerts@clinic.com"
                />
              </FormField>
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
                    Only Admin can change this setting. Changes take effect immediately.
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
                  <p className="text-xs text-text3 mt-3">
                    ℹ Inference mode saves immediately — no need to click Save All.
                  </p>
                </div>

                <SectionDivider label="Threshold Settings" />
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <FormField
                    label="High Risk Threshold"
                    hint="Confidence above this value triggers high risk alert."
                  >
                    <input type="number" step="0.01" min="0" max="1"
                      className={inputClass}
                      value={thresholds.HIGH_RISK_THRESHOLD}
                      onChange={e => updateThresholds("HIGH_RISK_THRESHOLD", e.target.value)}
                    />
                  </FormField>
                  <FormField
                    label="Sensitivity Threshold (Clinical)"
                    hint="Sensitivity-first threshold. 85.4% sensitivity at 0.47."
                  >
                    <input type="number" step="0.001" min="0" max="1"
                      className={inputClass}
                      value={thresholds.SENSITIVITY_THRESHOLD}
                      onChange={e => updateThresholds("SENSITIVITY_THRESHOLD", e.target.value)}
                    />
                  </FormField>
                </div>
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
                <input
                  className={inputClass}
                  value={notifications.NOTIFICATION_EMAIL}
                  onChange={e => updateNotifications("NOTIFICATION_EMAIL", e.target.value)}
                  placeholder="alerts@clinic.com"
                />
              </FormField>
              <FormField label="Notify on OHTS Tiers">
                <input
                  className={inputClass}
                  value={notifications.NOTIFICATION_THRESHOLD}
                  onChange={e => updateNotifications("NOTIFICATION_THRESHOLD", e.target.value)}
                  placeholder="critical,possible"
                />
              </FormField>
            </div>
          </div>
        </div>
      )}

      {/* API KEYS TAB */}
      {activeTab === "API Keys" && (
        <div className="bg-surface border border-white/7 rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-white/7">
            <span className="text-sm font-semibold text-text1">API Key Status</span>
          </div>
          <div className="p-5">
            <div className="px-4 py-3 bg-accent/10 border border-accent/20 rounded-lg text-xs text-accent2 mb-5 leading-relaxed">
              ℹ API keys are managed via server environment variables. Contact your system administrator to update them.
            </div>

            {[
              { key: "openai", label: "OpenAI",  sub: "GPT-4o Vision + GPT-4o-mini" },
              { key: "groq",   label: "Groq",    sub: "LLaMA Vision" },
              { key: "gemini", label: "Gemini",  sub: "Google Gemini Vision" },
            ].map(service => {
              const status = apiStatus[service.key];
              const testing = apiTesting[service.key];
              let badgeCls = "bg-surface3 text-text3 border-white/12";
              let badgeLabel = "Unknown";
              if (status) {
                if (!status.configured) { badgeCls = "bg-surface3 text-text3 border-white/12"; badgeLabel = "Not Configured"; }
                else if (!status.valid)  { badgeCls = "bg-neg/10 text-neg border-neg/20";       badgeLabel = "Invalid Key"; }
                else                     { badgeCls = "bg-pos/10 text-pos border-pos/20";       badgeLabel = "Connected"; }
              }
              return (
                <div key={service.key} className="flex items-center gap-4 px-4 py-3.5 bg-surface2 border border-white/7 rounded-xl mb-3">
                  <div className="flex-1">
                    <div className="text-sm font-medium text-text1">{service.label}</div>
                    <div className="text-xs text-text3 mt-0.5">{service.sub}</div>
                  </div>
                  <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border ${badgeCls}`}>
                    <span className="w-1.5 h-1.5 rounded-full bg-current" />
                    {badgeLabel}
                  </span>
                  <button
                    onClick={() => testApi(service.key)}
                    disabled={testing}
                    className="px-3 py-1.5 text-xs font-medium text-text2 border border-white/12 rounded-lg bg-transparent hover:bg-white/5 transition-colors cursor-pointer font-sans disabled:opacity-50 flex items-center gap-1.5"
                  >
                    {testing ? (
                      <>
                        <span className="w-3 h-3 border border-text3 border-t-text2 rounded-full animate-spin" />
                        Testing...
                      </>
                    ) : "Test"}
                  </button>
                </div>
              );
            })}

            <div className="pt-4 border-t border-white/7">
              <button
                onClick={() => testApi(null)}
                disabled={apiTesting["all"]}
                className="w-full py-2.5 text-xs font-medium text-text2 border border-white/12 rounded-lg bg-transparent hover:bg-white/5 transition-colors cursor-pointer font-sans disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {apiTesting["all"] ? (
                  <>
                    <span className="w-3 h-3 border border-text3 border-t-text2 rounded-full animate-spin" />
                    Testing All...
                  </>
                ) : "🔄 Test All Connections"}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* APPEARANCE TAB */}
      {activeTab === "Appearance" && (
        <div className="bg-surface border border-border rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-border">
            <span className="text-sm font-semibold text-text1">Appearance</span>
            <p className="text-xs text-text3 mt-1">
              Choose a comfortable colour theme for long clinical review sessions.
            </p>
          </div>

          <div className="p-5">
            <div className="px-4 py-3 bg-surface2 border border-border rounded-lg border-l-4 border-l-accent text-xs text-text3 leading-relaxed mb-5">
              Based on PMC (2024) and WCAG 2.1 research - muted tones reduce eye fatigue for extended screen use. Light themes use soft off-white backgrounds instead of pure white. All themes meet WCAG AA contrast standards.
            </div>

            {THEME_GROUPS.map(group => (
              <div key={group.label} className="mb-6">
                <SectionDivider label={group.label} />

                <div className="grid grid-cols-4 gap-3">
                  {group.ids.map(id => (
                    <ThemeCard
                      key={id}
                      theme={themes[id]}
                      selected={currentTheme === id}
                      onSelect={() => setTheme(id)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Layout>
  );
}

export default Settings;