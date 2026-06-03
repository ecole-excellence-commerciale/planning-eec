// ============================================================
// APP — routeur principal
// ============================================================

const AdminApp = () => {
  const toast = useToast();
  const [page, setPage] = useState('dashboard');
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState({
    intervenants: [], niveaux: [], categories: [], campagnes: [], campagne: null, dispos: []
  });

  const loadAll = async () => {
    const [niveaux, categories, campagnes, intervenants] = await Promise.all([
      db.getNiveaux(), db.getCategories(), db.getCampagnes(), db.getIntervenants()
    ]);
    const campagne = campagnes.find(c => c.statut === 'ouverte') || campagnes[0] || null;
    const dispos = campagne ? await db.getDisposCampagne(campagne.id) : [];
    setData({ intervenants, niveaux, categories, campagnes, campagne, dispos });
    setLoading(false);
  };

  useEffect(() => { loadAll().catch(e => { console.error(e); toast('Erreur de chargement', 'error'); setLoading(false); }); }, []);

  const nav = (id) => { setSelectedId(null); setPage(id); };

  if (loading) return <div className="app"><div className="main"><div className="text-muted" style={{ padding: 40 }}>Chargement de l’espace admin…</div></div></div>;

  return (
    <div className="app">
      <Sidebar current={page} onNav={nav} onLogout={async () => { await db.signOut(); window.location.reload(); }} />
      <main className="main">
        {selectedId ? (
          <PageFicheIntervenant intervenantId={selectedId} data={data} onBack={() => setSelectedId(null)} onReload={loadAll} />
        ) : (
          <>
            {page === 'dashboard' && <PageDashboard data={data} onNav={nav} />}
            {page === 'calendrier' && <PageCalendrier data={data} />}
            {page === 'intervenants' && <PageIntervenants data={data} onSelect={setSelectedId} onReload={loadAll} />}
            {page === 'campagnes' && <PageCampagnes data={data} onReload={loadAll} />}
            {page === 'parametres' && <PageParametres data={data} onReload={loadAll} />}
          </>
        )}
      </main>
    </div>
  );
};

// ---- ROOT : décide quoi afficher ----
const Root = () => {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('i');

  const [session, setSession] = useState(undefined); // undefined = en cours de vérif

  useEffect(() => {
    if (token) return; // pas besoin d'auth pour la page intervenant
    db.getSession().then(s => setSession(s));
    const { data: sub } = db.onAuthChange(s => setSession(s));
    return () => sub?.subscription?.unsubscribe?.();
  }, []);

  // 1) Lien intervenant → page publique
  if (token) {
    return <PageIntervenant token={token} />;
  }

  // 2) Espace admin
  if (session === undefined) {
    return <div className="login-wrap"><div style={{ color: '#fff' }}>Chargement…</div></div>;
  }
  if (!session) {
    return <AdminLogin onLogged={() => { /* onAuthChange met à jour la session */ }} />;
  }
  return <AdminApp />;
};

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<ToastProvider><Root /></ToastProvider>);
