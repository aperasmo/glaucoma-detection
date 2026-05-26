// src/pages/UserManagement.jsx
// User Management page - Admin only.
// Built with Tailwind CSS - learning exercise.
// Connects to GET /users/ and DELETE /users/{user_id}

import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import Layout from "../components/Layout";
import API from "../api/index";
import { useAuth } from "../context/AuthContext";

// Role badge component
function RoleBadge({ role }) {
  const styles = {
    admin:  "bg-neg/10 text-neg border border-neg/20",
    doctor: "bg-accent/10 text-accent2 border border-accent/20",
    nurse:  "bg-pos/10 text-pos border border-pos/20",
  };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium capitalize ${styles[role] || styles.nurse}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current" />
      {role}
    </span>
  );
}

// Status badge
function StatusBadge({ isActive }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${isActive ? "bg-pos/10 text-pos border border-pos/20" : "bg-text3/10 text-text3 border border-text3/20"}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current" />
      {isActive ? "Active" : "Inactive"}
    </span>
  );
}

// Avatar with initials
function Avatar({ name }) {
  const initials = name
    ? name.trim().split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2)
    : "?";
  return (
    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-accent to-accent2 flex items-center justify-center text-white text-xs font-semibold flex-shrink-0">
      {initials}
    </div>
  );
}

function UserManagement() {
  const navigate = useNavigate();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [error, setError] = useState(null);
  const { user } = useAuth();

  useEffect(() => {
    API.get("/users/")
      .then(res => { setUsers(res.data); setLoading(false); })
      .catch(() => { setError("Failed to load users."); setLoading(false); });
  }, []);

  const filtered = users.filter(u => {
    const name = (u.full_name || `${u.first_name} ${u.last_name}`).toLowerCase();
    const email = u.email?.toLowerCase();
    const q = search.toLowerCase();
    return name.includes(q) || email?.includes(q);
  });

  const totalUsers = users.length;
  const activeUsers = users.filter(u => u.is_active).length;
  const adminCount = users.filter(u => u.role === "admin").length;
  const doctorCount = users.filter(u => u.role === "doctor").length;
  const nurseCount = users.filter(u => u.role === "nurse").length;

  function formatDate(d) {
    if (!d) return "-";
    return new Date(d).toLocaleDateString("en-NZ", {
      day: "2-digit", month: "short", year: "numeric",
      timeZone: "Pacific/Auckland",
    });
  }

  // Top bar actions
  const actions = (
    <button
      onClick={() => navigate("/users/new")}
      className="flex items-center gap-1.5 px-3 py-1.5 bg-accent text-white text-sm font-medium rounded-lg hover:bg-accent2 transition-colors cursor-pointer border-0"
    >
      + New User
    </button>
  );

  return (
    <Layout title="User Management" actions={actions}>

      {/* STAT CARDS */}
      <div className="grid grid-cols-4 gap-3 mb-5">
        {[
          { label: "Total Users",   value: loading ? "-" : totalUsers,   color: "text-text1" },
          { label: "Active",        value: loading ? "-" : activeUsers,   color: "text-pos" },
          { label: "Admins",        value: loading ? "-" : adminCount,    color: "text-neg" },
          { label: "Doctors / Nurses", value: loading ? "-" : `${doctorCount} / ${nurseCount}`, color: "text-accent2" },
        ].map(card => (
          <div key={card.label} className="bg-surface border border-white/7 rounded-xl p-4">
            <div className="text-xs text-text3 uppercase tracking-wider mb-2">{card.label}</div>
            <div className={`text-2xl font-semibold font-mono ${card.color}`}>{card.value}</div>
          </div>
        ))}
      </div>

      {/* USER TABLE */}
      <div className="bg-surface border border-white/7 rounded-xl overflow-hidden">

        {/* Table header */}
        <div className="flex items-center gap-3 px-5 py-3.5 border-b border-white/7">
          <span className="text-sm font-semibold text-text1 flex-1">
            System Users
          </span>

          {/* Search */}
          <div className="flex items-center gap-2 bg-surface2 border border-white/12 rounded-lg px-3 py-1.5 w-48">
            <span className="text-text3 text-sm">🔍</span>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search users..."
              className="bg-transparent border-0 outline-none text-text1 text-xs w-full font-sans placeholder:text-text3"
            />
          </div>

          <span className="text-xs text-text3">{filtered.length} users</span>
        </div>

        {/* Table */}
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-white/7">
              {["User", "Email", "Role", "Status", "Created", "Actions"].map(h => (
                <th key={h} className="px-5 py-2.5 text-left text-xs font-semibold text-text3 uppercase tracking-wider bg-white/[0.02]">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="px-5 py-8 text-center text-text3 text-sm">
                  Loading users...
                </td>
              </tr>
            ) : error ? (
              <tr>
                <td colSpan={6} className="px-5 py-8 text-center text-neg text-sm">
                  {error}
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-5 py-8 text-center text-text3 text-sm">
                  No users found.
                </td>
              </tr>
            ) : (
              filtered.map(u => (
                <tr
                  key={u.user_id}
                  className="border-b border-white/[0.04] hover:bg-accent/[0.06] transition-colors cursor-pointer"
                  onClick={() => navigate(`/users/${u.user_id}`)}            
                >
                  {/* User */}
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2.5">
                      <Avatar name={u.full_name || `${u.first_name} ${u.last_name}`} />
                      <div>
                        <div className="text-sm font-medium text-text1">
                          {u.full_name || `${u.first_name} ${u.last_name}`}
                        </div>
                        <div className="text-xs text-text3 font-mono">
                          {u.user_code}
                        </div>
                      </div>
                    </div>
                  </td>

                  {/* Email */}
                  <td className="px-5 py-3 text-sm text-text2">
                    {u.email}
                  </td>

                  {/* Role */}
                  <td className="px-5 py-3">
                    <RoleBadge role={u.role} />
                  </td>

                  {/* Status */}
                  <td className="px-5 py-3">
                    <StatusBadge isActive={u.is_active} />
                  </td>

                  {/* Created */}
                  <td className="px-5 py-3 text-xs text-text2 font-mono">
                    {formatDate(u.created_at)}
                  </td>

                  {/* Actions */}
                  <td className="px-5 py-3">
                    <button
                      onClick={e => { e.stopPropagation(); navigate(`/users/${u.user_id}`); }}
                      className="px-3 py-1 text-xs text-text2 border border-white/12 rounded-lg hover:bg-white/5 transition-colors cursor-pointer bg-transparent font-sans"
                    >
                      View
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

export default UserManagement;