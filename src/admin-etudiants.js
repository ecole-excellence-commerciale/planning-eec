// ============================================================
// PAGE ÉTUDIANTS — référentiel apprenants par promo (socle émargement)
// ============================================================
const STATUT_ETU = {
  actif: { label: 'Actif', color: '#16a34a' },
  rompu: { label: 'Contrat rompu', color: '#ea580c' },
  sorti: { label: 'Sorti', color: '#94a3b8' },
};

const ModalAjoutEtudiant = ({ promos, promoDefaut, onClose, onSaved }) => {
  const toast = useToast();
  const [f, setF] = useState({ nom: '', prenom: '', email: '', promo_id: promoDefaut || '', statut: 'actif', opco: '', entreprise: '' });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF(s => ({ ...s, [k]: v }));

  const save = async () => {
    if (!f.nom.trim()) { toast('Le nom est obligatoire', 'error'); return; }
    setBusy(true);
    try {
      await db.addEtudiant({
        nom: f.nom.trim().toUpperCase(), prenom: f.prenom.trim(), email: f.email.trim() || null,
        promo_id: f.promo_id || null, statut: f.statut, opco: f.opco.trim() || null, entreprise: f.entreprise.trim() || null,
      });
      toast('Étudiant ajouté', 'success');
      onSaved(); onClose();
    } catch (e) { console.error(e); toast(e.message || 'Erreur', 'error'); }
    finally { setBusy(false); }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <div className="modal-head">
          <h3>🎓 Ajouter un étudiant</h3>
          <div className="modal-close" onClick={onClose}><Icon name="x" size={16} /></div>
        </div>
        <div className="flex gap-12">
          <div className="field" style={{ flex: 1 }}><div className="label">Nom *</div><input value={f.nom} onChange={e => set('nom', e.target.value)} /></div>
          <div className="field" style={{ flex: 1 }}><div className="label">Prénom</div><input value={f.prenom} onChange={e => set('prenom', e.target.value)} /></div>
        </div>
        <div className="field"><div className="label">Email</div><input type="email" value={f.email} onChange={e => set('email', e.target.value)} /></div>
        <div className="flex gap-12">
          <div className="field" style={{ flex: 1 }}>
            <div className="label">Promo</div>
            <select value={f.promo_id} onChange={e => set('promo_id', e.target.value)}>
              <option value="">— non affecté —</option>
              {promos.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </div>
          <div className="field" style={{ flex: 1 }}>
            <div className="label">Statut</div>
            <select value={f.statut} onChange={e => set('statut', e.target.value)}>
              {Object.entries(STATUT_ETU).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
        </div>
        <div className="flex gap-12">
          <div className="field" style={{ flex: 1 }}><div className="label">OPCO</div><input value={f.opco} onChange={e => set('opco', e.target.value)} /></div>
          <div className="field" style={{ flex: 1 }}><div className="label">Entreprise</div><input value={f.entreprise} onChange={e => set('entreprise', e.target.value)} /></div>
        </div>
        <div className="flex-between" style={{ marginTop: 12 }}>
          <button className="btn btn-secondary btn-sm" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? 'Ajout…' : 'Ajouter'}</button>
        </div>
      </div>
    </div>
  );
};

const PageEtudiants = ({ data }) => {
  const toast = useToast();
  const { promos = [] } = data;
  const [etudiants, setEtudiants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filtrePromo, setFiltrePromo] = useState('all');
  const [selection, setSelection] = useState([]);
  const [promoCible, setPromoCible] = useState('');
  const [showAdd, setShowAdd] = useState(false);

  const promoById = useMemo(() => Object.fromEntries(promos.map(p => [p.id, p])), [promos]);

  const charger = async () => {
    setLoading(true);
    try { setEtudiants(await db.getEtudiants()); }
    catch (e) { console.error(e); toast(e.message || 'Erreur de chargement', 'error'); }
    finally { setLoading(false); }
  };
  useEffect(() => { charger(); }, []);

  const filtres = useMemo(() => {
    const q = search.trim().toLowerCase();
    return etudiants.filter(e => {
      if (filtrePromo === 'none' && e.promo_id) return false;
      if (filtrePromo !== 'all' && filtrePromo !== 'none' && e.promo_id !== filtrePromo) return false;
      if (!q) return true;
      return [e.nom, e.prenom, e.email, e.entreprise, e.groupe_import].some(v => (v || '').toLowerCase().includes(q));
    });
  }, [etudiants, search, filtrePromo]);

  const sansPromo = etudiants.filter(e => !e.promo_id).length;
  const toggle = (id) => setSelection(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);
  const toggleAll = () => setSelection(s => s.length === filtres.length ? [] : filtres.map(e => e.id));

  const affecter = async () => {
    if (!selection.length) { toast('Sélectionne au moins un étudiant', 'error'); return; }
    if (!promoCible) { toast('Choisis une promo', 'error'); return; }
    try {
      await db.affecterEtudiantsPromo(selection, promoCible);
      toast(`${selection.length} étudiant(s) affecté(s)`, 'success');
      setSelection([]); charger();
    } catch (e) { console.error(e); toast(e.message || 'Erreur', 'error'); }
  };

  const majEtu = async (etu, patch) => {
    setEtudiants(es => es.map(x => x.id === etu.id ? { ...x, ...patch } : x));
    try { await db.updateEtudiant(etu.id, patch); }
    catch (e) { console.error(e); toast('Erreur', 'error'); charger(); }
  };

  const supprimer = async (etu) => {
    if (!confirm(`Supprimer ${etu.prenom} ${etu.nom} ?`)) return;
    try { await db.deleteEtudiant(etu.id); toast('Supprimé', 'success'); charger(); }
    catch (e) { console.error(e); toast(e.message || 'Erreur', 'error'); }
  };

  if (loading) return <div className="page-content"><div className="page-header"><h1 className="page-title display-dot">Étudiants</h1></div><div className="text-muted">Chargement…</div></div>;

  return (
    <div className="page-content">
      <div className="page-header">
        <div>
          <div className="breadcrumb">PILOTAGE</div>
          <h1 className="page-title display-dot">Étudiants</h1>
          <div className="page-subtitle">Référentiel des apprenants par promo — socle de l’émargement.</div>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => setShowAdd(true)}><Icon name="plus" size={12} /> Ajouter un étudiant</button>
      </div>

      <div className="kpi-grid">
        <div className="kpi"><div className="kpi-label">Étudiants</div><div className="kpi-value">{etudiants.length}</div><div className="kpi-sub">{etudiants.filter(e => e.statut === 'actif').length} actif(s)</div></div>
        <div className="kpi"><div className="kpi-label">Affectés à une promo</div><div className="kpi-value">{etudiants.length - sansPromo}</div><div className="kpi-sub">sur {etudiants.length}</div></div>
        <div className="kpi"><div className="kpi-label">Sans promo</div><div className="kpi-value" style={{ color: sansPromo ? '#ea580c' : '#16a34a' }}>{sansPromo}</div><div className="kpi-sub">{sansPromo ? 'à affecter' : 'tout est affecté'}</div></div>
      </div>

      {sansPromo > 0 && (
        <div className="card" style={{ borderLeft: '4px solid #ea580c', background: '#fffaf5' }}>
          <div className="text-sm">💡 <strong>{sansPromo} étudiant(s) importé(s) sans promo.</strong> Filtre sur « Sans promo », coche-les, puis affecte-les en masse ci-dessous. Le champ « groupe » (12 mois / 24 mois / sept26) t’indique leur provenance.</div>
        </div>
      )}

      <div className="card">
        <div className="flex gap-12" style={{ flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 10 }}>
          <div className="field" style={{ flex: '1 1 220px', marginBottom: 0 }}>
            <div className="label">Recherche</div>
            <input value={search} placeholder="Nom, email, entreprise…" onChange={e => setSearch(e.target.value)} />
          </div>
          <div className="field" style={{ flex: '0 1 220px', marginBottom: 0 }}>
            <div className="label">Promo</div>
            <select value={filtrePromo} onChange={e => { setFiltrePromo(e.target.value); setSelection([]); }}>
              <option value="all">Toutes</option>
              <option value="none">Sans promo ({sansPromo})</option>
              {promos.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </div>
        </div>

        {selection.length > 0 && (
          <div className="flex gap-8" style={{ alignItems: 'center', background: 'var(--bg-alt)', padding: '8px 12px', borderRadius: 6, marginBottom: 10, flexWrap: 'wrap' }}>
            <span className="text-sm" style={{ fontWeight: 600 }}>{selection.length} sélectionné(s) →</span>
            <select value={promoCible} onChange={e => setPromoCible(e.target.value)} style={{ maxWidth: 240 }}>
              <option value="">Choisir une promo…</option>
              {promos.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
            <button className="btn btn-primary btn-sm" onClick={affecter}>Affecter</button>
            <button className="btn btn-secondary btn-sm" onClick={() => setSelection([])}>Annuler</button>
          </div>
        )}

        {filtres.length === 0 ? <div className="text-muted text-sm" style={{ padding: '10px 0' }}>Aucun étudiant.</div> : (
          <table className="table" style={{ fontSize: 12 }}>
            <thead><tr>
              <th style={{ width: 34 }}><input type="checkbox" checked={selection.length === filtres.length && filtres.length > 0} onChange={toggleAll} /></th>
              <th style={{ textAlign: 'left' }}>Nom</th><th style={{ textAlign: 'left' }}>Email</th>
              <th>Groupe</th><th style={{ textAlign: 'left' }}>Promo</th><th>Statut</th><th style={{ textAlign: 'left' }}>Entreprise</th><th></th>
            </tr></thead>
            <tbody>
              {filtres.map(e => (
                <tr key={e.id} style={{ opacity: e.statut === 'actif' ? 1 : 0.55 }}>
                  <td style={{ textAlign: 'center' }}><input type="checkbox" checked={selection.includes(e.id)} onChange={() => toggle(e.id)} /></td>
                  <td style={{ textAlign: 'left', fontWeight: 600 }}>{e.nom} <span style={{ fontWeight: 400 }}>{e.prenom}</span></td>
                  <td style={{ textAlign: 'left' }} className="text-muted">{e.email || '—'}</td>
                  <td><span className="badge" style={{ fontSize: 9 }}>{e.groupe_import || '—'}</span></td>
                  <td style={{ textAlign: 'left' }}>
                    <select value={e.promo_id || ''} style={{ fontSize: 11, padding: '2px 4px', maxWidth: 170 }} onChange={ev => majEtu(e, { promo_id: ev.target.value || null })}>
                      <option value="">— aucune —</option>
                      {promos.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                    </select>
                  </td>
                  <td>
                    <select value={e.statut} style={{ fontSize: 11, padding: '2px 4px', color: (STATUT_ETU[e.statut] || {}).color, fontWeight: 600 }} onChange={ev => majEtu(e, { statut: ev.target.value })}>
                      {Object.entries(STATUT_ETU).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                    </select>
                  </td>
                  <td style={{ textAlign: 'left' }} className="text-muted">{e.entreprise || '—'}</td>
                  <td><div className="modal-close" onClick={() => supprimer(e)} title="Supprimer"><Icon name="x" size={14} /></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showAdd && (
        <ModalAjoutEtudiant
          promos={promos}
          promoDefaut={filtrePromo !== 'all' && filtrePromo !== 'none' ? filtrePromo : ''}
          onClose={() => setShowAdd(false)}
          onSaved={charger}
        />
      )}
    </div>
  );
};
