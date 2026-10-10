import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { CloudProvider } from './cloud/CloudProvider';
import { StoreProvider } from './store';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <StoreProvider>
        <CloudProvider>
          <App />
        </CloudProvider>
      </StoreProvider>
    </ErrorBoundary>
  </StrictMode>,
);

// Offline support and installing to the home screen only work when the page is served over http(s), not opened as a file.
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => void navigator.serviceWorker.register('./sw.js').catch(() => undefined));
}
