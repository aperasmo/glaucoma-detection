// src/components/Layout.jsx
// Matches the mock UI shell exactly.
// DM Sans + DM Mono + Playfair Display fonts.
// CSS variables match the mock UI design system.

import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

const V = {
  bg:         "#0C1220",
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
  neg:        "#FF6B6B",
  warn:       "#FFB84D",
  text:       "#E8EEF7",
  text2:      "#8FA3BF",
  text3:      "#4E6580",
};

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
    <>
      <div style={{
        display: "flex",
        height: "100vh",
        width: "100vw",
        overflow: "hidden",
        background: V.bg,
        color: V.text,
        fontFamily: "'DM Sans', sans-serif",
      }}>

        {/* ── SIDEBAR ── */}
        <div style={{
          width: "240px",
          minWidth: "240px",
          background: V.surface,
          borderRight: `1px solid ${V.border}`,
          display: "flex",
          flexDirection: "column",
          zIndex: 10,
        }}>

          {/* Logo */}
          <div style={{
            padding: "20px 16px 16px",
            borderBottom: `1px solid ${V.border}`,
          }}>
            <div style={{ display:"flex", alignItems:"center", gap:"10px", marginBottom:"3px" }}>
              <div style={{
                width: "30px", height: "30px",
                background: `linear-gradient(135deg, ${V.accent}, ${V.accent2})`,
                borderRadius: "7px",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: "15px",
              }}>
                👁
              </div>
              <span style={{
                fontFamily: "'Playfair Display', serif",
                fontSize: "17px",
                color: V.text,
              }}>
                GlaucomaAI
              </span>
            </div>
            <div style={{
              fontSize: "10px",
              color: V.text3,
              letterSpacing: "0.8px",
              textTransform: "uppercase",
              marginLeft: "40px",
            }}>
              Clinical Screening System
            </div>
          </div>

          {/* Nav Groups */}
          <div style={{ padding: "12px 10px 6px", flex: 1, overflowY: "auto" }}>
            {NAV_GROUPS.map(group => {
              const visible = group.items.filter(i => i.roles.includes(user?.role));
              if (!visible.length) return null;
              return (
                <div key={group.label} style={{ marginBottom: "8px" }}>
                  <div style={{
                    fontSize: "10px",
                    letterSpacing: "1.2px",
                    textTransform: "uppercase",
                    color: V.text3,
                    padding: "0 8px",
                    marginBottom: "4px",
                  }}>
                    {group.label}
                  </div>
                  {visible.map(item => {
                    const isActive = location.pathname === item.path;
                    return (
                      <div
                        key={item.path}
                        onClick={() => navigate(item.path)}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "9px",
                          padding: "8px 10px",
                          borderRadius: "7px",
                          cursor: "pointer",
                          fontSize: "13px",
                          color: isActive ? V.accent2 : V.text2,
                          background: isActive ? V.accentDim2 : "transparent",
                          fontWeight: isActive ? "500" : "400",
                          marginBottom: "1px",
                          position: "relative",
                          transition: "all 0.15s",
                        }}
                        onMouseEnter={e => {
                          if (!isActive) {
                            e.currentTarget.style.background = V.accentDim;
                            e.currentTarget.style.color = V.text;
                          }
                        }}
                        onMouseLeave={e => {
                          if (!isActive) {
                            e.currentTarget.style.background = "transparent";
                            e.currentTarget.style.color = V.text2;
                          }
                        }}
                      >
                        {isActive && (
                          <div style={{
                            position: "absolute",
                            left: 0, top: "50%",
                            transform: "translateY(-50%)",
                            width: "3px", height: "16px",
                            background: V.accent,
                            borderRadius: "0 3px 3px 0",
                          }} />
                        )}
                        <span style={{ fontSize:"14px", width:"18px", textAlign:"center" }}>
                          {item.icon}
                        </span>
                        {item.label}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>

          {/* User Footer */}
          <div style={{
            padding: "12px 10px",
            borderTop: `1px solid ${V.border}`,
          }}>
            <div
              onClick={handleLogout}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "9px",
                padding: "8px",
                borderRadius: "7px",
                cursor: "pointer",
                transition: "background 0.15s",
              }}
              onMouseEnter={e => e.currentTarget.style.background = V.surface2}
              onMouseLeave={e => e.currentTarget.style.background = "transparent"}
            >
              <div style={{
                width: "30px", height: "30px",
                borderRadius: "50%",
                background: `linear-gradient(135deg, ${V.accent}, ${V.accent2})`,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: "12px", fontWeight: "600", color: "white",
                flexShrink: 0,
              }}>
                {getInitials(user)}
              </div>
              <div>
                <div style={{ fontSize:"13px", fontWeight:"500", color: V.text }}>
                  {user?.full_name ?? `${user?.first_name ?? ""} ${user?.last_name ?? ""}`}
                </div>
                <div style={{ fontSize:"11px", color: V.text3, textTransform:"capitalize" }}>
                  {user?.role} · Sign out
                </div>
              </div>
            </div>
          </div>

        </div>

        {/* ── MAIN ── */}
        <div style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          minWidth: 0,
        }}>

          {/* Top Bar */}
          <div style={{
            height: "52px",
            borderBottom: `1px solid ${V.border}`,
            display: "flex",
            alignItems: "center",
            padding: "0 22px",
            gap: "14px",
            background: V.surface,
            flexShrink: 0,
          }}>
            <span style={{ fontSize:"14px", fontWeight:"600", color: V.text, flex: 1 }}>
              {title || location.pathname.replace("/","").replace(/^\w/, c => c.toUpperCase())}
            </span>
            {actions && (
              <div style={{ display:"flex", alignItems:"center", gap:"8px" }}>
                {actions}
              </div>
            )}
          </div>

          {/* Page Content */}
          <div style={{ flex: 1, overflowY: "auto", padding: "22px" }}>
            {children}
          </div>

        </div>
      </div>
    </>
  );
}

export default Layout;