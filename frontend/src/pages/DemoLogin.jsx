// auto-login route just for the MSE907 oral demo (13-14 July 2026), lives at /yoobeemse907capstone
//
// this page itself doesn't decide who gets in - it just calls POST /auth/demo-login and lets the
// backend enforce the date window. if the window's closed it fails quietly and bounces to /login,
// same as any other failed login, so nothing here gives away that this route exists.
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

        // deliberately no error detail here - whether it's outside the demo window or
        // something else broke, it should just look like nothing happened
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
