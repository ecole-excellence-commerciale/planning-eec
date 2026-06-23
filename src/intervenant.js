// ============================================================
// PAGE INTERVENANT (publique, accès par token ?i=...)
// ============================================================

// ------------------------------------------------------------
// COMPOSANT PARTAGÉ — gestion des documents d'un intervenant
// (CV, diplômes, NDA). Utilisé côté admin ET côté espace intervenant.
//   mode = 'admin'       → accès direct (session authentifiée)
//   mode = 'intervenant' → via Edge Function (token)
// ------------------------------------------------------------
const DOC_CATEGORIES = [
  { type: 'cv', label: 'CV', multiple: false, icon: '📄' },
  { type: 'diplome', label: 'Diplômes', multiple: true, icon: '🎓' },
  { type: 'nda', label: 'NDA (justificatif, optionnel)', multiple: false, icon: '🔏' },
];
// Catégories de l'onglet Facturation (bons de commande + contrats signés)
const BDC_CATEGORIES = [
  { type: 'bdc', label: 'Bons de commande signés', multiple: true, icon: '🧾' },
  { type: 'contrat', label: 'Contrats signés', multiple: true, icon: '📝' },
];
const DOC_MAX_BYTES = 10 * 1024 * 1024;

const GestionDocuments = ({ mode, intervenantId, token, categories }) => {
  const toast = useToast();
  const [docs, setDocs] = useState(null); // null = chargement
  const [busy, setBusy] = useState(null); // type en cours d'upload
  const fileInputs = useRef({});

  const api = useMemo(() => {
    if (mode === 'admin') {
      return {
        list: () => db.docsLister(intervenantId),
        upload: (type, file) => db.docsUploadAdmin(intervenantId, type, file),
        open: (doc) => db.docsSignedUrl(doc.file_path),
        remove: (doc) => db.docsDelete(doc),
      };
    }
    return {
      list: () => db.docsListerParToken(token),
      upload: (type, file) => db.docsUploadParToken(token, type, file),
      open: (doc) => db.docsSignedUrlParToken(token, doc.id),
      remove: (doc) => db.docsDeleteParToken(token, doc.id),
    };
  }, [mode, intervenantId, token]);

  const reload = async () => {
    try { setDocs(await api.list()); }
    catch (e) { console.error(e); setDocs([]); toast('Impossible de charger les documents', 'error'); }
  };
  useEffect(() => { reload(); }, [mode, intervenantId, token]);

  const onFile = async (type, e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = ''; // permet de re-sélectionner le même fichier ensuite
    if (!file) return;
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    if (!isPdf) { toast('PDF uniquement', 'error'); return; }
    if (file.size > DOC_MAX_BYTES) { toast('Fichier trop volumineux (max 10 Mo)', 'error'); return; }
    setBusy(type);
    try {
      await api.upload(type, file);
      await reload();
      toast('Document importé', 'success');
    } catch (err) {
      console.error(err);
      toast(err && err.message ? err.message : "Échec de l'import", 'error');
    } finally { setBusy(null); }
  };

  const ouvrir = async (doc) => {
    try {
      const url = await api.open(doc);
      if (url) window.open(url, '_blank', 'noopener');
    } catch (e) { console.error(e); toast("Impossible d'ouvrir le document", 'error'); }
  };

  const supprimer = async (doc) => {
    if (!window.confirm(`Supprimer « ${doc.file_name} » ?`)) return;
    try { await api.remove(doc); await reload(); toast('Document supprimé', 'success'); }
    catch (e) { console.error(e); toast('Échec de la suppression', 'error'); }
  };

  const fmtDate = (iso) => new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
  const fmtTaille = (o) => o == null ? '' : (o < 1024 * 1024 ? Math.round(o / 1024) + ' Ko' : (o / 1024 / 1024).toFixed(1) + ' Mo');

  if (docs === null) return <div className="text-muted text-sm" style={{ padding: 16 }}>Chargement des documents…</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {(categories || DOC_CATEGORIES).map(cat => {
        const items = docs.filter(d => d.type === cat.type);
        const remplace = !cat.multiple && items.length > 0;
        return (
          <div key={cat.type} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '12px 14px' }}>
            <div className="flex-between" style={{ marginBottom: items.length ? 8 : 0, alignItems: 'center' }}>
              <div style={{ fontWeight: 600, color: 'var(--navy)', fontSize: 14 }}>
                {cat.icon} {cat.label}
                {!cat.multiple && <span className="text-xs text-muted" style={{ fontWeight: 400 }}> · un seul fichier</span>}
              </div>
              <div>
                <input type="file" accept="application/pdf,.pdf" style={{ display: 'none' }}
                  ref={el => fileInputs.current[cat.type] = el}
                  onChange={e => onFile(cat.type, e)} />
                <button className="btn btn-secondary btn-sm" disabled={busy === cat.type}
                  onClick={() => fileInputs.current[cat.type] && fileInputs.current[cat.type].click()}>
                  {busy === cat.type ? 'Import…' : (remplace ? 'Remplacer' : 'Importer un PDF')}
                </button>
              </div>
            </div>
            {items.length === 0 ? (
              <div className="text-xs text-muted">Aucun fichier.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {items.map(doc => (
                  <div key={doc.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, padding: '6px 8px', background: 'var(--bg-alt)', borderRadius: 6 }}>
                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={doc.file_name}>
                      {doc.file_name}
                    </span>
                    <span className="text-xs text-muted" style={{ whiteSpace: 'nowrap' }}>
                      {fmtTaille(doc.taille)} · {fmtDate(doc.created_at)}
                      {doc.uploaded_by && <> · {doc.uploaded_by === 'admin' ? 'EEC' : 'intervenant'}</>}
                    </span>
                    <button className="btn btn-ghost btn-sm" onClick={() => ouvrir(doc)}>Ouvrir</button>
                    <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} title="Supprimer" onClick={() => supprimer(doc)}>✕</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
      <div className="text-xs text-muted">
        PDF uniquement, 10 Mo max.{' '}
        {mode === 'intervenant'
          ? 'Tes documents restent confidentiels et ne sont visibles que par l’équipe EEC.'
          : 'Stockés dans un espace privé à accès restreint.'}
      </div>
    </div>
  );
};

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

        {/* Mes documents (CV, diplômes, NDA) */}
        <div className="week-card" style={{ marginTop: 24 }}>
          <div className="week-card-head">
            <div className="week-card-title">
              Mes documents
              <span className="dates">CV, diplômes, NDA — PDF, 10 Mo max</span>
            </div>
          </div>
          <div style={{ padding: 16 }}>
            <GestionDocuments mode="intervenant" token={token} />
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
