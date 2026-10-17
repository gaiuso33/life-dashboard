import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { CloudProvider } from './cloud/CloudProvider';
import { isDemo, MemoryRepository } from './demo';
import { startInstallWatch } from './install';
import { StoreProvider } from './store';
import { startUpdates } from './updates';
import './fonts/fonts.css';
import './styles.css';

startInstallWatch();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <StoreProvider repo={isDemo ? new MemoryRepository() : undefined}>
        <CloudProvider>
          <App />
        </CloudProvider>
      </StoreProvider>
    </ErrorBoundary>
  </StrictMode>,
);

// Offline support and installing to the home screen only work when the page is served over http(s), not opened as a file.
startUpdates();
