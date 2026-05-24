// src/api/index.js
// Central Axios instance for all FastAPI calls.
// All API calls in the app import from this file.

import axios from "axios";

// Base URL points to the FastAPI backend
const API = axios.create({
    baseURL: "http://localhost:8000",
});

// Attach JWT token to every request automatically.
// Token is stored in memory via AuthContext - not localStorage.
API.interceptors.request.use((config) => {
    const token  = sessionStorage.getItem("token"); // Get token from sessionStorage
    if (token) {
        config.headers.Authorization = `Bearer ${token}`; // Attach token to Authorization header  
    }
    return config;
});  error => {
    return Promise.reject(error);
}

// Global response error handler.
// 401 means token expired or invalid - clear session.
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