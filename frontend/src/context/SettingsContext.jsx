// src/context/SettingsContext.jsx
// Global settings store.
// Loads system settings once when the app starts.
// Any page/component can call useSettings() to read settings without repeated API calls.

import { createContext, useContext, useEffect, useState } from "react";
import API from "../api/index";

const SettingsContext = createContext(null);

export function SettingsProvider({ children }) {
  const [settings, setSettings] = useState({});
  const [loaded, setLoaded] = useState(false);

  async function loadSettings() {
    try {
      const response = await API.get("/settings/");

      const settingsMap = {};

      response.data.forEach((setting) => {
        settingsMap[setting.set_code] = setting.set_value;
      });

      setSettings(settingsMap);
    } catch (error) {
      console.error("Failed to load system settings:", error);
    } finally {
      setLoaded(true);
    }
  }

  useEffect(() => {
    loadSettings();
  }, []);

  function getSetting(key, defaultValue = null) {
    return settings[key] ?? defaultValue;
  }

  async function refreshSettings() {
    await loadSettings();
  }

  return (
    <SettingsContext.Provider
      value={{
        settings,
        loaded,
        getSetting,
        refreshSettings,
      }}
    >
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const context = useContext(SettingsContext);

  if (!context) {
    throw new Error("useSettings must be used inside SettingsProvider");
  }

  return context;
}