import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import UploadQuotaIndicator from './UploadQuotaIndicator';
import { initStarryEyeEcosystem } from './ecosystemSso';
import './styles.css';
import './PerformanceOverrides.css';

initStarryEyeEcosystem();

createRoot(document.getElementById('root')!).render(
  <React.StrictMode><><App /><UploadQuotaIndicator /></></React.StrictMode>
);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => undefined));
}
