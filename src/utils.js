// ============================================================
// UTILS — helpers partagés (dates, semaines, tarifs, étoiles)
// ============================================================
const { useState, useMemo, useEffect, useRef } = React;

// ---- TARIFICATION ----
window.HEURES_PAR_JOUR = window.EEC_CONFIG.HEURES_PAR_JOUR || 7;
const calcTJM = (th) => th ? Math.round(th * window.HEURES_PAR_JOUR) : null;
const calcDemiJournee = (th) => th ? Math.round(th * window.HEURES_PAR_JOUR / 2) : null;
const fmtEur = (v) => v == null ? '—' : Number(v).toLocaleString('fr-FR') + ' €';

// ---- DATES & SEMAINES ----
function getIsoWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

function formatShort(d) {
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
}

function isoDate(d) {
  // YYYY-MM-DD en heure locale (évite les décalages UTC)
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Génère les semaines (lundi→vendredi) entre deux dates ISO (incluses)
function generateWeeks(dateDebut, dateFin) {
  const start = new Date(dateDebut + 'T00:00:00');
  const end = new Date(dateFin + 'T00:00:00');
  const weeks = [];
  let cur = new Date(start);
  const dow = cur.getDay() === 0 ? 7 : cur.getDay();
  cur.setDate(cur.getDate() - (dow - 1)); // reculer au lundi
  let safety = 0;
  while (cur <= end && safety < 60) {
    safety++;
    const days = [];
    for (let i = 0; i < 5; i++) {
      const d = new Date(cur);
      d.setDate(d.getDate() + i);
      days.push(d);
    }
    weeks.push({
      iso: getIsoWeek(days[0]),
      days,
      startStr: formatShort(days[0]),
      endStr: formatShort(days[4]),
    });
    cur = new Date(cur);
    cur.setDate(cur.getDate() + 7);
  }
  return weeks;
}

// ---- COMPOSANT ÉTOILES (rating 1-5) ----
const StarRating = ({ value = 0, onChange, readOnly = false, size = 16 }) => {
  const [hover, setHover] = useState(0);
  return (
    <span style={{ display: 'inline-flex', gap: 2, alignItems: 'center' }}>
      {[1, 2, 3, 4, 5].map(n => {
        const active = (hover || value) >= n;
        return (
          <span
            key={n}
            onClick={readOnly ? undefined : (e) => { e.stopPropagation(); onChange && onChange(n === value ? 0 : n); }}
            onMouseEnter={readOnly ? undefined : () => setHover(n)}
            onMouseLeave={readOnly ? undefined : () => setHover(0)}
            style={{
              cursor: readOnly ? 'default' : 'pointer',
              color: active ? '#f5b301' : 'var(--border)',
              fontSize: size, lineHeight: 1, transition: 'color 0.1s ease', userSelect: 'none'
            }}
          >★</span>
        );
      })}
    </span>
  );
};

const avgRating = (ratings) => {
  const vals = Object.values(ratings || {});
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
};

// ---- ICONS (SVG inline) ----
const Icon = ({ name, size = 16 }) => {
  const icons = {
    dashboard: <path d="M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z" />,
    users: <><circle cx="9" cy="7" r="4" /><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2" /><circle cx="17" cy="7" r="3" /><path d="M21 21v-2a4 4 0 0 0-3-3.87" /></>,
    calendar: <><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" /></>,
    plus: <><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></>,
    search: <><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></>,
    download: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></>,
    edit: <><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></>,
    check: <polyline points="20 6 9 17 4 12" />,
    x: <><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></>,
    chevronRight: <polyline points="9 18 15 12 9 6" />,
    alert: <><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></>,
    copy: <><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></>,
    link: <><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></>,
    arrowLeft: <><line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" /></>,
    logout: <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></>,
    refresh: <><polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></>,
    eye: <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></>,
    layout: <><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="9" y1="21" x2="9" y2="9" /></>,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {icons[name]}
    </svg>
  );
};

// ---- TOAST (notifications) ----
const ToastContext = React.createContext(null);
const useToast = () => React.useContext(ToastContext);

const ToastProvider = ({ children }) => {
  const [toasts, setToasts] = useState([]);
  const push = (msg, type = 'success') => {
    const id = Math.random().toString(36).slice(2);
    setToasts(t => [...t, { id, msg, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3500);
  };
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div style={{ position: 'fixed', bottom: 20, right: 20, zIndex: 9999, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {toasts.map(t => (
          <div key={t.id} style={{
            background: t.type === 'error' ? 'var(--danger)' : 'var(--navy)',
            color: t.type === 'error' ? '#fff' : 'var(--cyan)',
            padding: '12px 18px', borderRadius: 8, fontSize: 13, fontWeight: 600,
            boxShadow: '0 8px 24px rgba(13,21,92,0.3)', maxWidth: 360,
            animation: 'fadeIn 0.2s ease'
          }}>{t.msg}</div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};

// ---- helper : exécution async avec gestion d'erreur + toast ----
function useAsync() {
  const toast = useToast();
  return async (fn, successMsg) => {
    try {
      const r = await fn();
      if (successMsg) toast(successMsg, 'success');
      return r;
    } catch (e) {
      console.error(e);
      toast(e.message || 'Une erreur est survenue', 'error');
      throw e;
    }
  };
}
