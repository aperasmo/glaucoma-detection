// src/context/AuthContext.jsx
import { createContext, useContext, useState, useEffect } from "react";
import API from "../api/index";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(
    sessionStorage.getItem("token") || null
  );
  const [loading, setLoading] = useState(true);

  // Restore user from token on page refresh
  useEffect(() => {
    const saved = sessionStorage.getItem("token");
    if (saved) {
      API.get("/auth/me", {
        headers: { Authorization: `Bearer ${saved}` },
      })
        .then(res => {
          setUser(res.data);
          setLoading(false);
        })
        .catch(() => {
          sessionStorage.removeItem("token");
          setToken(null);
          setLoading(false);
        });
    } else {
      setLoading(false);
    }
  }, []);

  function login(accessToken, userData) {
    sessionStorage.setItem("token", accessToken);
    setToken(accessToken);
    setUser(userData);
  }

  function logout() {
    sessionStorage.removeItem("token");
    setToken(null);
    setUser(null);
  }

  // Do not render anything until user is restored
  if (loading) return null;

  return (
    <AuthContext.Provider value={{ user, token, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}