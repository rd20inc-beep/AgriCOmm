import { createContext, useContext, useState, useCallback } from 'react';

const ToastContext = createContext();

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const [alerts, setAlerts] = useState([]);

  const addToast = useCallback((message, type = 'success') => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
  }, []);

  const dismissAlert = useCallback((alertId) => {
    setAlerts(prev => prev.filter(a => a.id !== alertId));
  }, []);

  const addAlert = useCallback((alert) => {
    setAlerts(prev => [{ id: Date.now(), date: new Date().toISOString().split('T')[0], ...alert }, ...prev]);
  }, []);

  return (
    <ToastContext.Provider value={{ toasts, addToast, alerts, setAlerts, dismissAlert, addAlert }}>
      {children}
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
