// shared axios instance so every API call goes through the same base URL and auth handling
import axios from "axios";

// falls back to localhost when there's no env var set (local dev)
const API = axios.create({
    baseURL: import.meta.env.VITE_API_URL || "http://localhost:8000",
});

// stick the JWT on every outgoing request if we have one
API.interceptors.request.use(
  (config) => {
    const token = sessionStorage.getItem("token");
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// a 401 means the token's dead, so just boot back to login
API.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      sessionStorage.removeItem("token");
      window.location.href = "/";
    }
    return Promise.reject(error);
  }
);

export default API;