import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';

function App() {
  return (
    <main className="app-shell">
      <section className="status-card">
        <div className="brand-mark">TÜV SÜD</div>
        <h1>Cosmetics Regulatory Platform | Korea</h1>
        <p>KR independent infrastructure is connected and ready for application migration.</p>
        <div className="status-row">
          <span className="status-dot" />
          <span>Azure Static Web App connected</span>
        </div>
      </section>
    </main>
  ); 
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
