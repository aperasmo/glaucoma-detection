// src/pages/Login.jsx
// Login page - connects to POST /auth/login
// FastAPI expects OAuth2 form data: username (email) + password

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
      const userData = res.data.user;

      login(accessToken, userData);
      navigate("/dashboard");
    } catch (err) {
      setError("Invalid email or password. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "#0f1117",
    }}>
      <div style={{
        background: "#1a1d27",
        border: "1px solid #2a2d3a",
        borderRadius: "12px",
        padding: "40px",
        width: "100%",
        maxWidth: "400px",
      }}>
        <h1 style={{
          color: "#ffffff",
          fontSize: "20px",
          fontWeight: "600",
          marginBottom: "4px",
        }}>
          Glaucoma Detection System
        </h1>
        <p style={{
          color: "#6b7280",
          fontSize: "13px",
          marginBottom: "32px",
        }}>
          Sign in to your account
        </p>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: "16px" }}>
            <label style={{
              display: "block",
              color: "#9ca3af",
              fontSize: "13px",
              marginBottom: "6px",
            }}>
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              style={{
                width: "100%",
                padding: "10px 12px",
                background: "#0f1117",
                border: "1px solid #2a2d3a",
                borderRadius: "8px",
                color: "#ffffff",
                fontSize: "14px",
                boxSizing: "border-box",
              }}
            />
          </div>

          <div style={{ marginBottom: "24px" }}>
            <label style={{
              display: "block",
              color: "#9ca3af",
              fontSize: "13px",
              marginBottom: "6px",
            }}>
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              style={{
                width: "100%",
                padding: "10px 12px",
                background: "#0f1117",
                border: "1px solid #2a2d3a",
                borderRadius: "8px",
                color: "#ffffff",
                fontSize: "14px",
                boxSizing: "border-box",
              }}
            />
          </div>

          {error && (
            <p style={{
              color: "#ef4444",
              fontSize: "13px",
              marginBottom: "16px",
            }}>
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: "100%",
              padding: "11px",
              background: loading ? "#374151" : "#3b82f6",
              color: "#ffffff",
              border: "none",
              borderRadius: "8px",
              fontSize: "14px",
              fontWeight: "500",
              cursor: loading ? "not-allowed" : "pointer",
            }}
          >
            {loading ? "Signing in..." : "Sign In"}
          </button>
        </form>

        <p style={{
          color: "#4b5563",
          fontSize: "11px",
          textAlign: "center",
          marginTop: "24px",
        }}>
          Clinical use only. Authorised personnel only.
        </p>
      </div>
    </div>
  );
}

export default Login;