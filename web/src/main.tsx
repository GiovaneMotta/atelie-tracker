import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import App from './App';
import './styles/theme.css';
import './styles/app.css';

/* Service Worker: é o que torna o painel instalável no celular e o que
   recebe a notificação push com o app fechado. Registrado fora do React
   e depois do load, para não disputar banda com o primeiro desenho da
   tela. Se falhar, o painel funciona exatamente igual — só não chega
   notificação. */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
  });
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
