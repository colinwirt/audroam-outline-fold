import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import '../../../dist/outline-fold.css';
import './App.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
