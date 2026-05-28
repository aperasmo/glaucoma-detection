import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { DEFAULT_THEME_ID, THEME_STORAGE_KEY, THEMES } from "./themes";

const ThemeContext = createContext(null);

function hexToRgb(hex) {
  if (typeof hex !== "string" || !hex.startsWith("#")) return null;

  let clean = hex.slice(1);

  if (clean.length === 3) {
    clean = clean
      .split("")
      .map(ch => ch + ch)
      .join("");
  }

  if (clean.length !== 6) return null;

  const num = Number.parseInt(clean, 16);
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;

  return `${r} ${g} ${b}`;
}

function applyThemeVariables(themeId) {
  const theme = THEMES[themeId] || THEMES[DEFAULT_THEME_ID];
  const root = document.documentElement;

  Object.entries(theme.vars).forEach(([key, value]) => {
    root.style.setProperty(key, value);

    const rgb = hexToRgb(value);
    if (rgb) {
      root.style.setProperty(`${key}-rgb`, rgb);
    }
  });

  root.dataset.theme = themeId;
  root.style.colorScheme = theme.mode;
}

export function ThemeProvider({ children }) {
  const [currentTheme, setCurrentTheme] = useState(() => {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    return THEMES[saved] ? saved : DEFAULT_THEME_ID;
  });

  useEffect(() => {
    applyThemeVariables(currentTheme);
    localStorage.setItem(THEME_STORAGE_KEY, currentTheme);
  }, [currentTheme]);

  const value = useMemo(() => ({
    currentTheme,
    setTheme: id => {
      if (THEMES[id]) setCurrentTheme(id);
    },
    themes: THEMES,
  }), [currentTheme]);

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);

  if (!context) {
    throw new Error("useTheme must be used inside ThemeProvider");
  }

  return context;
}