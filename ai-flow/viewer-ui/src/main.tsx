import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { CssBaseline, ThemeProvider, createTheme } from "@mui/material";
import App from "./App";
import { PRIMARY, DARK } from "./palette";

/**
 * EHR design language (ehr/src/theme/theme.ts + Pld/asset/css/theme.css):
 * primary #1467b7, dark navigation #222B2E, success #319436,
 * danger #E74C3C, warning #FEC341, radius 4px (6px buttons),
 * Roboto/Helvetica, 14px base, content panels #F2F2F2 on white.
 */
const theme = createTheme({
  palette: {
    mode: "light",
    primary: { main: PRIMARY, dark: "#083887", light: "#4789C8" },
    secondary: { main: "#A4A4A4" },
    success: { main: "#319436" },
    error: { main: "#E74C3C" },
    warning: { main: "#FEC341" },
    info: { main: "#3992D3" },
    background: { default: "#F2F2F2", paper: "#ffffff" },
    text: { primary: DARK },
  },
  typography: {
    fontFamily: '"Roboto", "Helvetica", "Segoe UI", sans-serif',
    fontSize: 14,
    button: { textTransform: "none", fontWeight: 700, fontSize: 14 },
  },
  shape: { borderRadius: 4 },
  components: {
    MuiButton: { styleOverrides: { root: { borderRadius: 6 } } },
    MuiChip: { styleOverrides: { root: { borderRadius: 4 } } },
    MuiPaper: { styleOverrides: { root: { backgroundImage: "none" } } },
    MuiTabs: { styleOverrides: { indicator: { backgroundColor: PRIMARY, height: 3 } } },
    MuiTab: { styleOverrides: { root: { "&.Mui-selected": { color: PRIMARY, fontWeight: 700 } } } },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <App />
    </ThemeProvider>
  </StrictMode>,
);
