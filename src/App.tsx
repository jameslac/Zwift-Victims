import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import { FavoritesProvider } from './lib/FavoritesContext';
import { ThemeProvider } from './lib/ThemeContext';
import { UnitsProvider } from './lib/UnitsContext';
import ActivityDetailPage from './pages/ActivityDetailPage';
import HomePage from './pages/HomePage';
import LoginPage from './pages/LoginPage';
import RaceDetailPage from './pages/RaceDetailPage';
import RaceHistoryPage from './pages/RaceHistoryPage';
import VictimsPage from './pages/VictimsPage';

export default function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <UnitsProvider>
          <FavoritesProvider>
            <AuthProvider>
              <Routes>
                <Route path="/" element={<HomePage />} />
                <Route path="/history" element={<RaceHistoryPage />} />
                <Route path="/victims" element={<VictimsPage />} />
                <Route path="/riders/:riderId" element={<HomePage />} />
                <Route path="/riders/:riderId/history" element={<RaceHistoryPage />} />
                <Route path="/races/:eventId" element={<RaceDetailPage />} />
                <Route path="/riders/:riderId/races/:eventId" element={<RaceDetailPage />} />
                <Route path="/activities/:activityId" element={<ActivityDetailPage />} />
                <Route path="/riders/:riderId/activities/:activityId" element={<ActivityDetailPage />} />
                <Route path="/login" element={<LoginPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </AuthProvider>
          </FavoritesProvider>
        </UnitsProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}
