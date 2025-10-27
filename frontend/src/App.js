import { useState, useEffect } from 'react';
import '@/App.css';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { WebRTCProvider } from '@/context/WebRTCContext';
import Landing from '@/pages/Landing';
import Dashboard from '@/pages/Dashboard';
import History from '@/pages/History';
import ForgotPassword from '@/pages/ForgotPassword';
import { Toaster } from '@/components/ui/sonner';

const PrivateRoute = ({ children }) => {
  const { user } = useAuth();
  return user ? children : <Navigate to="/" />;
};

function App() {
  return (
    <div className="App">
      <AuthProvider>
        <WebRTCProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/" element={<Landing />} />
              <Route path="/forgot-password" element={<ForgotPassword />} />
              <Route
                path="/dashboard"
                element={
                  <PrivateRoute>
                    <Dashboard />
                  </PrivateRoute>
                }
              />
              <Route
                path="/history"
                element={
                  <PrivateRoute>
                    <History />
                  </PrivateRoute>
                }
              />
            </Routes>
          </BrowserRouter>
          <Toaster position="top-right" />
        </WebRTCProvider>
      </AuthProvider>
    </div>
  );
}

export default App;