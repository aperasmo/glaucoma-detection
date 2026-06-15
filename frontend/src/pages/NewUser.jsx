// src/pages/NewUser.jsx
// Create new user form - Tailwind CSS implementation.
// Admin only. Connects to POST /auth/register

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Layout from "../components/Layout";
import API from "../api/index";

function SectionDivider({ label }) {
  return (
    <div className="text-xs text-text3 uppercase tracking-widest mt-5 mb-3.5 pb-1.5 border-b border-white/7">
      {label}
    </div>
  );
}

function FormField({ label, children }) {
  return (
    <div>
      <label className="block text-xs font-medium text-text2 mb-1.5">{label}</label>
      {children}
    </div>
  );
}

const inputClass = "w-full bg-surface2 border border-white/12 rounded-lg px-3 py-2.5 text-sm text-text1 outline-none placeholder:text-text3 focus:border-accent transition-colors font-sans";

function NewUser() {
  const navigate = useNavigate();

  const [form, setForm] = useState({
    first_name: "",
    last_name:  "",
    email:      "",
    password:   "",
    confirm:    "",
    role:       "nurse",
  });

  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  function handleChange(e) {
    setForm({ ...form, [e.target.name]: e.target.value });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);

    if (form.password !== form.confirm) {
      setError("Passwords do not match.");
      return;
    }

    if (form.password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setLoading(true);

    try {
      await API.post("/auth/register", {
        first_name: form.first_name,
        last_name:  form.last_name,
        email:      form.email,
        password:   form.password,
        role:       form.role,
      });
      // Wait 2 seconds for backend to complete before navigating
      await new Promise(resolve => setTimeout(resolve, 4000));      
      navigate("/users", { state: { refetch: Date.now() } });
    } catch (err) {
      const detail = err.response?.data?.detail;
      setError(Array.isArray(detail) ? detail.map(d => d.msg).join(", ") : detail || "Failed to create user.");
      setLoading(false);
    }
  }

  return (
    <Layout title="New User">

      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-xs text-text3 mb-5">
        <span
          onClick={() => navigate("/users")}
          className="cursor-pointer hover:text-accent2 transition-colors"
        >
          User Management
        </span>
        <span>›</span>
        <span className="text-text2">New User</span>
      </div>

      <div className="bg-surface border border-white/7 rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-white/7">
          <span className="text-sm font-semibold text-text1">Create New User</span>
        </div>

        <div className="p-5">
          <form onSubmit={handleSubmit}>

            <SectionDivider label="Personal Information" />

            <div className="grid grid-cols-2 gap-4 mb-4">
              <FormField label="First Name *">
                <input name="first_name" value={form.first_name} onChange={handleChange}
                  placeholder="John" required className={inputClass} />
              </FormField>
              <FormField label="Last Name *">
                <input name="last_name" value={form.last_name} onChange={handleChange}
                  placeholder="Smith" required className={inputClass} />
              </FormField>
            </div>

            <div className="mb-4">
              <FormField label="Email Address *">
                <input name="email" type="email" value={form.email} onChange={handleChange}
                  placeholder="user@clinic.com" required className={inputClass} />
              </FormField>
            </div>

            <SectionDivider label="Role & Access" />

            <div className="mb-4">
              <FormField label="Role *">
                <select name="role" value={form.role} onChange={handleChange}
                  className={`${inputClass} cursor-pointer`}>
                  <option value="nurse">Nurse</option>
                  <option value="doctor">Doctor</option>
                  <option value="admin">Admin</option>
                </select>
              </FormField>
              <div className="mt-2 p-3 bg-surface2 rounded-lg border border-white/7">
                {form.role === "admin" && (
                  <p className="text-xs text-neg">
                    Admin has full access to all pages including user management and system settings.
                  </p>
                )}
                {form.role === "doctor" && (
                  <p className="text-xs text-accent2">
                    Doctor can view patient records, screening results, referral letters, and analytics.
                  </p>
                )}
                {form.role === "nurse" && (
                  <p className="text-xs text-pos">
                    Nurse can register patients, run screenings, and view basic results.
                  </p>
                )}
              </div>
            </div>

            <SectionDivider label="Password" />

            {/* <div className="grid grid-cols-2 gap-4 mb-4">
              <FormField label="Password *">
                <input name="password" type="password" value={form.password} onChange={handleChange}
                  placeholder="Min 8 characters" required className={inputClass} />
              </FormField>
              <FormField label="Confirm Password *">
                <input name="confirm" type="password" value={form.confirm} onChange={handleChange}
                  placeholder="Repeat password" required className={inputClass} />
              </FormField>
            </div> */}

            <div className="grid grid-cols-2 gap-4 mb-4">
              <FormField label="Password *">
                <div className="relative">
                  <input name="password" type={showPassword ? "text" : "password"} value={form.password} onChange={handleChange}
                    placeholder="Min 8 characters" required
                    className="w-full bg-surface2 border border-white/12 rounded-lg px-3 py-2.5 pr-10 text-sm text-text1 outline-none placeholder:text-text3 focus:border-accent transition-colors font-sans" />
                  <button type="button" onClick={() => setShowPassword(prev => !prev)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    className="absolute right-3 top-1/2 -translate-y-1/2 flex h-6 w-6 items-center justify-center text-text3 hover:text-text2 transition-colors bg-transparent border-0 cursor-pointer p-0">
                    {showPassword ? (
                      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20C7 20 2.73 16.89 1 12c.74-2.1 2.1-3.88 3.82-5.18" />
                        <path d="M9.9 4.24A10.8 10.8 0 0 1 12 4c5 0 9.27 3.11 11 8a11.8 11.8 0 0 1-2.18 3.43" />
                        <path d="M14.12 14.12A3 3 0 0 1 9.88 9.88" />
                        <path d="M1 1l22 22" />
                      </svg>
                    ) : (
                      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    )}
                  </button>
                </div>
              </FormField>
              <FormField label="Confirm Password *">
                <div className="relative">
                  <input name="confirm" type={showConfirmPassword ? "text" : "password"} value={form.confirm} onChange={handleChange}
                    placeholder="Repeat password" required
                    className="w-full bg-surface2 border border-white/12 rounded-lg px-3 py-2.5 pr-10 text-sm text-text1 outline-none placeholder:text-text3 focus:border-accent transition-colors font-sans" />
                  <button type="button" onClick={() => setShowConfirmPassword(prev => !prev)}
                    aria-label={showConfirmPassword ? "Hide password" : "Show password"}
                    className="absolute right-3 top-1/2 -translate-y-1/2 flex h-6 w-6 items-center justify-center text-text3 hover:text-text2 transition-colors bg-transparent border-0 cursor-pointer p-0">
                    {showConfirmPassword ? (
                      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20C7 20 2.73 16.89 1 12c.74-2.1 2.1-3.88 3.82-5.18" />
                        <path d="M9.9 4.24A10.8 10.8 0 0 1 12 4c5 0 9.27 3.11 11 8a11.8 11.8 0 0 1-2.18 3.43" />
                        <path d="M14.12 14.12A3 3 0 0 1 9.88 9.88" />
                        <path d="M1 1l22 22" />
                      </svg>
                    ) : (
                      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    )}
                  </button>
                </div>
              </FormField>
            </div>

            <div className="p-3 bg-surface2 rounded-lg border border-white/7 mb-4">
              <p className="text-xs text-text3 leading-relaxed">
                An activation email will be sent to the user. They must activate their account before logging in.
              </p>
            </div>

            {/* Error */}
            {error && (
              <div className="px-3 py-2.5 bg-neg/10 border border-neg/20 rounded-lg text-xs text-neg mb-4">
                {error}
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-2.5 justify-end mt-5 pt-4 border-t border-white/7">
              <button
                type="button"
                onClick={() => navigate("/users")}
                className="px-4 py-2 text-xs font-medium text-text2 border border-white/12 rounded-lg bg-transparent hover:bg-white/5 transition-colors cursor-pointer font-sans"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="px-4 py-2 text-xs font-medium text-white bg-accent hover:bg-accent2 disabled:bg-surface3 disabled:cursor-not-allowed rounded-lg border-0 transition-colors cursor-pointer font-sans"
              >
                {loading ? "Creating..." : "Create User"}
              </button>
            </div>

          </form>
        </div>
      </div>

    </Layout>
  );
}

export default NewUser;