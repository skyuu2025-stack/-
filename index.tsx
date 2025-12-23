
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

// Define process shim for browser environment to prevent ReferenceErrors
(window as any).process = (window as any).process || { env: {} };

const rootElement = document.getElementById('root');
if (!rootElement) {
  console.error("Critical: Could not find root element");
} else {
  try {
    const root = ReactDOM.createRoot(rootElement);
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
  } catch (err) {
    console.error("Rendering Error:", err);
  }
}
