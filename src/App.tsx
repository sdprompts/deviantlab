import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Shell } from "./components/Shell";
import { LabProvider } from "./lab";
import { AuthCallbackPage } from "./pages/AuthCallbackPage";
import { SettingsPage } from "./pages/SettingsPage";
import { StudioPage } from "./pages/StudioPage";

export function App() {
  return (
    <LabProvider>
      <BrowserRouter>
        <Routes>
          <Route path="callback" element={<AuthCallbackPage />} />
          <Route element={<Shell />}>
            <Route index element={<StudioPage />} />
            <Route path="studio" element={<Navigate to="/" replace />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </LabProvider>
  );
}
