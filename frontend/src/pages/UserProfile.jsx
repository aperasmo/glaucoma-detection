// src/pages/UserProfile.jsx
// User profile page - Tailwind CSS implementation.
// View and edit own profile. Connects to GET /users/me and PUT /users/me.

import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import Layout from "../components/Layout";
import API from "../api/index";

const inputClass = "w-full bg-surface2 border border-white/12 rounded-lg px-3 py-2.5 text-sm text-text1 outline-none placeholder:text-text3 focus:border-accent transition-colors font-sans";

function FormField({ label, children }) {
  return (
    <div>
      <label className="block text-xs font-medium text-text2 mb-1.5">{label}</label>
      {children}
    </div>
  );
}

function SectionDivider({ label }) {
  return (
    <div className="text-xs text-text3 uppercase tracking-widest mt-5 mb-3.5 pb-1.5 border-b border-white/7">
      {label}
    </div>
  );
}

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

function UserProfile() {
  const { user, login, token } = useAuth();
  const navigate = useNavigate();

  const [profile, setProfile] = useState(null);
  const [form, setForm] = useState({
    first_name: "",
    last_name:  "",
    email:      "",
  });
  const [passwords, setPasswords] = useState({
    current:  "",
    new:      "",
    confirm:  "",
  });

  const [loading, setLoading]         = useState(true);
  const [saving, setSaving]           = useState(false);
  const [savingPwd, setSavingPwd]     = useState(false);
  const [error, setError]             = useState(null);
  const [errorPwd, setErrorPwd]       = useState(null);
  const [success, setSuccess]         = useState(false);
  const [successPwd, setSuccessPwd]   = useState(false);
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew]         = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  useEffect(() => {
    API.get("/users/me")
      .then(res => {
        setProfile(res.data);
        setForm({
          first_name: res.data.first_name || "",
          last_name:  res.data.last_name  || "",
          email:      res.data.email      || "",
        });
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  function handleChange(e) {
    setForm({ ...form, [e.target.name]: e.target.value });
  }

  function handlePwdChange(e) {
    setPasswords({ ...passwords, [e.target.name]: e.target.value });
  }

  async function handleSaveProfile(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(false);

    try {
      const res = await API.put("/users/me", {
        first_name: form.first_name,
        last_name:  form.last_name,
        email:      form.email,
      });
      setProfile(res.data);
      // Update auth context with new user data
      login(token, res.data);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      const detail = err.response?.data?.detail;
      setError(Array.isArray(detail) ? detail.map(d => d.msg).join(", ") : detail || "Failed to update profile.");
    } finally {
      setSaving(false);
    }
  }

  async function handleSavePassword(e) {
    e.preventDefault();
    setErrorPwd(null);
    setSuccessPwd(false);

    if (passwords.new !== passwords.confirm) {
      setErrorPwd("New passwords do not match.");
      return;
    }
    if (passwords.new.length < 8) {
      setErrorPwd("Password must be at least 8 characters.");
      return;
    }

    setSavingPwd(true);
    try {
      await API.put("/users/me", { password: passwords.new });
      setPasswords({ current: "", new: "", confirm: "" });
      setSuccessPwd(true);
      setTimeout(() => setSuccessPwd(false), 3000);
    } catch (err) {
      const detail = err.response?.data?.detail;
      setErrorPwd(Array.isArray(detail) ? detail.map(d => d.msg).join(", ") : detail || "Failed to update password.");
    } finally {
      setSavingPwd(false);
    }
  }

  function getInitials() {
    if (!profile) return "?";
    const name = profile.full_name || `${profile.first_name || ""} ${profile.last_name || ""}`;
    return name.trim().split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);
  }

  if (loading) return (
    <Layout title="My Profile">
      <p className="text-text3 text-sm">Loading profile...</p>
    </Layout>
  );

  return (
    <Layout title="My Profile">

      <div className="grid gap-4" style={{ gridTemplateColumns: "280px 1fr" }}>

        {/* LEFT - Profile Card */}
        <div className="bg-surface border border-white/7 rounded-xl overflow-hidden h-fit">
        
        {/* Avatar section */}
        <div className="text-center p-6">
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-accent to-accent2 flex items-center justify-center text-xl font-bold text-white mx-auto mb-3">
            {getInitials()}
            </div>
            <div className="text-base font-semibold text-text1 mb-1">
            {profile?.full_name || `${profile?.first_name} ${profile?.last_name}`}
            </div>
            <div className="text-xs text-text3 font-mono mb-3">
            {profile?.user_code}
            </div>
            <RoleBadge role={profile?.role} />
        </div>

        {/* Info rows */}
        <div className="px-4 pb-4 border-t border-white/7 pt-4">
            <div className="mb-3">
            <div className="text-xs text-text3 mb-1">Email</div>
            <div className="text-xs text-text1 break-all">{profile?.email || "-"}</div>
            </div>
            <div>
            <div className="text-xs text-text3 mb-1">Status</div>
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${profile?.is_active ? "bg-pos/10 text-pos border-pos/20" : "bg-neg/10 text-neg border-neg/20"}`}>
                <span className="w-1.5 h-1.5 rounded-full bg-current" />
                {profile?.is_active ? "Active" : "Inactive"}
            </span>
            </div>
        </div>
        </div>

        {/* RIGHT - Edit Forms */}
        <div className="flex flex-col gap-4">

          {/* Edit Profile */}
          <div className="bg-surface border border-white/7 rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-white/7">
              <span className="text-sm font-semibold text-text1">Personal Information</span>
            </div>
            <div className="p-5">
              <form onSubmit={handleSaveProfile}>

                <div className="grid grid-cols-2 gap-4 mb-4">
                  <FormField label="First Name">
                    <input name="first_name" value={form.first_name}
                      onChange={handleChange} required className={inputClass} />
                  </FormField>
                  <FormField label="Last Name">
                    <input name="last_name" value={form.last_name}
                      onChange={handleChange} required className={inputClass} />
                  </FormField>
                </div>

                <div className="mb-4">
                  <FormField label="Email Address">
                    <input name="email" type="email" value={form.email}
                      onChange={handleChange} required className={inputClass} />
                  </FormField>
                </div>

                {error && (
                  <div className="px-3 py-2.5 bg-neg/10 border border-neg/20 rounded-lg text-xs text-neg mb-4">
                    {error}
                  </div>
                )}
                {success && (
                  <div className="px-3 py-2.5 bg-pos/10 border border-pos/20 rounded-lg text-xs text-pos mb-4">
                    ✓ Profile updated successfully.
                  </div>
                )}

                <div className="flex justify-end pt-4 border-t border-white/7">
                  <button
                    type="submit"
                    disabled={saving}
                    className="px-4 py-2 text-xs font-medium text-white bg-accent hover:bg-accent2 disabled:bg-surface3 disabled:cursor-not-allowed rounded-lg border-0 transition-colors cursor-pointer font-sans"
                  >
                    {saving ? "Saving..." : "Save Changes"}
                  </button>
                </div>
              </form>
            </div>
          </div>

          {/* Change Password */}
          <div className="bg-surface border border-white/7 rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-white/7">
              <span className="text-sm font-semibold text-text1">Change Password</span>
            </div>
            <div className="p-5">
              <form onSubmit={handleSavePassword}>

                <div className="mb-4">
                  <FormField label="New Password">
                    <div className="relative">
                      <input
                        name="new"
                        type={showNew ? "text" : "password"}
                        value={passwords.new}
                        onChange={handlePwdChange}
                        placeholder="Min 8 characters"
                        required
                        className={`${inputClass} pr-10`}
                      />
                      <button
                        type="button"
                        onClick={() => setShowNew(!showNew)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-text3 hover:text-text2 bg-transparent border-0 cursor-pointer p-0"
                      >
                        {showNew ? "🙈" : "👁"}
                      </button>
                    </div>
                  </FormField>
                </div>

                <div className="mb-4">
                <FormField label="Confirm New Password">
                    <div className="relative">
                    <input
                        name="confirm"
                        type={showConfirm ? "text" : "password"}
                        value={passwords.confirm}
                        onChange={handlePwdChange}
                        placeholder="Repeat new password"
                        required
                        className={`${inputClass} pr-10`}
                    />
                    <button
                        type="button"
                        onClick={() => setShowConfirm(!showConfirm)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-text3 hover:text-text2 bg-transparent border-0 cursor-pointer p-0"
                    >
                        {showConfirm ? "🙈" : "👁"}
                    </button>
                    </div>
                </FormField>
                </div>

                {errorPwd && (
                  <div className="px-3 py-2.5 bg-neg/10 border border-neg/20 rounded-lg text-xs text-neg mb-4">
                    {errorPwd}
                  </div>
                )}
                {successPwd && (
                  <div className="px-3 py-2.5 bg-pos/10 border border-pos/20 rounded-lg text-xs text-pos mb-4">
                    ✓ Password updated successfully.
                  </div>
                )}

                <div className="flex justify-end pt-4 border-t border-white/7">
                  <button
                    type="submit"
                    disabled={savingPwd}
                    className="px-4 py-2 text-xs font-medium text-white bg-accent hover:bg-accent2 disabled:bg-surface3 disabled:cursor-not-allowed rounded-lg border-0 transition-colors cursor-pointer font-sans"
                  >
                    {savingPwd ? "Updating..." : "Update Password"}
                  </button>
                </div>
              </form>
            </div>
          </div>

        </div>
      </div>

    </Layout>
  );
}

export default UserProfile;