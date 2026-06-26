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