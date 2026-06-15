// src/pages/Activate.jsx
// Account activation page - public route.
// Called when user clicks activation email link.
// Calls GET /auth/activate?token=xxx

import { useState, useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import API from "../api/index";


function Activate() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState("loading");
  const [message, setMessage] = useState("");

  const hasActivated = useRef(false);

useEffect(() => {
  if (hasActivated.current) return;
  hasActivated.current = true;

  const token = searchParams.get("token");
  if (!token) {
    setStatus("error");
    setMessage("Invalid activation link. No token provided.");
    return;
  }

  API.get(`/auth/activate?token=${token}`)
    .then(() => {
      setStatus("success");
      setMessage("Your account has been activated. You can now sign in.");
    })
    .catch(err => {
      const detail = err.response?.data?.detail || "";
      // If already used - user was activated on first call, treat as success
      if (detail.toLowerCase().includes("already been used") || detail.toLowerCase().includes("already used")) {
        setStatus("success");
        setMessage("Your account is active. You can sign in.");
      } else {
        setStatus("error");
        setMessage(detail || "Activation failed. The link may have expired.");
      }
    });
}, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg">
      <div className="bg-surface border border-white/7 rounded-2xl p-8 w-full max-w-sm text-center">

        {status === "loading" && (
          <>
            <div className="spinner mx-auto mb-4" style={{ width: 36, height: 36 }} />
            <p className="text-sm text-text2">Activating your account...</p>
          </>
        )}

        {status === "success" && (
          <>
            <div className="text-4xl mb-4">✅</div>
            <h2 className="text-lg font-semibold text-pos mb-2">Account Activated</h2>
            <p className="text-sm text-text2 mb-6">{message}</p>
            <button
              onClick={() => navigate("/")}
              className="w-full py-2.5 bg-accent hover:bg-accent2 text-white text-sm font-medium rounded-lg border-0 transition-colors cursor-pointer font-sans"
            >
              Sign In
            </button>
          </>
        )}

        {status === "error" && (
          <>
            <div className="text-4xl mb-4">❌</div>
            <h2 className="text-lg font-semibold text-neg mb-2">Activation Failed</h2>
            <p className="text-sm text-text2 mb-6">{message}</p>
            <button
              onClick={() => navigate("/")}
              className="w-full py-2.5 text-text2 border border-white/12 rounded-lg bg-transparent hover:bg-white/5 text-sm font-medium transition-colors cursor-pointer font-sans"
            >
              Back to Login
            </button>
          </>
        )}

      </div>
    </div>
  );
}

export default Activate;