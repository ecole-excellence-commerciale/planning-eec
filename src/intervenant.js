// ============================================================
// PAGE INTERVENANT (publique, accès par token ?i=...)
// ============================================================

const PageIntervenant = ({ token }) => {
  const toast = useToast();
  const run = useAsync();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [intervenant, setIntervenant] = useState(null);
  const [campagne, setCampagne] = useState(null);
  const [weeks, setWeeks] = useState([]);
  const [dispos, setDispos] = useState({});       // { "YYYY-MM-DD-am": true }
  const [comments, setComments] = useState({});   // { isoWeek: "texte" }
  const [saving, setSaving] = useState(false);
  const [showThanks, setShowThanks] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const inter = await db.getIntervenantParToken(token);
        if (!inter) { setError('lien_invalide'); setLoading(false); return; }
        setIntervenant(inter);

        const camp = await db.getCampagneOuverte();
        if (!camp) { setError('pas_de_campagne'); setLoading(false); return; }
        setCampagne(camp);
        setWeeks(generateWeeks(camp.date_debut, camp.date_fin));

        // Charger les dispos existantes
        const existing = await db.getDisposParToken(token, camp.id);
        const map = {};
        existing.forEach(d => { map[`${d.date}-${d.periode}`] = true; });
        setDispos(map);

        setLoading(false);
      } catch (e) {
        console.error(e);
        setError('erreur'); setLoading(false);
      }
    })();
  }, [token]);

  const toggle = (dateStr, periode) => {
    const key = `${dateStr}-${periode}`;
    setDispos(d => ({ ...d, [key]: !d[key] }));
  };

  const setWeekAll = (week, periode, value) => {
    setDispos(d => {
      const next = { ...d };
      week.days.forEach(day => {
        next[`${isoDate(day)}-${periode}`] = value;
      });
      return next;
    });
  };

  const totalSelected = Object.values(dispos).filter(Boolean).length;
  const totalPossible = weeks.length * 5 * 2;

  const handleSave = async (statut) => {
    setSaving(true);
    try {
      const creneaux = Object.entries(dispos)
        .filter(([, v]) => v)
        .map(([k]) => {
          const i = k.lastIndexOf('-');
          return { date: k.slice(0, i), periode: k.slice(i + 1) };
        });
      await db.sauverDisposParToken(token, campagne.id, creneaux, statut);

      // Sauver les commentaires non vides
      for (const [semaine, txt] of Object.entries(comments)) {
        if (txt && txt.trim()) {
          await db.sauverCommentaireParToken(token, campagne.id, parseInt(semaine), txt.trim());
        }
      }

      if (statut === 'valide') setShowThanks(true);
      else toast('Brouillon enregistré', 'success');
    } catch (e) {
      console.error(e);
      toast(e.message || 'Erreur lors de l’enregistrement', 'error');
    } finally {
      setSaving(false);
    }
  };

  // ---- ÉCRANS D'ÉTAT ----
  if (loading) {
    return <div className="public-page"><div className="public-main" style={{ textAlign: 'center', paddingTop: 80 }}>
      <div className="text-muted">Chargement…</div>
    </div></div>;
  }

  if (error === 'lien_invalide') {
    return <PublicMessage titre="Lien invalide ou expiré"
      texte="Ce lien d’accès n’est plus valide. Il a peut-être été régénéré. Contacte l’équipe EEC pour obtenir un nouveau lien." />;
  }
  if (error === 'pas_de_campagne') {
    return <PublicMessage titre="Aucune collecte en cours"
      texte="Il n’y a pas de période de collecte de disponibilités ouverte pour le moment. Reviens un peu plus tard !" />;
  }
  if (error) {
    return <PublicMessage titre="Une erreur est survenue"
      texte="Impossible de charger la page. Réessaie dans quelques instants, ou contacte l’équipe EEC." />;
  }

  // ---- PAGE PRINCIPALE ----
  return (
    <div className="public-page">
      <div className="public-header">
        <img src="assets/logo-blanc.png" alt="EEC" />
        <div className="right">Planning EEC · {campagne.nom}</div>
      </div>

      <div className="public-main">
        <div className="public-hero">
          <h1 className="display-dot">Bonjour {intervenant.prenom}</h1>
          <p className="lead">
            Bienvenue sur ta page de disponibilités pour la rentrée. Indique les <strong>demi-journées où tu seras disponible</strong> pour
            intervenir entre le <strong>{new Date(campagne.date_debut + 'T00:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}</strong> et
            le <strong>{new Date(campagne.date_fin + 'T00:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}</strong>.
            Tu peux revenir modifier tes choix à tout moment via ce même lien.
          </p>
        </div>

        <div className="legend-bar">
          <div className="legend-item"><span className="swatch" style={{ background: 'var(--bg-alt)' }}></span> Pas dispo</div>
          <div className="legend-item"><span className="swatch" style={{ background: 'var(--cyan)', borderColor: 'var(--cyan-dark)' }}></span> Dispo</div>
          <div style={{ marginLeft: 'auto', fontWeight: 500, color: 'var(--navy)' }}>
            {totalSelected} demi-journées sélectionnées
          </div>
        </div>

        {weeks.map((w) => (
          <div key={w.iso} className="week-card">
            <div className="week-card-head">
              <div className="week-card-title">
                Semaine {w.iso}
                <span className="dates">{w.startStr} → {w.endStr}</span>
              </div>
              <div className="week-card-actions">
                <button className="quick-btn" onClick={() => setWeekAll(w, 'am', true)}>Tous les matins</button>
                <button className="quick-btn" onClick={() => setWeekAll(w, 'pm', true)}>Tous les après-midis</button>
                <button className="quick-btn" onClick={() => { setWeekAll(w, 'am', true); setWeekAll(w, 'pm', true); }}>Semaine complète</button>
                <button className="quick-btn" onClick={() => { setWeekAll(w, 'am', false); setWeekAll(w, 'pm', false); }}>Effacer</button>
              </div>
            </div>

            <div className="pub-dispo-grid">
              {w.days.map((day) => {
                const ds = isoDate(day);
                const dowNames = ['DIM', 'LUN', 'MAR', 'MER', 'JEU', 'VEN', 'SAM'];
                return (
                  <div key={ds} className="pub-day">
                    <div className="pub-day-label">
                      {dowNames[day.getDay()]}
                      <span className="num">{String(day.getDate()).padStart(2, '0')} {day.toLocaleDateString('fr-FR', { month: 'short' })}</span>
                    </div>
                    <div className={'pub-slot ' + (dispos[`${ds}-am`] ? 'selected' : '')} onClick={() => toggle(ds, 'am')}>MATIN</div>
                    <div className={'pub-slot ' + (dispos[`${ds}-pm`] ? 'selected' : '')} onClick={() => toggle(ds, 'pm')}>APRÈS-MIDI</div>
                  </div>
                );
              })}
            </div>

            <div className="week-comment">
              <input type="text" placeholder="Note pour l’équipe EEC sur cette semaine (optionnel)…"
                value={comments[w.iso] || ''}
                onChange={e => setComments({ ...comments, [w.iso]: e.target.value })} />
            </div>
          </div>
        ))}

        <div className="submit-bar">
          <div className="progress-text"><strong>{totalSelected}</strong> / {totalPossible} demi-journées renseignées</div>
          <div className="flex gap-12">
            <button className="btn btn-ghost" disabled={saving} onClick={() => handleSave('en_cours')}>
              {saving ? 'Enregistrement…' : 'Enregistrer le brouillon'}
            </button>
            <button className="btn btn-primary" disabled={saving} onClick={() => handleSave('valide')}>
              <Icon name="check" size={14} /> {saving ? 'Enregistrement…' : 'Valider mes disponibilités'}
            </button>
          </div>
        </div>

        <div style={{ textAlign: 'center', marginTop: 32, color: 'var(--text-muted)', fontSize: 12 }}>
          École de l’Excellence Commerciale · Paris
        </div>
      </div>

      {showThanks && (
        <div className="modal-backdrop" onClick={() => setShowThanks(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ textAlign: 'center', maxWidth: 440 }}>
            <div style={{ fontSize: 48, marginBottom: 8 }}>🎉</div>
            <h3 className="display-dot" style={{ marginBottom: 8 }}>Merci {intervenant.prenom}</h3>
            <p className="text-muted" style={{ marginBottom: 24 }}>
              Tes {totalSelected} demi-journées de disponibilité sont bien enregistrées. Tu peux revenir
              modifier tes choix à tout moment via ce lien — garde-le précieusement !
            </p>
            <button className="btn btn-primary" onClick={() => setShowThanks(false)} style={{ width: '100%', justifyContent: 'center' }}>Fermer</button>
          </div>
        </div>
      )}
    </div>
  );
};

const PublicMessage = ({ titre, texte }) => (
  <div className="public-page">
    <div className="public-header">
      <img src="assets/logo-blanc.png" alt="EEC" />
      <div className="right">Planning EEC</div>
    </div>
    <div className="public-main" style={{ maxWidth: 560 }}>
      <div className="public-hero" style={{ textAlign: 'center' }}>
        <h1 className="display-dot">{titre}</h1>
        <p className="lead">{texte}</p>
      </div>
    </div>
  </div>
);
