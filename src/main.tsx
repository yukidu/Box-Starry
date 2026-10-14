import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import HardenedSharePage from './HardenedSharePage';
import './styles.css';

const shareRoute=location.pathname.match(/^\/s\/([A-Za-z0-9_-]+)$/);
const root=shareRoute?<HardenedSharePage token={shareRoute[1]}/>:<App/>;

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{root}</React.StrictMode>
);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => undefined));
}
