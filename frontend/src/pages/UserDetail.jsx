// src/pages/UserDetail.jsx
// Admin view of another user's profile.
// Read-only. Shows user info with deactivate/reactivate option.
// Connects to GET /users/:userId and DELETE /users/:userId

import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Layout from "../components/Layout";
import API from "../api/index";

function RoleBadge({ role }) {
  const styles = {
    admin:  "bg-neg/10 text-neg border-neg/20",
    doctor: "bg-accent/10 text-accent2 border-accent/20",
    nurse:  "bg-pos/10 text-pos border-pos/20",
  };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border capitalize ${styles[role] || styles.nurse}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current" />
      {role}
    </span>
  );
}

function UserDetail() {
  const { userId } = useParams();
  const navigate = useNavigate();

  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [deactivating, setDeactivating] = useState(false);
  const [actionError, setActionError] = useState(null);

 
  const [showResetModal, setShowResetModal] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [resetLoading, setResetLoading] = useState(false);
  const [resetError, setResetError] = useState(null);
  const [resetSuccess, setResetSuccess] = useState(false);

  useEffect(() => {
    API.get(`/users/${userId}`)
      .then(res => { setUser(res.data); setLoading(false); })
      .catch(() => { setError("Failed to load user."); setLoading(false); });
  }, [userId]);

  function formatDate(d) {
    if (!d) return "-";
    return new Date(d).toLocaleDateString("en-NZ", {
      day: "2-digit", month: "short", year: "numeric",
      timeZone: "Pacific/Auckland",
    });
  }

  function getInitials() {
    if (!user) return "?";
    const name = user.full_name || `${user.first_name || ""} ${user.last_name || ""}`;
    return name.trim().split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);
  }

  async function handleDeactivate() {
    if (!window.confirm(`Deactivate ${user.full_name || user.first_name}? They will no longer be able to log in.`)) return;
    setDeactivating(true);
    setActionError(null);
    try {
      await API.delete(`/users/${userId}`);
      navigate("/users");
    } catch (err) {
      setActionError(err.response?.data?.detail || "Failed to deactivate user.");
      setDeactivating(false);
    }
  }

async function handleReactivate() {
  if (!window.confirm(`Reactivate ${user.full_name || user.first_name}? They will be able to log in again.`)) return;
  setDeactivating(true);
  setActionError(null);
  try {
    const res = await API.put(`/users/${userId}/activate`);
    setUser(res.data);
    setDeactivating(false);
  } catch (err) {
    setActionError(err.response?.data?.detail || "Failed to reactivate user.");
    setDeactivating(false);
  }
}

async function handleResetPassword(e) {
  e.preventDefault();
  setResetError(null);

  // Client-side validation
  if (newPassword.length < 8) {
    setResetError("Minimum 8 characters required.");
    return;
  }
  if (!/[A-Z]/.test(newPassword)) {
    setResetError("Must contain at least one uppercase letter.");
    return;
  }
  if (!/[0-9]/.test(newPassword)) {
    setResetError("Must contain at least one number.");
    return;
  }
  if (!/[!@#$%^&*()]/.test(newPassword)) {
    setResetError("Must contain at least one special character (!@#$%^&*()).");
    return;
  }

  setResetLoading(true);
  try {
    await API.put(`/users/${userId}/reset-password`, { new_password: newPassword });
    setResetSuccess(true);
    setNewPassword("");
    setTimeout(() => {
      setShowResetModal(false);
      setResetSuccess(false);
    }, 2000);
  } catch (err) {
    setResetError(err.response?.data?.detail || "Failed to reset password.");
  } finally {
    setResetLoading(false);
  }
}

  if (loading) return (
    <Layout title="User Detail">
      <p className="text-text3 text-sm">Loading user...</p>
    </Layout>
  );

  if (error) return (
    <Layout title="User Detail">
      <p className="text-neg text-sm">{error}</p>
    </Layout>
  );

  const fullName = user?.full_name || `${user?.first_name} ${user?.last_name}`;

  return (
    <Layout title="User Detail">

      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-xs text-text3 mb-5">
        <span onClick={() => navigate("/users")}
          className="cursor-pointer hover:text-accent2 transition-colors">
          User Management
        </span>
        <span>›</span>
        <span className="text-text2">{fullName}</span>
      </div>

      <div className="grid gap-4" style={{ gridTemplateColumns: "260px 1fr" }}>

        {/* LEFT - Avatar Card */}
        <div className="bg-surface border border-white/7 rounded-xl overflow-hidden h-fit">
          <div className="text-center p-6 border-b border-white/7">
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-accent to-accent2 flex items-center justify-center text-xl font-bold text-white mx-auto mb-3">
              {getInitials()}
            </div>
            <div className="text-base font-semibold text-text1 mb-1">{fullName}</div>
            <div className="text-xs text-text3 font-mono mb-3">{user?.user_code}</div>
            <RoleBadge role={user?.role} />
          </div>

          <div className="p-4">
            <div className="mb-3">
              <div className="text-xs text-text3 mb-1">Status</div>
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${
                user?.is_active
                  ? "bg-pos/10 text-pos border-pos/20"
                  : "bg-neg/10 text-neg border-neg/20"
              }`}>
                <span className="w-1.5 h-1.5 rounded-full bg-current" />
                {user?.is_active ? "Active" : "Inactive"}
              </span>
            </div>
            <div className="mb-3">
              <div className="text-xs text-text3 mb-1">Email</div>
              <div className="text-xs text-text1 break-all">{user?.email || "-"}</div>
            </div>
            <div>
              <div className="text-xs text-text3 mb-1">Created</div>
              <div className="text-xs text-text1">{formatDate(user?.created_at)}</div>
            </div>
          </div>
        </div>

        {/* RIGHT */}
        <div className="flex flex-col gap-4">

          {/* Account Info */}
          <div className="bg-surface border border-white/7 rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-white/7">
              <span className="text-sm font-semibold text-text1">Account Information</span>
            </div>
            <div className="p-5">
              {[
                { label: "Full Name",  value: fullName },
                { label: "Email",      value: user?.email },
                { label: "Role",       value: user?.role },
                { label: "User Code",  value: user?.user_code },
                { label: "Status",     value: user?.is_active ? "Active" : "Inactive" },
                { label: "Created",    value: formatDate(user?.created_at) },
              ].map(row => (
                <div key={row.label} className="flex justify-between text-sm mb-3 pb-3 border-b border-white/7 last:border-0 last:mb-0 last:pb-0">
                  <span className="text-text3">{row.label}</span>
                  <span className="text-text1 capitalize">{row.value || "-"}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Admin Actions */}
          <div className="bg-surface border border-white/7 rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-white/7">
              <span className="text-sm font-semibold text-text1">Admin Actions</span>
            </div>
            <div className="p-5 flex flex-col gap-3">

              {actionError && (
                <div className="px-3 py-2.5 bg-neg/10 border border-neg/20 rounded-lg text-xs text-neg">
                  {actionError}
                </div>
              )}

              {user?.is_active ? (
                <button
                  onClick={handleDeactivate}
                  disabled={deactivating}
                  className="w-full py-2.5 text-xs font-medium text-neg border border-neg/20 bg-neg/5 hover:bg-neg/10 rounded-lg transition-colors cursor-pointer font-sans disabled:opacity-50"
                >
                  {deactivating ? "Deactivating..." : "⛔ Deactivate User"}
                </button>
                ) : (
                <button
                    onClick={handleReactivate}
                    disabled={deactivating}
                    className="w-full py-2.5 text-xs font-medium text-pos border border-pos/20 bg-pos/5 hover:bg-pos/10 rounded-lg transition-colors cursor-pointer font-sans disabled:opacity-50"
                >
                    {deactivating ? "Reactivating..." : "✅ Reactivate User"}
                </button>
                )}
                <button
                onClick={() => { setShowResetModal(true); setResetError(null); setNewPassword(""); }}
                className="w-full py-2.5 text-xs font-medium text-warn border border-warn/20 bg-warn/5 hover:bg-warn/10 rounded-lg transition-colors cursor-pointer font-sans"
                >
                🔑 Reset Password
                </button>
              <button
                onClick={() => navigate("/users")}
                className="w-full py-2.5 text-xs font-medium text-text2 border border-white/12 rounded-lg bg-transparent hover:bg-white/5 transition-colors cursor-pointer font-sans"
              >
                ← Back to User Management
              </button>

            </div>
          </div>

        </div>
      </div>

        {/* Reset Password Modal */}
        {showResetModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="bg-surface border border-white/12 rounded-xl w-full max-w-sm mx-4 overflow-hidden">
            <div className="px-5 py-4 border-b border-white/7 flex items-center gap-3">
                <span className="text-sm font-semibold text-text1 flex-1">Reset Password</span>
                <button
                onClick={() => setShowResetModal(false)}
                className="text-text3 hover:text-text2 bg-transparent border-0 cursor-pointer text-lg"
                >
                ✕
                </button>
            </div>
            <form onSubmit={handleResetPassword} className="p-5">
                <p className="text-xs text-text3 mb-4 leading-relaxed">
                Reset password for <span className="text-text1 font-medium">{fullName}</span>.
                They will need to use this new password on their next login.
                </p>

                <div className="mb-4">
                <label className="block text-xs font-medium text-text2 mb-1.5">
                    New Password
                </label>
                <input
                    type="password"
                    value={newPassword}
                    onChange={e => setNewPassword(e.target.value)}
                    placeholder="Min 8 chars, uppercase, number, special"
                    required
                    className="w-full bg-surface2 border border-white/12 rounded-lg px-3 py-2.5 text-sm text-text1 outline-none placeholder:text-text3 focus:border-accent transition-colors font-sans"
                />
                </div>

                {/* Password rules */}
                <div className="mb-4 p-3 bg-surface2 rounded-lg border border-white/7">
                {[
                    { rule: newPassword.length >= 8,          label: "At least 8 characters" },
                    { rule: /[A-Z]/.test(newPassword),         label: "One uppercase letter" },
                    { rule: /[0-9]/.test(newPassword),         label: "One number" },
                    { rule: /[!@#$%^&*()]/.test(newPassword),  label: "One special character (!@#$%^&*())" },
                ].map(r => (
                    <div key={r.label} className="flex items-center gap-2 mb-1 last:mb-0">
                    <span className={`text-xs ${r.rule ? "text-pos" : "text-text3"}`}>
                        {r.rule ? "✓" : "○"}
                    </span>
                    <span className={`text-xs ${r.rule ? "text-pos" : "text-text3"}`}>
                        {r.label}
                    </span>
                    </div>
                ))}
                </div>

                {resetError && (
                <div className="px-3 py-2.5 bg-neg/10 border border-neg/20 rounded-lg text-xs text-neg mb-4">
                    {resetError}
                </div>
                )}

                {resetSuccess && (
                <div className="px-3 py-2.5 bg-pos/10 border border-pos/20 rounded-lg text-xs text-pos mb-4">
                    ✓ Password reset successfully.
                </div>
                )}

                <div className="flex gap-2.5 justify-end pt-4 border-t border-white/7">
                <button
                    type="button"
                    onClick={() => setShowResetModal(false)}
                    className="px-4 py-2 text-xs font-medium text-text2 border border-white/12 rounded-lg bg-transparent hover:bg-white/5 transition-colors cursor-pointer font-sans"
                >
                    Cancel
                </button>
                <button
                    type="submit"
                    disabled={resetLoading}
                    className="px-4 py-2 text-xs font-medium text-white bg-accent hover:bg-accent2 disabled:bg-surface3 disabled:cursor-not-allowed rounded-lg border-0 transition-colors cursor-pointer font-sans"
                >
                    {resetLoading ? "Resetting..." : "Reset Password"}
                </button>
                </div>
            </form>
            </div>
        </div>
        )}


    </Layout>
  );
}

export default UserDetail;