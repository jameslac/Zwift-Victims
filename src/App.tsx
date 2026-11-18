import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import { FavoritesProvider } from './lib/FavoritesContext';
import { UnitsProvider } from './lib/UnitsContext';
import HomePage from './pages/HomePage';
import LoginPage from './pages/LoginPage';
import RaceDetailPage from './pages/RaceDetailPage';

export default function App() {
  return (
    <BrowserRouter>
      <UnitsProvider>
        <FavoritesProvider>
          <AuthProvider>
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/riders/:riderId" element={<HomePage />} />
              <Route path="/races/:eventId" element={<RaceDetailPage />} />
              <Route path="/riders/:riderId/races/:eventId" element={<RaceDetailPage />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </AuthProvider>
        </FavoritesProvider>
      </UnitsProvider>
    </BrowserRouter>
  );
}
