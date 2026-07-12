// src/components/Layout.jsx
// Main layout wrapper - Tailwind CSS implementation.
// Sidebar with grouped nav, top bar, page content area.

import { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import API from "../api/index";

import { useTheme } from "../theme/ThemeProvider";
import { useSettings } from "../context/SettingsContext";


const NAV_GROUPS = [
  {
    label: "Main",
    items: [
      { label: "Dashboard",         path: "/dashboard",      icon: "/assets/icons/dashboard.svg", roles: ["admin", "doctor", "nurse"] },
      { label: "Patients",          path: "/patients",       icon: "/assets/icons/patients.svg", roles: ["admin", "doctor", "nurse"] },
      { label: "Run Screening",     path: "/screenings/new", icon: "/assets/icons/run-screening.svg", roles: ["admin", "nurse"] },
      { label: "Screening History", path: "/screenings",     icon: "/assets/icons/screening-history.svg", roles: ["admin", "doctor", "nurse"] },
      { label: "Reports",           path: "/reports",        icon: "/assets/icons/reports.svg", roles: ["admin", "doctor", "nurse"] },
    ],
  },
  {
    label: "Analytics",
    items: [
      { label: "Analytics",         path: "/analytics",      icon: "/assets/icons/analytics.svg", roles: ["admin", "doctor", "nurse"] },
      { label: "Model Performance", path: "/models",         icon: "/assets/icons/model-performance.svg", roles: ["admin", "doctor", "nurse"] },
    ],
  },
  {
    label: "Research",
    items: [
      { label: "Evaluation",  path: "/research/evaluation", icon: "/assets/icons/analytics.svg", roles: ["researcher"] },
      { label: "LLM Results", path: "/research/results",    icon: "/assets/icons/reports.svg", roles: ["admin"] },
    ],
  },  
  {
    label: "Admin",
    items: [
      { label: "User Management",   path: "/users",          icon: "/assets/icons/user-management.svg", roles: ["admin", "doctor", "nurse"] },
      { label: "Settings",          path: "/settings",       icon: "/assets/icons/settings.svg", roles: ["admin", "doctor", "nurse"] },
    ],
  },
];

function getInitials(user) {
  if (!user) return "?";

  const name = user.full_name || `${user.first_name ?? ""} ${user.last_name ?? ""}`;

  return name
    .trim()
    .split(" ")
    .map(n => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function Layout({ title, actions, children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  {/* THEME */}
  const { currentTheme, themes } = useTheme();
  const isDarkTheme = themes[currentTheme]?.mode === "dark";
  const logoSrc = isDarkTheme
    ? "/assets/glaucoma-ai-logo-dark.png"
    : "/assets/glaucoma-ai-logo-light.png";

  // Active screening mode shown globally in the top bar.
  // This reads the current system setting, not the saved mode of a past screening.
  const { getSetting } = useSettings();
  const activeMode = getSetting("INFERENCE_MODE", "clinical");

const [evaluationComplete, setEvaluationComplete] = useState(false);

// Feedback modal state
const [showFeedback, setShowFeedback] = useState(false); 
const [feedback, setFeedback] = useState({ 
  name: user?.full_name || "",
  email: "",
  type: "General Feedback",
  subject: "",
  description: "",
});
const [feedbackSending, setFeedbackSending] = useState(false);
const [feedbackSent, setFeedbackSent] = useState(false);
const [feedbackError, setFeedbackError] = useState(null);

function openFeedback() {
  setFeedback({
    name: user?.full_name || "",
    email: "",
    type: "General Feedback",
    subject: "",
    description: "",
  });
  setFeedbackSent(false);
  setFeedbackError(null);
  setShowFeedback(true);
}

async function submitFeedback() {
  if (!feedback.subject.trim() || !feedback.description.trim()) {
    setFeedbackError("Subject and description are required.");
    return;
  }
  setFeedbackSending(true);
  setFeedbackError(null);
  try {
    await API.post("/feedback/", feedback);
    setFeedbackSent(true);
    setTimeout(() => setShowFeedback(false), 2000);
  } catch {
    setFeedbackError("Failed to send feedback. Please try again.");
  } finally {
    setFeedbackSending(false);
  }
}


useEffect(() => {
  if (!user?.is_researcher) return;
  API.get("/evaluation/progress")
    .then(res => setEvaluationComplete(res.data?.complete === true))
    .catch(() => setEvaluationComplete(false));
}, [user]);


  function handleLogout() {
    logout();
    navigate("/");
  }

  
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-bg text-text1 font-sans">

    {/* FEEDBACK MODAL */}
      {showFeedback && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-surface border border-white/12 rounded-xl w-full max-w-md mx-4 overflow-hidden">

            {/* Header */}
            <div className="px-5 py-4 border-b border-white/7 flex items-center justify-between">
              <span className="text-sm font-semibold text-text1">Send Feedback</span>
              <button
                onClick={() => setShowFeedback(false)}
                className="text-text3 hover:text-text2 bg-transparent border-0 cursor-pointer text-lg leading-none font-sans"
              >
                ✕
              </button>
            </div>

            {/* Body */}
            <div className="p-5 flex flex-col gap-3">
              {feedbackSent ? (
                <div className="text-center py-6">
                  <div className="text-2xl mb-2">✅</div>
                  <div className="text-sm font-semibold text-pos mb-1">Feedback sent!</div>
                  <div className="text-xs text-text3">Thank you. We will review your feedback shortly.</div>
                </div>
              ) : (
                <>
                  {/* Name - read only */}
                  <div>
                    <label className="block text-xs font-medium text-text2 mb-1.5">Name</label>
                    <input
                      value={feedback.name}
                      readOnly
                      className="w-full bg-surface3 border border-white/7 rounded-lg px-3 py-2.5 text-sm text-text3 outline-none cursor-not-allowed font-sans"
                    />
                  </div>

                  {/* Email */}
                  <div>
                    <label className="block text-xs font-medium text-text2 mb-1.5">Email</label>
                    <input
                      type="email"
                      value={feedback.email}
                      onChange={e => setFeedback(prev => ({ ...prev, email: e.target.value }))}
                      placeholder="your@email.com"
                      className="w-full bg-surface2 border border-white/12 rounded-lg px-3 py-2.5 text-sm text-text1 outline-none placeholder:text-text3 focus:border-accent transition-colors font-sans"
                    />
                  </div>

                  {/* Type */}
                  <div>
                    <label className="block text-xs font-medium text-text2 mb-1.5">Type</label>
                    <select
                      value={feedback.type}
                      onChange={e => setFeedback(prev => ({ ...prev, type: e.target.value }))}
                      className="w-full bg-surface2 border border-white/12 rounded-lg px-3 py-2.5 text-sm text-text2 outline-none cursor-pointer font-sans"
                    >
                      <option>General Feedback</option>
                      <option>Bug Report</option>
                      <option>Feature Request</option>
                    </select>
                  </div>

                  {/* Subject */}
                  <div>
                    <label className="block text-xs font-medium text-text2 mb-1.5">Subject</label>
                    <input
                      value={feedback.subject}
                      onChange={e => setFeedback(prev => ({ ...prev, subject: e.target.value }))}
                      placeholder="Brief summary of your feedback"
                      className="w-full bg-surface2 border border-white/12 rounded-lg px-3 py-2.5 text-sm text-text1 outline-none placeholder:text-text3 focus:border-accent transition-colors font-sans"
                    />
                  </div>

                  {/* Description */}
                  <div>
                    <label className="block text-xs font-medium text-text2 mb-1.5">Description</label>
                    <textarea
                      value={feedback.description}
                      onChange={e => setFeedback(prev => ({ ...prev, description: e.target.value }))}
                      placeholder="Tell us more..."
                      rows={4}
                      className="w-full bg-surface2 border border-white/12 rounded-lg px-3 py-2.5 text-sm text-text1 outline-none placeholder:text-text3 focus:border-accent transition-colors font-sans resize-none leading-relaxed"
                    />
                  </div>

                  {feedbackError && (
                    <div className="text-xs text-neg">{feedbackError}</div>
                  )}

                  {/* Actions */}
                  <div className="flex gap-2.5 justify-end pt-1">
                    <button
                      onClick={() => setShowFeedback(false)}
                      className="px-4 py-2 text-xs font-medium text-text2 border border-white/12 rounded-lg bg-transparent hover:bg-white/5 transition-colors cursor-pointer font-sans"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={submitFeedback}
                      disabled={feedbackSending}
                      className="px-4 py-2 text-xs font-medium text-white bg-accent hover:bg-accent2 disabled:bg-surface3 disabled:text-text3 rounded-lg border-0 transition-colors cursor-pointer font-sans"
                    >
                      {feedbackSending ? "Sending..." : "Send Feedback"}
                    </button>
                  </div>
                </>
              )}
            </div>

          </div>
        </div>
      )}

      {/* SIDEBAR */}
      <div className="w-60 min-w-60 bg-sbBg border-r border-sbBorder flex flex-col z-10">

      {/* Logo */}
      <div className="px-4 py-5 border-b border-sbBorder">
        <div className="flex flex-col items-center justify-center">
          <img
            src={logoSrc}
            alt="Glaucoma AI"
            className="h-8 w-auto max-w-[190px] object-contain"
          />

          <div className="text-[11px] text-sbText3 uppercase tracking-[0.22em] mt-2 text-center">
            Screening System
          </div>
          <div className="text-[11px] text-sbText3 font-mono mt-1 text-center opacity-80">
            ver.{__APP_VERSION__}
          </div>        
        </div>
      </div>

        {/* Nav Groups */}
        <div className="flex-1 overflow-y-auto px-2.5 py-3">
          {NAV_GROUPS.map(group => {
            const visible = group.items.filter(i =>
              i.roles.includes(user?.role) ||
              (i.roles.includes("researcher") && user?.is_researcher === true)
            );

            if (!visible.length) return null;

            return (
              <div key={group.label} className="mb-4">
                <div className="text-xs text-sbText3 uppercase tracking-widest px-2 mb-1.5">
                  {group.label}
                </div>

                {visible.map(item => {
                  const isActive = location.pathname === item.path;

                  return (
                    <div
                      key={item.path}
                      onClick={() => navigate(item.path)}
                      className={`relative flex items-center gap-2.5 px-2.5 py-2 rounded-lg cursor-pointer text-sm mb-0.5 transition-all ${
                        isActive
                          ? "bg-sbActive text-sbActiveText font-medium"
                          : "text-sbText2 hover:bg-sbHover hover:text-sbText"
                      }`}
                    >
                      {isActive && (
                        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-4 bg-sbBar rounded-r" />
                      )}

                        <span
                          className="w-4 h-4 shrink-0 opacity-90"
                          style={{
                            // CSS mask keeps SVG icons theme-aware.
                            // The icon uses the current sidebar text colour instead of a fixed PNG colour.
                            backgroundColor: "currentColor",
                            WebkitMask: `url(${item.icon}) center / contain no-repeat`,
                            mask: `url(${item.icon}) center / contain no-repeat`,
                          }}
                          aria-hidden="true"
                        />

                      {item.label}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>

        {/* Feedback link */}
        <div className="px-3.5 pb-2">
          <button
            onClick={openFeedback}
            className="w-full flex items-center gap-2 text-xs text-sbText3 hover:text-sbText2 bg-transparent border-0 cursor-pointer font-sans py-1.5 transition-colors"
          >
            <span className="text-sm">💬</span>
            Send Feedback
          </button>
        </div>

        {/* User Footer */}
        <div className="px-2.5 py-3 border-t border-sbBorder">
          <div
            onClick={() => navigate("/profile")}
            className="flex items-center gap-2.5 p-2 rounded-lg cursor-pointer hover:bg-sbSurface2 transition-colors"
          >
            <div className="w-8 h-8 rounded-full bg-accent flex items-center justify-center text-xs font-bold text-white ring-1 ring-border2 shadow-sm flex-shrink-0">
              {getInitials(user)}
            </div>         
 

            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-sbText truncate">
                {user?.full_name ?? `${user?.first_name ?? ""} ${user?.last_name ?? ""}`}
              </div>
              <div className="text-xs text-sbText3 capitalize">
                {user?.role}
              </div>
            </div>

            <button
              onClick={e => {
                e.stopPropagation();
                handleLogout();
              }}
              className="text-sbText3 hover:text-sbText2 bg-transparent border-0 cursor-pointer text-base p-0.5 flex-shrink-0"
              title="Sign out"
            >
              ⏻
            </button>
          </div>
        </div>

      </div>

      {/* MAIN */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">

        {/* Top Bar */}
        <div
          className="border-b border-border flex items-center px-6 gap-3 bg-surface flex-shrink-0"
          style={{ height: "52px" }}
        >
          <span className="text-sm font-semibold text-text1 flex-1">
            {title || location.pathname.replace("/", "").replace(/^\w/, c => c.toUpperCase())}
          </span>

          {/* Global active mode indicator.
            Theme-aware colours: uses app theme tokens instead of fixed colours. */}
          <div className="px-3 py-1 rounded-full text-xs font-semibold border border-border2 bg-surface2 text-text1 whitespace-nowrap">
            Mode: {activeMode === "research" ? "Research" : "Clinical"}
          </div>

          {actions && (
            <div className="flex items-center gap-2">
              {actions}
            </div>
          )}
        </div>

        {/* Page Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {children}
        </div>

      </div>
    </div>
  );
}

export default Layout;