// src/components/Layout.jsx
// Main layout wrapper - Tailwind CSS implementation.
// Sidebar with grouped nav, top bar, page content area.

import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

const NAV_GROUPS = [
  {
    label: "Main",
    items: [
      { label: "Dashboard",         path: "/dashboard",      icon: "⬛", roles: ["admin","doctor","nurse"] },
      { label: "Patients",          path: "/patients",       icon: "👥", roles: ["admin","doctor","nurse"] },
      { label: "Run Screening",     path: "/screenings/new", icon: "🔬", roles: ["admin","nurse"] },
      { label: "Screening History", path: "/screenings",     icon: "📋", roles: ["admin","doctor","nurse"] },
      { label: "Reports",           path: "/reports",        icon: "📄", roles: ["admin","doctor","nurse"] },
    ],
  },
  {
    label: "Analytics",
    items: [
      { label: "Analytics",         path: "/analytics",      icon: "📊", roles: ["admin","doctor","nurse"] },
      { label: "Model Performance", path: "/models",         icon: "🤖", roles: ["admin","doctor","nurse"] },
    ],
  },
  {
    label: "Admin",
    items: [
      { label: "User Management",   path: "/users",          icon: "🔐", roles: ["admin"] },
      { label: "Settings",          path: "/settings",       icon: "⚙️", roles: ["admin"] },
    ],
  },
];

function getInitials(user) {
  if (!user) return "?";
  const name = user.full_name || `${user.first_name ?? ""} ${user.last_name ?? ""}`;
  return name.trim().split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);
}

function Layout({ title, actions, children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  function handleLogout() {
    logout();
    navigate("/");
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-bg text-text1 font-sans">

      {/* SIDEBAR */}
      <div className="w-60 min-w-60 bg-surface border-r border-white/7 flex flex-col z-10">

        {/* Logo */}
        <div className="px-4 py-5 border-b border-white/7">
          <div className="flex items-center gap-2.5 mb-1">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-accent to-accent2 flex items-center justify-center text-base">
              👁
            </div>
            <span className="font-serif text-lg text-text1">GlaucomaAI</span>
          </div>
          <div className="text-xs text-text3 uppercase tracking-widest ml-10">
            Clinical System
          </div>
        </div>

        {/* Nav Groups */}
        <div className="flex-1 overflow-y-auto px-2.5 py-3">
          {NAV_GROUPS.map(group => {
            const visible = group.items.filter(i => i.roles.includes(user?.role));
            if (!visible.length) return null;
            return (
              <div key={group.label} className="mb-4">
                <div className="text-xs text-text3 uppercase tracking-widest px-2 mb-1.5">
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
                          ? "bg-accent/20 text-accent2 font-medium"
                          : "text-text2 hover:bg-accent/10 hover:text-text1"
                      }`}
                    >
                      {isActive && (
                        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-4 bg-accent rounded-r" />
                      )}
                      <span className="text-sm w-4 text-center">{item.icon}</span>
                      {item.label}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>

        {/* User Footer */}
        <div className="px-2.5 py-3 border-t border-white/7">
          <div
            onClick={() => navigate("/profile")}
            className="flex items-center gap-2.5 p-2 rounded-lg cursor-pointer hover:bg-surface2 transition-colors"
          >
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-accent to-accent2 flex items-center justify-center text-xs font-semibold text-white flex-shrink-0">
              {getInitials(user)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-text1 truncate">
                {user?.full_name ?? `${user?.first_name ?? ""} ${user?.last_name ?? ""}`}
              </div>
              <div className="text-xs text-text3 capitalize">{user?.role}</div>
            </div>
            <button
              onClick={e => { e.stopPropagation(); handleLogout(); }}
              className="text-text3 hover:text-text2 bg-transparent border-0 cursor-pointer text-base p-0.5 flex-shrink-0"
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
        <div className="h-13 border-b border-white/7 flex items-center px-6 gap-3 bg-surface flex-shrink-0" style={{ height: "52px" }}>
          <span className="text-sm font-semibold text-text1 flex-1">
            {title || location.pathname.replace("/", "").replace(/^\w/, c => c.toUpperCase())}
          </span>
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