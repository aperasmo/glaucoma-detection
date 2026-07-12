// src/pages/DemoLogin.jsx
// Presentation-only auto-login route for the MSE907 oral (13-14 July 2026).
// Path: /yoobeemse907capstone
//
// This page does NOT decide who gets in. It calls POST /auth/demo-login,
// and the backend is what enforces the date window and issues (or refuses)
// a real token. If the window has closed, this behaves exactly like a
// failed login, then quietly falls back to the normal /login screen.
// There is no special messaging here that would reveal this route exists.

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import API from "../api/index";

function DemoLogin() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [status, setStatus] = useState("checking"); // checking | failed

  useEffect(() => {
    let cancelled = false;

    async function attemptDemoLogin() {
      try {
        const res = await API.post("/auth/demo-login");
        const accessToken = res.data.access_token;

        const userRes = await API.get("/auth/me", {
          headers: { Authorization: `Bearer ${accessToken}` },
        });

        if (cancelled) return;

        login(accessToken, userRes.data);
        navigate("/dashboard", { replace: true });
      } catch (err) {
        if (cancelled) return;

        setStatus("failed");

        // No error detail shown. Outside the demo window, or on any
        // other failure, this route should look like nothing happened.
        setTimeout(() => {
          if (!cancelled) navigate("/login", { replace: true });
        }, 800);
      }
    }

    attemptDemoLogin();

    return () => {
      cancelled = true;
    };
  }, [login, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg">
      <p className="text-sm text-text3">
        {status === "checking" ? "Signing in..." : "Redirecting..."}
      </p>
    </div>
  );
}

export default DemoLogin;
