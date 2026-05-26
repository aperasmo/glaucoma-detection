// src/pages/Login.jsx
// Login page - Tailwind CSS implementation.
// Connects to POST /auth/login via OAuth2 form data.

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import API from "../api/index";

function Login() {
  const navigate = useNavigate();
  const { login } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const formData = new URLSearchParams();
      formData.append("username", email);
      formData.append("password", password);

      const res = await API.post("/auth/login", formData);
      const accessToken = res.data.access_token;

      const userRes = await API.get("/auth/me", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      login(accessToken, userRes.data);
      navigate("/dashboard");
    } catch {
      setError("Invalid email or password. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg">
      <div className="w-full max-w-sm">

        {/* Logo */}
        <div className="flex items-center gap-3 mb-8 justify-center">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-accent to-accent2 flex items-center justify-center text-lg">
            👁
          </div>
          <span className="font-serif text-xl text-text1">GlaucomaAI Screening System</span>
        </div>

        {/* Card */}
        <div className="bg-surface border border-white/7 rounded-2xl p-8">
          <h1 className="text-lg font-semibold text-text1 mb-1">
            Sign in to your account
          </h1>
          <p className="text-xs text-text3 mb-7">
            Clinical Screening System — authorised personnel only
          </p>

          <form onSubmit={handleSubmit}>

            {/* Email */}
            <div className="mb-4">
              <label className="block text-xs font-medium text-text2 mb-1.5">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                placeholder="you@clinic.com"
                className="w-full bg-surface2 border border-white/12 rounded-lg px-3 py-2.5 text-sm text-text1 outline-none placeholder:text-text3 focus:border-accent transition-colors"
              />
            </div>

            {/* Password */}
            <div className="mb-6">
              <label className="block text-xs font-medium text-text2 mb-1.5">
                Password
              </label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  placeholder="••••••••"
                  className="w-full bg-surface2 border border-white/12 rounded-lg px-3 py-2.5 pr-10 text-sm text-text1 outline-none placeholder:text-text3 focus:border-accent transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-text3 hover:text-text2 transition-colors bg-transparent border-0 cursor-pointer p-0"
                >
                  {showPassword ? "🙈" : "👁"}
                </button>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="mb-4 px-3 py-2.5 bg-neg/10 border border-neg/20 rounded-lg text-xs text-neg">
                {error}
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-accent hover:bg-accent2 disabled:bg-surface3 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors border-0 cursor-pointer font-sans"
            >
              {loading ? "Signing in..." : "Sign In"}
            </button>

          </form>

          <p className="text-xs text-text3 text-center mt-6">
            Clinical use only. Unauthorised access is prohibited.
          </p>
        </div>
      </div>
    </div>
  );
}

export default Login;