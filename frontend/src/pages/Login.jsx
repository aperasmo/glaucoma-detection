// logs in via POST /auth/login (OAuth2 form data, not JSON)
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import API from "../api/index";
import { useTheme } from "../theme/ThemeProvider";

function Login() {
  const navigate = useNavigate();
  const { login } = useAuth();

  const [email, setEmail] = useState("aiglaucomascreeningsystem@gmail.com");
  const [password, setPassword] = useState("TestAI@1234");
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [pitchMode, setPitchMode] = useState(false);
  const { currentTheme, themes } = useTheme();
  const isDarkTheme = themes[currentTheme]?.mode === "dark";
  const logoSrc = isDarkTheme
  ? "/assets/glaucoma-ai-logo-dark.png"
  : "/assets/glaucoma-ai-logo-light.png";

  const [attemptsRemaining, setAttemptsRemaining] = useState(null);
  const [isLocked, setIsLocked] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setAttemptsRemaining(null);
    setIsLocked(false);

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
      navigate(pitchMode ? "/pitch" : "/dashboard");
      } catch (err) {
        const errorData = err.response?.data?.detail;

        let errorMessage = "Login failed. Please try again.";
        let errorCode = null;
        let remaining = null;

        if (typeof errorData === "string") {
          errorMessage = errorData;
        } else if (typeof errorData === "object" && errorData !== null) {
          errorMessage = errorData.detail || errorMessage;
          errorCode = errorData.error_code || null;
          remaining = errorData.attempts_remaining ?? null;
        }

        setError(errorMessage);
        setAttemptsRemaining(remaining);
        setIsLocked(errorCode === "ACCOUNT_LOCKED");
      } finally {
        setLoading(false);
      }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg">
      <div className="w-full max-w-sm">

        {/* Logo */}
        <div className="flex flex-col items-center text-center mb-8">
          <img
            src={logoSrc}
            alt="Glaucoma AI"
            className="h-16 w-auto max-w-[460px] object-contain mb-4"
          />
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
                  onClick={() => setShowPassword(prev => !prev)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  title={showPassword ? "Hide password" : "Show password"}
                  className="absolute right-3 top-1/2 -translate-y-1/2 flex h-6 w-6 items-center justify-center text-text3 hover:text-text2 transition-colors bg-transparent border-0 cursor-pointer p-0"
                >
                  {showPassword ? (
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20C7 20 2.73 16.89 1 12c.74-2.1 2.1-3.88 3.82-5.18" />
                      <path d="M9.9 4.24A10.8 10.8 0 0 1 12 4c5 0 9.27 3.11 11 8a11.8 11.8 0 0 1-2.18 3.43" />
                      <path d="M14.12 14.12A3 3 0 0 1 9.88 9.88" />
                      <path d="M1 1l22 22" />
                    </svg>
                  ) : (
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className={`mb-4 px-3 py-2.5 rounded-lg text-xs ${
                isLocked
                  ? "bg-neg/10 border border-neg/30 text-neg"
                  : "bg-neg/10 border border-neg/20 text-neg"
              }`}>
                <div>{error}</div>
                {attemptsRemaining !== null && (
                  <div className="mt-1 text-warn">
                    {attemptsRemaining} attempt{attemptsRemaining === 1 ? "" : "s"} remaining before account lockout.
                  </div>
                )}
                {isLocked && (
                  <div className="mt-1.5 text-text2">
                    Please contact your system administrator to reactivate your account.
                  </div>
                )}
              </div>
            )}
            
            {/* Pitch mode toggle
            <div className="flex items-center gap-2 mb-5">
              <input
                type="checkbox"
                id="pitchMode"
                checked={pitchMode}
                onChange={e => setPitchMode(e.target.checked)}
                className="w-3.5 h-3.5 accent-[var(--accent)] cursor-pointer"
              />
              <label
                htmlFor="pitchMode"
                className="text-xs text-text3 cursor-pointer select-none"
              >
                Enter pitch mode after sign in
              </label>
            </div> */}

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