// ============================================================
// ESPACE ADMIN — partie 2 : intervenants, fiche, campagnes, paramètres
// ============================================================

// URL de base pour les liens intervenants (calculée au runtime)
function lienIntervenant(token) {
  const base = window.location.origin + window.location.pathname.replace(/index\.html$/, '');
  return `${base}?i=${token}`;
}

// ---- LISTE INTERVENANTS ----
const PageIntervenants = ({ data, onSelect, onReload }) => {
  const toast = useToast();
  const run = useAsync();
  const { intervenants, niveaux, categories, sousCategories = [] } = data;
  const [search, setSearch] = useState('');
  const [filterStatut, setFilterStatut] = useState('all');
  const [filterNiveau, setFilterNiveau] = useState('all');
  const [filterCategorie, setFilterCategorie] = useState('all');
  const [sortBy, setSortBy] = useState('nom');
  const [showAdd, setShowAdd] = useState(false);

  // Helper : moyenne des notes d'un intervenant sur les sous-cat d'une catégorie
  // (utilisé pour filtrer et trier par catégorie)
  const noteMoyenneCategorie = (intervenant, catId) => {
    if (!catId || !intervenant.ratings) return null;
    const subsDeLaCat = sousCategories.filter(s => s.categorie_id === catId);
    const notes = subsDeLaCat
      .map(s => intervenant.ratings[s.id])
      .filter(n => typeof n === 'number' && n > 0);
    if (notes.length === 0) return null;
    return notes.reduce((sum, n) => sum + n, 0) / notes.length;
  };

  let filtered = intervenants.filter(i => {
    if (search && !`${i.prenom} ${i.nom} ${i.email || ''}`.toLowerCase().includes(search.toLowerCase())) return false;
    if (filterStatut !== 'all' && i.statut !== filterStatut) return false;
    if (filterNiveau !== 'all' && !i.niveaux.includes(filterNiveau)) return false;
    if (filterCategorie !== 'all' && noteMoyenneCategorie(i, filterCategorie) == null) return false;
    return true;
  });
  filtered = [...filtered].sort((a, b) => {
    if (sortBy === 'tjm_asc') return (a.taux_horaire || 0) - (b.taux_horaire || 0);
    if (sortBy === 'tjm_desc') return (b.taux_horaire || 0) - (a.taux_horaire || 0);
    if (sortBy === 'rating') {
      if (filterCategorie !== 'all') {
        return (noteMoyenneCategorie(b, filterCategorie) || 0) - (noteMoyenneCategorie(a, filterCategorie) || 0);
      }
      return (avgRating(b.ratings) || 0) - (avgRating(a.ratings) || 0);
    }
    return `${a.nom}`.localeCompare(`${b.nom}`);
  });

  const statutChip = s => {
    if (s === 'valide') return <span className="chip success"><span className="badge-dot"></span> Validé</span>;
    if (s === 'en_cours') return <span className="chip warn"><span className="badge-dot warn"></span> En cours</span>;
    return <span className="chip danger"><span className="badge-dot danger"></span> Pas répondu</span>;
  };

  const copyLink = (token) => {
    navigator.clipboard.writeText(lienIntervenant(token));
    toast('Lien copié dans le presse-papier', 'success');
  };

  return (
    <div className="page-content">
      <div className="page-header">
        <div>
          <div className="breadcrumb">GESTION</div>
          <h1 className="page-title display-dot">Intervenants</h1>
          <div className="page-subtitle">{intervenants.length} intervenant(s) dans le pool</div>
        </div>
        <button className="btn btn-primary" onClick={() => setShowAdd(true)}><Icon name="plus" /> Ajouter un intervenant</button>
      </div>

      <div className="filters-bar">
        <div style={{ position: 'relative', minWidth: 220, flex: 1 }}>
          <input type="search" placeholder="Rechercher…" value={search}
            onChange={e => setSearch(e.target.value)} style={{ paddingLeft: 36 }} />
          <div style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }}>
            <Icon name="search" size={14} />
          </div>
        </div>
        <select value={filterStatut} onChange={e => setFilterStatut(e.target.value)}>
          <option value="all">Tous les statuts</option>
          <option value="valide">Validé</option><option value="en_cours">En cours</option><option value="pas_repondu">Pas répondu</option>
        </select>
        <select value={filterNiveau} onChange={e => setFilterNiveau(e.target.value)}>
          <option value="all">Tous les niveaux</option>
          {niveaux.map(n => <option key={n.id} value={n.id}>{n.label}</option>)}
        </select>
        <select value={filterCategorie} onChange={e => setFilterCategorie(e.target.value)}>
          <option value="all">Toutes les catégories</option>
          {categories.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
        <select value={sortBy} onChange={e => setSortBy(e.target.value)}>
          <option value="nom">Trier : Nom</option>
          <option value="tjm_asc">Trier : TJM ↑</option>
          <option value="tjm_desc">Trier : TJM ↓</option>
          <option value="rating">Trier : Meilleure note</option>
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="card text-muted" style={{ textAlign: 'center', padding: 40 }}>
          {intervenants.length === 0
            ? 'Aucun intervenant. Clique sur « Ajouter un intervenant » pour commencer.'
            : 'Aucun intervenant ne correspond à ces filtres.'}
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Intervenant</th><th>Niveaux</th>
                <th>{filterCategorie === 'all' ? 'Compétences' : 'Note'}</th>
                <th>Taux / h</th><th>TJM</th><th>Statut</th><th>Lien</th><th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(i => {
                const moy = avgRating(i.ratings);
                const nbMat = Object.keys(i.ratings || {}).length;
                return (
                  <tr key={i.id} onClick={() => onSelect(i.id)}>
                    <td>
                      <div className="flex gap-12" style={{ alignItems: 'center' }}>
                        <div className="avatar" style={{ background: 'var(--bg-alt)', color: 'var(--navy)' }}>{i.prenom[0]}{i.nom[0]}</div>
                        <div><div className="td-name">{i.prenom} {i.nom}</div><div className="td-secondary">{i.email || '—'}</div></div>
                      </div>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {i.niveaux.map(nid => { const niv = niveaux.find(x => x.id === nid); return niv ? <span key={nid} className={'chip ' + niv.couleur}>{niv.label}</span> : null; })}
                      </div>
                    </td>
                    <td>
                      {filterCategorie === 'all' ? (
                        <div className="flex gap-8" style={{ alignItems: 'center' }}>
                          <span className="chip cyan">{nbMat} compétence{nbMat > 1 ? 's' : ''}</span>
                          {moy != null && <span className="flex gap-8" style={{ alignItems: 'center' }}><StarRating value={Math.round(moy)} readOnly size={13} /><span className="text-xs text-muted">{moy.toFixed(1)}</span></span>}
                        </div>
                      ) : (() => {
                        const m = noteMoyenneCategorie(i, filterCategorie);
                        return m != null
                          ? <div className="flex gap-8" style={{ alignItems: 'center' }}><StarRating value={Math.round(m)} readOnly size={15} /><span className="text-xs text-muted">{m.toFixed(1)}</span></div>
                          : <span className="text-xs text-muted">—</span>;
                      })()}
                    </td>
                    <td className="text-sm"><strong>{i.taux_horaire ? i.taux_horaire + ' €' : '—'}</strong></td>
                    <td className="text-sm">{fmtEur(calcTJM(i.taux_horaire))}</td>
                    <td>{statutChip(i.statut)}</td>
                    <td onClick={e => e.stopPropagation()}>
                      <button className="btn btn-ghost btn-sm" title="Copier le lien" onClick={() => copyLink(i.token)}>
                        <Icon name="copy" size={12} /> Copier
                      </button>
                    </td>
                    <td><Icon name="chevronRight" size={14} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-16 text-sm text-muted">
        TJM = taux horaire × {window.HEURES_PAR_JOUR}h. Notes par catégorie confidentielles (jamais visibles côté intervenant).
      </div>

      {showAdd && <ModalAjoutIntervenant niveaux={niveaux} onClose={() => setShowAdd(false)} onAdded={onReload} />}
    </div>
  );
};

// ---- MODAL AJOUT INTERVENANT ----
const ModalAjoutIntervenant = ({ niveaux, onClose, onAdded }) => {
  const toast = useToast();
  const [form, setForm] = useState({ prenom: '', nom: '', email: '', telephone: '', ville: '', taux_horaire: '' });
  const [selNiveaux, setSelNiveaux] = useState([]);
  const [saving, setSaving] = useState(false);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const toggleNiveau = (id) => setSelNiveaux(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);

  const submit = async () => {
    if (!form.prenom.trim() || !form.nom.trim()) { toast('Prénom et nom sont obligatoires', 'error'); return; }
    setSaving(true);
    try {
      const payload = {
        prenom: form.prenom.trim(), nom: form.nom.trim(),
        email: form.email.trim() || null, telephone: form.telephone.trim() || null,
        ville: form.ville.trim() || null,
        taux_horaire: form.taux_horaire ? parseFloat(form.taux_horaire) : null,
      };
      const created = await db.addIntervenant(payload);
      if (selNiveaux.length) await db.setIntervenantNiveaux(created.id, selNiveaux);
      toast('Intervenant ajouté', 'success');
      onAdded();
      onClose();
    } catch (e) { toast(e.message || 'Erreur', 'error'); }
    finally { setSaving(false); }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head"><h3>Ajouter un intervenant</h3><div className="modal-close" onClick={onClose}><Icon name="x" size={16} /></div></div>
        <div className="grid-2">
          <div className="field"><div className="label">Prénom *</div><input value={form.prenom} onChange={e => set('prenom', e.target.value)} /></div>
          <div className="field"><div className="label">Nom *</div><input value={form.nom} onChange={e => set('nom', e.target.value)} /></div>
          <div className="field"><div className="label">Email</div><input type="email" value={form.email} onChange={e => set('email', e.target.value)} /></div>
          <div className="field"><div className="label">Téléphone</div><input value={form.telephone} onChange={e => set('telephone', e.target.value)} /></div>
          <div className="field"><div className="label">Ville</div><input value={form.ville} onChange={e => set('ville', e.target.value)} /></div>
          <div className="field"><div className="label">Taux horaire (€)</div><input type="number" value={form.taux_horaire} onChange={e => set('taux_horaire', e.target.value)} placeholder="Ex. 75" /></div>
        </div>
        <div className="field">
          <div className="label">Niveaux</div>
          <div className="flex gap-8" style={{ flexWrap: 'wrap' }}>
            {niveaux.map(n => (
              <span key={n.id} className={'chip ' + (selNiveaux.includes(n.id) ? n.couleur : '')}
                style={{ cursor: 'pointer', border: selNiveaux.includes(n.id) ? '1px solid var(--navy)' : '1px solid var(--border)' }}
                onClick={() => toggleNiveau(n.id)}>{n.label}</span>
            ))}
          </div>
        </div>
        <div className="help">Le lien personnel sera généré automatiquement. Tu pourras le copier et l’envoyer toi-même.</div>
        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary" disabled={saving} onClick={submit}>{saving ? 'Ajout…' : 'Ajouter'}</button>
        </div>
      </div>
    </div>
  );
};

// ---- FICHE INTERVENANT ----
const PageFicheIntervenant = ({ intervenantId, data, onBack, onReload }) => {
  const toast = useToast();
  const { niveaux, categories, sousCategories = [], campagne, promos = [], modules = [] } = data;
  const [inter, setInter] = useState(null);
  const [tab, setTab] = useState('dispos');
  const [tauxEdit, setTauxEdit] = useState('');
  const [disposPerso, setDisposPerso] = useState([]);
  const [assignations, setAssignations] = useState([]); // Toutes les interventions planifiées
  // Édition de l'identité (mode édition + valeurs du formulaire)
  const [editMode, setEditMode] = useState(false);
  const [editForm, setEditForm] = useState({ prenom: '', nom: '', email: '', telephone: '', ville: '' });
  // État de la modale de suppression définitive
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');

  const load = async () => {
    const i = await db.getIntervenant(intervenantId);
    setInter(i);
    setTauxEdit(i.taux_horaire ?? '');
    setEditForm({
      prenom: i.prenom || '', nom: i.nom || '',
      email: i.email || '', telephone: i.telephone || '', ville: i.ville || ''
    });
    if (campagne) setDisposPerso(await db.getDisposIntervenant(intervenantId, campagne.id));
    // Charger les interventions planifiées (toutes promos)
    setAssignations(await db.getAllAssignationsIntervenant(intervenantId));
  };
  useEffect(() => { load(); }, [intervenantId]);

  if (!inter) return <div className="page-content"><div className="text-muted">Chargement…</div></div>;

  const saveIdentite = async () => {
    if (!editForm.prenom.trim() || !editForm.nom.trim()) {
      toast('Prénom et nom obligatoires', 'error'); return;
    }
    await db.updateIntervenant(inter.id, {
      prenom: editForm.prenom.trim(),
      nom: editForm.nom.trim(),
      email: editForm.email.trim() || null,
      telephone: editForm.telephone.trim() || null,
      ville: editForm.ville.trim() || null,
    });
    toast('Profil mis à jour', 'success');
    setEditMode(false);
    load(); onReload();
  };

  const archiver = async () => {
    if (!confirm(`Archiver ${inter.prenom} ${inter.nom} ?\n\nL'intervenant disparaîtra de la liste active mais toutes ses données (dispos, notes) sont conservées. Tu pourras le réactiver à tout moment.`)) return;
    await db.deactivateIntervenant(inter.id);
    toast('Intervenant archivé', 'success');
    onReload(); onBack();
  };

  const reactiver = async () => {
    await db.reactivateIntervenant(inter.id);
    toast('Intervenant réactivé', 'success');
    load(); onReload();
  };

  const supprimerDefinitivement = async () => {
    await db.deleteIntervenant(inter.id);
    toast('Intervenant supprimé définitivement', 'success');
    onReload(); onBack();
  };

  const saveTaux = async () => {
    await db.updateIntervenant(inter.id, { taux_horaire: tauxEdit ? parseFloat(tauxEdit) : null });
    toast('Taux horaire mis à jour', 'success');
    load(); onReload();
  };
  const setRating = async (sousCategorieId, note) => {
    await db.setRating(inter.id, sousCategorieId, note);
    setInter(prev => {
      const r = { ...prev.ratings };
      if (note === 0) delete r[sousCategorieId]; else r[sousCategorieId] = note;
      return { ...prev, ratings: r };
    });
    onReload();
  };
  const toggleNiveau = async (nid) => {
    const next = inter.niveaux.includes(nid) ? inter.niveaux.filter(x => x !== nid) : [...inter.niveaux, nid];
    await db.setIntervenantNiveaux(inter.id, next);
    setInter({ ...inter, niveaux: next }); onReload();
  };
  const regen = async () => {
    if (!confirm('Régénérer le lien ? L’ancien lien cessera de fonctionner immédiatement.')) return;
    await db.regenerateToken(inter.id);
    toast('Nouveau lien généré', 'success'); load();
  };
  const copyLink = () => { navigator.clipboard.writeText(lienIntervenant(inter.token)); toast('Lien copié', 'success'); };

  // Regrouper les sous-catégories par catégorie (Général en dernier dans chaque)
  const sousCatsByCat = (() => {
    const map = {};
    for (const sc of sousCategories) {
      (map[sc.categorie_id] = map[sc.categorie_id] || []).push(sc);
    }
    for (const k of Object.keys(map)) {
      map[k].sort((a, b) => {
        if (a.label === 'Général' && b.label !== 'Général') return 1;
        if (a.label !== 'Général' && b.label === 'Général') return -1;
        return (a.ordre || 0) - (b.ordre || 0);
      });
    }
    return map;
  })();
  const setEd = (k, v) => setEditForm(f => ({ ...f, [k]: v }));

  return (
    <div className="page-content">
      <div className="page-header">
        <div style={{ flex: 1 }}>
          <div className="breadcrumb"><a onClick={onBack} style={{ cursor: 'pointer' }}>Intervenants</a> <span className="sep">›</span> {inter.prenom} {inter.nom}</div>
          {!editMode ? (
            <>
              <h1 className="page-title display-dot" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                {inter.prenom} {inter.nom}
                {!inter.actif && <span className="chip danger" style={{ fontSize: 11 }}>Archivé</span>}
                <button className="btn btn-ghost btn-sm" onClick={() => setEditMode(true)} title="Modifier le profil">
                  <Icon name="edit" size={12} /> Modifier
                </button>
              </h1>
              <div className="page-subtitle">
                {inter.email || 'Pas d’email'}
                {inter.telephone ? ' · ' + inter.telephone : ''}
                {inter.ville ? ' · ' + inter.ville : ''}
              </div>
            </>
          ) : (
            <div className="card" style={{ marginTop: 8, maxWidth: 720 }}>
              <div className="card-title">Modifier le profil</div>
              <div className="grid-2">
                <div className="field"><div className="label">Prénom *</div><input value={editForm.prenom} onChange={e => setEd('prenom', e.target.value)} /></div>
                <div className="field"><div className="label">Nom *</div><input value={editForm.nom} onChange={e => setEd('nom', e.target.value)} /></div>
                <div className="field"><div className="label">Email</div><input type="email" value={editForm.email} onChange={e => setEd('email', e.target.value)} /></div>
                <div className="field"><div className="label">Téléphone</div><input value={editForm.telephone} onChange={e => setEd('telephone', e.target.value)} /></div>
                <div className="field"><div className="label">Ville</div><input value={editForm.ville} onChange={e => setEd('ville', e.target.value)} /></div>
              </div>
              <div className="flex gap-8" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
                <button className="btn btn-ghost" onClick={() => { setEditMode(false); load(); }}>Annuler</button>
                <button className="btn btn-primary" onClick={saveIdentite}><Icon name="check" size={12} /> Enregistrer</button>
              </div>
            </div>
          )}
        </div>
        {!editMode && <button className="btn btn-ghost" onClick={onBack}><Icon name="arrowLeft" /> Retour</button>}
      </div>

      <div className="grid-2-1">
        <div>
          <div className="tabs">
            <div className={'tab ' + (tab === 'dispos' ? 'active' : '')} onClick={() => setTab('dispos')}>
              Disponibilités {disposPerso.length > 0 && <span className="chip cyan text-xs" style={{ marginLeft: 4 }}>{disposPerso.length}</span>}
            </div>
            <div className={'tab ' + (tab === 'interventions' ? 'active' : '')} onClick={() => setTab('interventions')}>
              Interventions {assignations.length > 0 && <span className="chip cyan text-xs" style={{ marginLeft: 4 }}>{assignations.length}</span>}
            </div>
            <div className={'tab ' + (tab === 'profil' ? 'active' : '')} onClick={() => setTab('profil')}>Profil</div>
            <div className={'tab ' + (tab === 'actions' ? 'active' : '')} onClick={() => setTab('actions')}>Actions</div>
          </div>

          {tab === 'dispos' && (
            <div className="card">
              <div className="card-title">Disponibilités {campagne ? campagne.nom : ''}</div>
              {inter.statut === 'pas_repondu' ? (
                <div className="text-muted text-sm" style={{ padding: '20px 0', textAlign: 'center' }}>
                  {inter.prenom} n’a pas encore renseigné ses disponibilités.<br />Envoie-lui son lien personnel (onglet « Profil »).
                </div>
              ) : disposPerso.length === 0 ? (
                <div className="text-muted text-sm" style={{ padding: '20px 0', textAlign: 'center' }}>
                  Aucune disponibilité déclarée pour cette campagne.
                </div>
              ) : (
                <div>
                  <div className="flex gap-8 mb-16" style={{ alignItems: 'center' }}>
                    <span className="chip success">{disposPerso.length} demi-journée{disposPerso.length > 1 ? 's' : ''} disponible{disposPerso.length > 1 ? 's' : ''}</span>
                  </div>
                  {/* Détail des dispos par semaine */}
                  {(() => {
                    // Grouper par lundi de semaine
                    const lundi = (dateStr) => {
                      const d = new Date(dateStr + 'T00:00:00');
                      const j = d.getDay();
                      const decal = j === 0 ? -6 : 1 - j;
                      d.setDate(d.getDate() + decal);
                      return d.toISOString().slice(0, 10);
                    };
                    const groupes = {};
                    for (const dispo of disposPerso) {
                      const key = lundi(dispo.date);
                      (groupes[key] = groupes[key] || []).push(dispo);
                    }
                    const semaines = Object.keys(groupes).sort();
                    return semaines.map(lundiKey => {
                      const dispos = groupes[lundiKey].sort((a, b) =>
                        a.date.localeCompare(b.date) || (a.periode === 'am' ? -1 : 1)
                      );
                      const lundiDate = new Date(lundiKey + 'T00:00:00');
                      const dimancheDate = new Date(lundiDate); dimancheDate.setDate(lundiDate.getDate() + 6);
                      const labelSemaine = `${lundiDate.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} → ${dimancheDate.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}`;
                      // Construire une grille jour×période pour la semaine
                      const jours = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven'];
                      const cellules = {};
                      for (const d of dispos) {
                        const dd = new Date(d.date + 'T00:00:00');
                        const jourIdx = dd.getDay() === 0 ? 6 : dd.getDay() - 1; // 0=lun
                        if (jourIdx < 5) cellules[`${jourIdx}-${d.periode}`] = true;
                      }
                      return (
                        <div key={lundiKey} style={{ marginBottom: 12, borderBottom: '1px solid var(--bg-alt)', paddingBottom: 8 }}>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
                            Semaine du {labelSemaine}
                          </div>
                          <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
                            <thead>
                              <tr>
                                <th style={{ textAlign: 'left', padding: 2 }}></th>
                                {jours.map((j, i) => {
                                  const d = new Date(lundiDate); d.setDate(d.getDate() + i);
                                  return <th key={i} style={{ padding: 2, fontWeight: 500, color: 'var(--text-muted)' }}>{j}<br />{d.getDate()}/{d.getMonth() + 1}</th>;
                                })}
                              </tr>
                            </thead>
                            <tbody>
                              {['am', 'pm'].map(p => (
                                <tr key={p}>
                                  <td style={{ padding: 4, color: 'var(--text-muted)', fontWeight: 500 }}>{p === 'am' ? 'Matin' : 'Après-midi'}</td>
                                  {jours.map((_, i) => {
                                    const isDispo = cellules[`${i}-${p}`];
                                    return (
                                      <td key={i} style={{
                                        padding: 4, textAlign: 'center',
                                        background: isDispo ? 'var(--cyan-light)' : '#fff',
                                        border: '1px solid var(--bg-alt)',
                                        borderRadius: 3,
                                        color: isDispo ? 'var(--navy)' : 'var(--text-muted)',
                                        fontWeight: isDispo ? 600 : 400,
                                      }}>
                                        {isDispo ? '✓' : '—'}
                                      </td>
                                    );
                                  })}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      );
                    });
                  })()}
                </div>
              )}
            </div>
          )}

          {tab === 'interventions' && (
            <div className="card">
              <div className="card-title">Interventions planifiées</div>
              {assignations.length === 0 ? (
                <div className="text-muted text-sm" style={{ padding: '20px 0', textAlign: 'center' }}>
                  Aucune intervention planifiée pour le moment.
                </div>
              ) : (() => {
                // Préparer un index module et promo
                const moduleById = Object.fromEntries(modules.map(m => [m.id, m]));
                const sousCategorieById = Object.fromEntries(sousCategories.map(s => [s.id, s]));
                const categorieById = Object.fromEntries(categories.map(c => [c.id, c]));
                const promoById = Object.fromEntries(promos.map(p => [p.id, p]));
                // Trier par date et grouper par mois
                const sorted = [...assignations].sort((a, b) =>
                  a.date_jour.localeCompare(b.date_jour) || (a.periode === 'am' ? -1 : 1)
                );
                const moisGroupes = {};
                for (const a of sorted) {
                  const d = new Date(a.date_jour + 'T00:00:00');
                  const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
                  (moisGroupes[key] = moisGroupes[key] || []).push(a);
                }
                return (
                  <div>
                    <div className="flex gap-8 mb-16" style={{ alignItems: 'center' }}>
                      <span className="chip cyan">{assignations.length} créneau{assignations.length > 1 ? 'x' : ''}</span>
                      <span className="text-xs text-muted">
                        ≈ {(assignations.length * 3.5).toFixed(1)}h · {fmtEur(inter.taux_horaire ? assignations.length * inter.taux_horaire * 3.5 : 0)}
                      </span>
                    </div>
                    {Object.keys(moisGroupes).sort().map(moisKey => {
                      const items = moisGroupes[moisKey];
                      const [y, m] = moisKey.split('-');
                      const moisLabel = new Date(parseInt(y), parseInt(m) - 1, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
                      return (
                        <div key={moisKey} style={{ marginBottom: 14 }}>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6, fontWeight: 700 }}>
                            {moisLabel}
                          </div>
                          {items.map(a => {
                            const mod = moduleById[a.module_id];
                            const sub = mod?.sous_categorie_id ? sousCategorieById[mod.sous_categorie_id] : null;
                            const cat = mod ? categorieById[mod.categorie_id] : null;
                            const promo = promoById[a.promo_id];
                            const d = new Date(a.date_jour + 'T00:00:00');
                            const dateLabel = d.toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: 'short' });
                            return (
                              <div key={a.id} style={{
                                display: 'grid',
                                gridTemplateColumns: '90px 60px 1fr auto',
                                gap: 10, alignItems: 'center',
                                padding: '8px 4px', borderBottom: '1px solid var(--bg-alt)',
                                fontSize: 13,
                              }}>
                                <div style={{ fontWeight: 600, color: 'var(--navy)' }}>{dateLabel}</div>
                                <div className="text-xs text-muted">{a.periode === 'am' ? 'Matin' : 'Aprem'}</div>
                                <div style={{ minWidth: 0 }}>
                                  <div style={{ fontWeight: 500 }}>{mod?.label || <em className="text-muted">Module non défini</em>}</div>
                                  {(cat || sub) && (
                                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                                      {cat?.label}
                                      {sub && sub.label !== 'Général' && <span> · <em>{sub.label}</em></span>}
                                    </div>
                                  )}
                                </div>
                                <div className="chip" style={{ background: 'var(--bg-alt)', fontSize: 11 }}>
                                  {promo?.label || '?'}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          )}

          {tab === 'profil' && (
            <div className="card">
              <div className="card-title">Lien personnel d’accès</div>
              <div style={{ background: 'var(--cyan-light)', padding: '12px 14px', borderRadius: 8, marginBottom: 12, wordBreak: 'break-all', fontSize: 13 }}>
                {lienIntervenant(inter.token)}
              </div>
              <div className="flex gap-8">
                <button className="btn btn-secondary btn-sm" onClick={copyLink}><Icon name="copy" size={12} /> Copier le lien</button>
                <button className="btn btn-ghost btn-sm" onClick={regen}><Icon name="refresh" size={12} /> Régénérer</button>
              </div>
              <div className="help mt-8">Envoie ce lien à l’intervenant (mail, message…). Il pourra y revenir à volonté. La régénération invalide l’ancien lien.</div>
              {!inter.token_actif && <div className="chip danger mt-8">Lien actuellement désactivé</div>}
            </div>
          )}

          {tab === 'actions' && (
            <div className="card">
              <div className="card-title">Actions sur cet intervenant</div>

              {inter.actif ? (
                <div style={{ padding: '8px 0', borderBottom: '1px solid var(--bg-alt)' }}>
                  <div className="flex-between" style={{ alignItems: 'flex-start', gap: 16 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, marginBottom: 4 }}>Archiver</div>
                      <div className="text-sm text-muted">
                        L’intervenant disparaît de la liste active mais toutes ses données (dispos, notes, historique) sont conservées. Réversible : tu peux le réactiver à tout moment.
                      </div>
                    </div>
                    <button className="btn btn-ghost btn-sm" onClick={archiver} style={{ flexShrink: 0 }}>
                      <Icon name="x" size={12} /> Archiver
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ padding: '8px 0', borderBottom: '1px solid var(--bg-alt)' }}>
                  <div className="flex-between" style={{ alignItems: 'flex-start', gap: 16 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, marginBottom: 4 }}>Réactiver</div>
                      <div className="text-sm text-muted">
                        L’intervenant est actuellement archivé. Réactive-le pour qu’il réapparaisse dans la liste active.
                      </div>
                    </div>
                    <button className="btn btn-primary btn-sm" onClick={reactiver} style={{ flexShrink: 0 }}>
                      <Icon name="check" size={12} /> Réactiver
                    </button>
                  </div>
                </div>
              )}

              <div style={{ padding: '12px 0' }}>
                <div className="flex-between" style={{ alignItems: 'flex-start', gap: 16 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--danger)' }}>Supprimer définitivement</div>
                    <div className="text-sm text-muted">
                      Supprime l’intervenant et <strong>toutes ses données</strong> : disponibilités, notes par catégorie, niveaux, commentaires. <strong>Cette action est irréversible.</strong> Préfère « Archiver » sauf pour les comptes de test.
                    </div>
                  </div>
                  <button className="btn btn-ghost btn-sm" onClick={() => { setShowDeleteConfirm(true); setDeleteConfirmText(''); }} style={{ flexShrink: 0, color: 'var(--danger)', borderColor: 'var(--danger)' }}>
                    Supprimer…
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        <div>
          <div className="card mb-16">
            <div className="card-header"><div className="card-title" style={{ marginBottom: 0 }}>Tarification</div></div>
            <div className="field" style={{ marginBottom: 12 }}>
              <div className="label">Taux horaire (€)</div>
              <div className="flex gap-8">
                <input type="number" value={tauxEdit} onChange={e => setTauxEdit(e.target.value)} placeholder="Ex. 75" />
                <button className="btn btn-primary btn-sm" onClick={saveTaux}><Icon name="check" size={12} /></button>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, background: 'var(--cyan-light)', padding: '12px 14px', borderRadius: 8 }}>
              <div className="flex-between"><span className="text-sm text-muted">TJM ({window.HEURES_PAR_JOUR}h)</span><strong style={{ fontFamily: 'Gopher Heavy', color: 'var(--navy)' }}>{fmtEur(calcTJM(inter.taux_horaire))}</strong></div>
              <div className="flex-between"><span className="text-sm text-muted">Demi-journée</span><strong style={{ fontFamily: 'Gopher Heavy', color: 'var(--navy)' }}>{fmtEur(calcDemiJournee(inter.taux_horaire))}</strong></div>
            </div>
            <div className="help mt-8">Confidentiel — jamais visible côté intervenant.</div>
          </div>

          <div className="card mb-16">
            <div className="card-title">Niveaux assignés</div>
            <div className="flex gap-8" style={{ flexWrap: 'wrap' }}>
              {niveaux.map(n => (
                <span key={n.id} className={'chip ' + (inter.niveaux.includes(n.id) ? n.couleur : '')}
                  style={{ cursor: 'pointer', border: inter.niveaux.includes(n.id) ? '1px solid var(--navy)' : '1px solid var(--border)', opacity: inter.niveaux.includes(n.id) ? 1 : 0.5 }}
                  onClick={() => toggleNiveau(n.id)}>{n.label}</span>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <div className="card-title" style={{ marginBottom: 0 }}>Compétences par sous-catégorie</div>
              <span className="chip cyan text-xs">Confidentiel</span>
            </div>
            <div className="text-sm text-muted mb-16" style={{ fontSize: 12 }}>
              Note la maîtrise de l'intervenant dans chaque sous-catégorie (1 = débutant, 5 = expert).
              La note 0 retire l'évaluation. Les sous-catégories non notées sont ignorées par l'algorithme de suggestion.
            </div>
            {categories.sort((a, b) => (a.ordre || 0) - (b.ordre || 0)).map(cat => {
              const subs = sousCatsByCat[cat.id] || [];
              if (subs.length === 0) return null;
              const subsNotees = subs.filter(s => s.id in inter.ratings);
              const totalSubs = subs.length;
              return (
                <details key={cat.id} open={subsNotees.length > 0}
                  style={{ marginBottom: 8, borderBottom: '1px solid var(--bg-alt)', paddingBottom: 6 }}>
                  <summary style={{ cursor: 'pointer', padding: '6px 0', listStyle: 'none', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', minWidth: 14 }}>▸</span>
                    <span style={{ fontWeight: 600, color: 'var(--navy)', flex: 1 }}>{cat.label}</span>
                    <span className="text-xs text-muted">
                      {subsNotees.length} / {totalSubs} notées
                    </span>
                  </summary>
                  <div style={{ padding: '4px 0 4px 22px' }}>
                    {subs.map(sub => (
                      <div key={sub.id} className="flex-between" style={{ padding: '6px 0' }}>
                        <span className="text-sm" style={{
                          color: sub.label === 'Général' ? 'var(--text-muted)' : 'var(--navy)',
                          fontStyle: sub.label === 'Général' ? 'italic' : 'normal',
                        }}>
                          {sub.label}
                        </span>
                        <StarRating value={inter.ratings[sub.id] || 0}
                          onChange={(n) => setRating(sub.id, n)}
                          size={15} />
                      </div>
                    ))}
                  </div>
                </details>
              );
            })}
          </div>
        </div>
      </div>

      {showDeleteConfirm && (
        <div className="modal-backdrop" onClick={() => setShowDeleteConfirm(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 480 }}>
            <div className="modal-head">
              <h3 style={{ color: 'var(--danger)' }}>Suppression définitive</h3>
              <div className="modal-close" onClick={() => setShowDeleteConfirm(false)}><Icon name="x" size={16} /></div>
            </div>
            <div className="text-sm" style={{ marginBottom: 12 }}>
              Tu es sur le point de supprimer <strong>{inter.prenom} {inter.nom}</strong> et toutes ses données associées (disponibilités, notes, commentaires).
            </div>
            <div className="text-sm" style={{ background: '#ffe4e4', padding: '10px 12px', borderRadius: 6, marginBottom: 16, color: 'var(--danger)' }}>
              <strong>⚠ Cette action est irréversible.</strong> Aucune sauvegarde n’est conservée.
            </div>
            <div className="field">
              <div className="label">Pour confirmer, tape le nom complet : <strong>{inter.prenom} {inter.nom}</strong></div>
              <input
                value={deleteConfirmText}
                onChange={e => setDeleteConfirmText(e.target.value)}
                placeholder={`${inter.prenom} ${inter.nom}`}
                autoFocus
              />
            </div>
            <div className="modal-foot">
              <button className="btn btn-ghost" onClick={() => setShowDeleteConfirm(false)}>Annuler</button>
              <button
                className="btn btn-primary"
                disabled={deleteConfirmText.trim() !== `${inter.prenom} ${inter.nom}`}
                style={deleteConfirmText.trim() === `${inter.prenom} ${inter.nom}` ? { background: 'var(--danger)' } : {}}
                onClick={supprimerDefinitivement}
              >
                Supprimer définitivement
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ---- CAMPAGNES ----
const PageCampagnes = ({ data, onReload }) => {
  const toast = useToast();
  const { campagnes } = data;
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ nom: '', date_debut: '', date_fin: '' });

  const submit = async () => {
    if (!form.nom || !form.date_debut || !form.date_fin) { toast('Tous les champs sont requis', 'error'); return; }
    try {
      await db.addCampagne(form.nom, form.date_debut, form.date_fin, 'ouverte');
      toast('Campagne créée', 'success'); setShowAdd(false); setForm({ nom: '', date_debut: '', date_fin: '' }); onReload();
    } catch (e) { toast(e.message, 'error'); }
  };
  const toggleStatut = async (c) => {
    const next = c.statut === 'ouverte' ? 'fermee' : 'ouverte';
    await db.updateCampagneStatut(c.id, next); toast('Statut mis à jour', 'success'); onReload();
  };

  return (
    <div className="page-content">
      <div className="page-header">
        <div><div className="breadcrumb">GESTION</div><h1 className="page-title display-dot">Campagnes</h1>
          <div className="page-subtitle">Périodes de collecte des disponibilités</div></div>
        <button className="btn btn-primary" onClick={() => setShowAdd(true)}><Icon name="plus" /> Nouvelle campagne</button>
      </div>

      {campagnes.map(c => (
        <div key={c.id} className="card mb-16">
          <div className="flex-between">
            <div>
              <div className="flex gap-12" style={{ alignItems: 'center', marginBottom: 4 }}>
                <h3 style={{ fontSize: 18 }}>{c.nom}</h3>
                {c.statut === 'ouverte' ? <span className="chip success"><span className="badge-dot"></span> Ouverte</span> : <span className="chip">{c.statut}</span>}
              </div>
              <div className="text-sm text-muted">
                {new Date(c.date_debut + 'T00:00:00').toLocaleDateString('fr-FR')} → {new Date(c.date_fin + 'T00:00:00').toLocaleDateString('fr-FR')}
              </div>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={() => toggleStatut(c)}>
              {c.statut === 'ouverte' ? 'Fermer' : 'Rouvrir'}
            </button>
          </div>
        </div>
      ))}

      {showAdd && (
        <div className="modal-backdrop" onClick={() => setShowAdd(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-head"><h3>Nouvelle campagne</h3><div className="modal-close" onClick={() => setShowAdd(false)}><Icon name="x" size={16} /></div></div>
            <div className="field"><div className="label">Nom</div><input value={form.nom} onChange={e => setForm({ ...form, nom: e.target.value })} placeholder="Ex. T2 2026-2027" /></div>
            <div className="grid-2">
              <div className="field"><div className="label">Date de début</div><input type="date" value={form.date_debut} onChange={e => setForm({ ...form, date_debut: e.target.value })} /></div>
              <div className="field"><div className="label">Date de fin</div><input type="date" value={form.date_fin} onChange={e => setForm({ ...form, date_fin: e.target.value })} /></div>
            </div>
            <div className="modal-foot">
              <button className="btn btn-ghost" onClick={() => setShowAdd(false)}>Annuler</button>
              <button className="btn btn-primary" onClick={submit}>Créer</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ---- PARAMÈTRES ----
// ============================================================
// PARAMÈTRES — niveaux + catégories (arborescence avec modules)
// ============================================================

const PageParametres = ({ data, onReload }) => {
  const toast = useToast();
  const { niveaux, categories, sousCategories = [], modules, interParCategorie } = data;

  // ---- État niveau ----
  const [newNiveau, setNewNiveau] = useState('');

  // ---- État catégories ----
  const [expanded, setExpanded] = useState({}); // { catId: true }
  const [editingCat, setEditingCat] = useState(null);
  const [editCatText, setEditCatText] = useState('');
  const [showAddCat, setShowAddCat] = useState(false);
  const [newCatText, setNewCatText] = useState('');

  // ---- État sous-catégories ----
  const [expandedSub, setExpandedSub] = useState({}); // { subCatId: true } : déplié ou pas
  const [editingSub, setEditingSub] = useState(null);
  const [editSubText, setEditSubText] = useState('');
  const [addingSubFor, setAddingSubFor] = useState(null); // catId
  const [newSubText, setNewSubText] = useState('');
  const [deleteSubModal, setDeleteSubModal] = useState(null); // {id, label, nbModules}

  // ---- État modules ----
  const [editingMod, setEditingMod] = useState(null);
  const [editModText, setEditModText] = useState('');
  const [addingModFor, setAddingModFor] = useState(null); // sous_categorie_id
  const [newModText, setNewModText] = useState('');

  // ---- Drag-and-drop pour déplacer un module ----
  const [dragModule, setDragModule] = useState(null);    // {id, label, sous_categorie_id}
  const [dropTargetSub, setDropTargetSub] = useState(null); // sub_cat id en cours de survol

  // ---- État modales de suppression définitive ----
  const [deleteCatModal, setDeleteCatModal] = useState(null);
  const [deleteCatConfirm, setDeleteCatConfirm] = useState('');
  const [deleteModModal, setDeleteModModal] = useState(null);
  const [deleteModConfirm, setDeleteModConfirm] = useState('');

  // ---- Helpers d'indexation ----
  const sousCategoriesByCat = useMemo(() => {
    const map = {};
    for (const sc of sousCategories) {
      (map[sc.categorie_id] = map[sc.categorie_id] || []).push(sc);
    }
    // Tri : "Général" en dernier dans chaque catégorie, puis par ordre
    for (const k of Object.keys(map)) {
      map[k].sort((a, b) => {
        if (a.label === 'Général' && b.label !== 'Général') return 1;
        if (a.label !== 'Général' && b.label === 'Général') return -1;
        return (a.ordre || 0) - (b.ordre || 0);
      });
    }
    return map;
  }, [sousCategories]);

  const modulesBySousCat = useMemo(() => {
    const map = {};
    for (const m of modules) {
      const key = m.sous_categorie_id || `_orphan_${m.categorie_id}`;
      (map[key] = map[key] || []).push(m);
    }
    return map;
  }, [modules]);

  const modulesByCat = useMemo(() => {
    // Conservé pour compteur en haut de catégorie
    const map = {};
    for (const m of modules) {
      (map[m.categorie_id] = map[m.categorie_id] || []).push(m);
    }
    return map;
  }, [modules]);

  const toggleExpand = (catId) => {
    setExpanded(e => ({ ...e, [catId]: !e[catId] }));
    // Si on ouvre une catégorie, déplier aussi toutes ses sous-cat par défaut
    if (!expanded[catId]) {
      const subs = sousCategoriesByCat[catId] || [];
      const subExpansions = {};
      subs.forEach(s => { subExpansions[s.id] = true; });
      setExpandedSub(prev => ({ ...prev, ...subExpansions }));
    }
  };
  const toggleExpandSub = (subId) => setExpandedSub(e => ({ ...e, [subId]: !e[subId] }));

  // ---- ACTIONS NIVEAUX ----
  const addNiveau = async () => {
    if (!newNiveau.trim()) return;
    const colors = ['level-bac2', 'level-mastere', 'level-bootcamp'];
    await db.addNiveau(newNiveau.trim(), colors[niveaux.length % 3], niveaux.length + 1);
    setNewNiveau(''); toast('Niveau ajouté', 'success'); onReload();
  };
  const delNiveau = async (id) => {
    if (confirm('Retirer ce niveau ?')) {
      await db.deactivateNiveau(id); toast('Niveau retiré'); onReload();
    }
  };

  // ---- ACTIONS CATÉGORIES ----
  const startEditCat = (cat) => { setEditingCat(cat.id); setEditCatText(cat.label); };
  const saveEditCat = async (catId) => {
    if (!editCatText.trim()) { setEditingCat(null); return; }
    await db.renameCategorie(catId, editCatText.trim());
    toast('Catégorie renommée', 'success');
    setEditingCat(null); onReload();
  };
  const addCat = async () => {
    if (!newCatText.trim()) { setShowAddCat(false); return; }
    if (!selectedNiveauId) { toast('Choisis un niveau d\'abord', 'error'); return; }
    await db.addCategorie(newCatText.trim(), sortedCats.length + 1, selectedNiveauId);
    toast('Catégorie ajoutée', 'success');
    setNewCatText(''); setShowAddCat(false); onReload();
  };
  const askDeleteCat = (cat) => {
    const nbModules = (modulesByCat[cat.id] || []).length;
    const nbNotes = interParCategorie[cat.id] || 0;
    setDeleteCatModal({ id: cat.id, label: cat.label, nbModules, nbNotes });
    setDeleteCatConfirm('');
  };
  const confirmDeleteCat = async () => {
    await db.deleteCategorie(deleteCatModal.id);
    toast('Catégorie supprimée', 'success');
    setDeleteCatModal(null); onReload();
  };

  // ---- ACTIONS SOUS-CATÉGORIES ----
  const startEditSub = (sub) => { setEditingSub(sub.id); setEditSubText(sub.label); };
  const saveEditSub = async (subId) => {
    if (!editSubText.trim()) { setEditingSub(null); return; }
    await db.renameSousCategorie(subId, editSubText.trim());
    toast('Sous-catégorie renommée', 'success');
    setEditingSub(null); onReload();
  };
  const startAddSub = (catId) => {
    setAddingSubFor(catId); setNewSubText('');
    setExpanded(e => ({ ...e, [catId]: true }));
  };
  const addSub = async (catId) => {
    if (!newSubText.trim()) { setAddingSubFor(null); return; }
    const existing = (sousCategoriesByCat[catId] || []).length;
    await db.addSousCategorie(catId, newSubText.trim(), (existing + 1) * 10);
    toast('Sous-catégorie ajoutée', 'success');
    setNewSubText(''); setAddingSubFor(null); onReload();
  };
  const askDeleteSub = (sub) => {
    const nbMods = (modulesBySousCat[sub.id] || []).length;
    setDeleteSubModal({ id: sub.id, label: sub.label, nbModules: nbMods });
  };
  const confirmDeleteSub = async () => {
    await db.deleteSousCategorie(deleteSubModal.id);
    toast('Sous-catégorie supprimée', 'success');
    setDeleteSubModal(null); onReload();
  };

  // ---- ACTIONS MODULES ----
  const startEditMod = (mod) => { setEditingMod(mod.id); setEditModText(mod.label); };
  const saveEditMod = async (modId) => {
    if (!editModText.trim()) { setEditingMod(null); return; }
    await db.renameModule(modId, editModText.trim());
    toast('Module renommé', 'success');
    setEditingMod(null); onReload();
  };
  const startAddMod = (subId) => {
    setAddingModFor(subId); setNewModText('');
    setExpandedSub(e => ({ ...e, [subId]: true }));
  };
  const addMod = async (subId) => {
    if (!newModText.trim()) { setAddingModFor(null); return; }
    const sub = sousCategories.find(s => s.id === subId);
    if (!sub) return;
    const ordre = (modulesBySousCat[subId] || []).length + 1;
    await db.addModule(sub.categorie_id, newModText.trim(), ordre, subId);
    toast('Module ajouté', 'success');
    setNewModText(''); setAddingModFor(null); onReload();
  };
  const askDeleteMod = (mod, catLabel) => {
    setDeleteModModal({ id: mod.id, label: mod.label, categorieLabel: catLabel });
    setDeleteModConfirm('');
  };
  const confirmDeleteMod = async () => {
    await db.deleteModule(deleteModModal.id);
    toast('Module supprimé', 'success');
    setDeleteModModal(null); onReload();
  };

  // ---- DRAG-AND-DROP MODULE → SOUS-CATÉGORIE ----
  const onDragStart = (e, mod) => {
    setDragModule(mod);
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', mod.id); } catch {}
  };
  const onDragEnd = () => { setDragModule(null); setDropTargetSub(null); };
  const onDragOver = (e, subId) => {
    if (!dragModule) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dropTargetSub !== subId) setDropTargetSub(subId);
  };
  const onDragLeave = (e) => {
    if (e.currentTarget.contains(e.relatedTarget)) return;
    setDropTargetSub(null);
  };
  const onDrop = async (e, subId) => {
    e.preventDefault();
    const mod = dragModule;
    setDragModule(null); setDropTargetSub(null);
    if (!mod || mod.sous_categorie_id === subId) return;
    try {
      await db.setModuleSousCategorie(mod.id, subId);
      toast('Module déplacé', 'success');
      onReload();
    } catch (err) {
      console.error(err); toast(err.message || 'Erreur', 'error');
    }
  };

  // ---- Sélection du niveau pour filtrer les catégories ----
  // Par défaut : 1er niveau dans l'ordre (Bac+2 si présent)
  const [selectedNiveauId, setSelectedNiveauId] = useState(() => {
    const sorted = [...(niveaux || [])].sort((a, b) => (a.ordre || 0) - (b.ordre || 0));
    return sorted[0]?.id || null;
  });

  // Si les niveaux sont chargés après le premier rendu, initialiser
  useEffect(() => {
    if (!selectedNiveauId && niveaux && niveaux.length > 0) {
      const sorted = [...niveaux].sort((a, b) => (a.ordre || 0) - (b.ordre || 0));
      setSelectedNiveauId(sorted[0].id);
    }
  }, [niveaux, selectedNiveauId]);

  // ---- TRI : catégories triées par ordre, filtrées par niveau sélectionné ----
  const sortedCats = useMemo(() => {
    if (!selectedNiveauId) return [];
    return [...categories]
      .filter(c => c.niveau_id === selectedNiveauId)
      .sort((a, b) => (a.ordre || 0) - (b.ordre || 0));
  }, [categories, selectedNiveauId]);

  // Compteur de modules pour le niveau sélectionné
  const nbModulesNiveau = useMemo(() => {
    const catIds = new Set(sortedCats.map(c => c.id));
    return modules.filter(m => catIds.has(m.categorie_id)).length;
  }, [modules, sortedCats]);

  return (
    <div className="page-content">
      <div className="page-header">
        <div>
          <div className="breadcrumb">GESTION</div>
          <h1 className="page-title display-dot">Niveaux & catégories</h1>
          <div className="page-subtitle">Paramètres de qualification des intervenants</div>
        </div>
      </div>

      {/* NIVEAUX (carte compacte en haut) */}
      <div className="card mb-16">
        <div className="card-header"><div className="card-title" style={{ marginBottom: 0 }}>Niveaux</div><span className="text-xs text-muted">{niveaux.length}</span></div>
        <div className="flex gap-8 mb-16" style={{ flexWrap: 'wrap' }}>
          {niveaux.map(n => (
            <span key={n.id} className={'chip ' + n.couleur} style={{ padding: '6px 12px' }}>
              {n.label}
              <span style={{ marginLeft: 6, cursor: 'pointer', opacity: 0.6 }} onClick={() => delNiveau(n.id)}>×</span>
            </span>
          ))}
        </div>
        <div className="flex gap-8">
          <input type="text" placeholder="Ex. Bac+3" value={newNiveau}
            onChange={e => setNewNiveau(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addNiveau()} />
          <button className="btn btn-primary btn-sm" onClick={addNiveau}><Icon name="plus" size={12} /></button>
        </div>
      </div>

      {/* CATÉGORIES & MODULES (arborescence) */}
      <div className="card">
        <div className="card-header" style={{ marginBottom: 12 }}>
          <div className="card-title" style={{ marginBottom: 0 }}>Catégories & modules</div>
          <div className="flex gap-8" style={{ alignItems: 'center' }}>
            <span className="text-xs text-muted">{sortedCats.length} catégorie{sortedCats.length > 1 ? 's' : ''} · {nbModulesNiveau} module{nbModulesNiveau > 1 ? 's' : ''}</span>
            <button className="btn btn-primary btn-sm" onClick={() => { setShowAddCat(true); setNewCatText(''); }}>
              <Icon name="plus" size={12} /> Nouvelle catégorie
            </button>
          </div>
        </div>

        {/* Onglets niveau */}
        {niveaux.length > 0 && (
          <div className="flex gap-8 mb-16" style={{ borderBottom: '1px solid var(--border)' }}>
            {[...niveaux].sort((a, b) => (a.ordre || 0) - (b.ordre || 0)).map(n => {
              const isActive = selectedNiveauId === n.id;
              const nbCatNiveau = categories.filter(c => c.niveau_id === n.id).length;
              return (
                <div key={n.id}
                  onClick={() => setSelectedNiveauId(n.id)}
                  style={{
                    padding: '8px 16px',
                    cursor: 'pointer',
                    borderBottom: isActive ? '2px solid var(--navy)' : '2px solid transparent',
                    marginBottom: -1,
                    fontWeight: isActive ? 600 : 500,
                    color: isActive ? 'var(--navy)' : 'var(--text-muted)',
                    fontSize: 13,
                    transition: 'all 0.15s',
                    display: 'flex', alignItems: 'center', gap: 6,
                  }}>
                  {n.label}
                  <span className="text-xs text-muted" style={{ fontWeight: 400 }}>({nbCatNiveau})</span>
                </div>
              );
            })}
          </div>
        )}

        <div className="text-sm text-muted mb-16">
          Hiérarchie : <strong>Catégorie</strong> → <strong>Sous-catégorie</strong> → <strong>Modules</strong>.
          Tu peux <strong>glisser un module</strong> dans une autre sous-catégorie pour le déplacer.
          Double-clique sur un nom pour le renommer.
        </div>

        {/* Ligne d'ajout de catégorie */}
        {showAddCat && (
          <div style={{ background: 'var(--cyan-light)', padding: 12, borderRadius: 8, marginBottom: 12 }}>
            <div className="flex gap-8">
              <input type="text" placeholder="Nom de la nouvelle catégorie" autoFocus
                value={newCatText}
                onChange={e => setNewCatText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') addCat(); if (e.key === 'Escape') setShowAddCat(false); }} />
              <button className="btn btn-primary btn-sm" onClick={addCat}><Icon name="check" size={12} /> Ajouter</button>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowAddCat(false)}>Annuler</button>
            </div>
          </div>
        )}

        {/* Arborescence des catégories */}
        {sortedCats.length === 0 ? (
          <div className="text-muted text-sm" style={{ textAlign: 'center', padding: 30 }}>
            Aucune catégorie. Clique sur « Nouvelle catégorie » pour commencer.
          </div>
        ) : sortedCats.map(cat => {
          const catModules = (modulesByCat[cat.id] || []);
          const subCats = sousCategoriesByCat[cat.id] || [];
          const nbInter = interParCategorie[cat.id] || 0;
          const isExpanded = expanded[cat.id];
          const isEmpty = catModules.length === 0 && nbInter === 0;
          return (
            <div key={cat.id} style={{ borderTop: '1px solid var(--bg-alt)' }}>
              {/* Ligne CATÉGORIE */}
              <div className="flex-between" style={{ padding: '10px 4px', alignItems: 'center', gap: 8 }}>
                <div className="flex gap-8" style={{ alignItems: 'center', flex: 1, minWidth: 0 }}>
                  <span onClick={() => toggleExpand(cat.id)}
                    style={{ cursor: 'pointer', display: 'inline-block', transition: 'transform 0.15s', transform: isExpanded ? 'rotate(90deg)' : 'none', color: 'var(--navy)' }}>
                    <Icon name="chevronRight" size={14} />
                  </span>
                  {editingCat === cat.id ? (
                    <input type="text" autoFocus value={editCatText}
                      onChange={e => setEditCatText(e.target.value)}
                      onBlur={() => saveEditCat(cat.id)}
                      onKeyDown={e => { if (e.key === 'Enter') saveEditCat(cat.id); if (e.key === 'Escape') setEditingCat(null); }}
                      style={{ flex: 1, maxWidth: 360 }} />
                  ) : (
                    <span onDoubleClick={() => startEditCat(cat)}
                      onClick={() => toggleExpand(cat.id)}
                      style={{ fontWeight: 600, color: 'var(--navy)', cursor: 'pointer', userSelect: 'none' }}>
                      {cat.label}
                    </span>
                  )}
                </div>
                <div className="flex gap-8" style={{ alignItems: 'center' }}>
                  <span className="text-xs" style={{ color: isEmpty ? 'var(--danger)' : 'var(--text-muted)' }}>
                    {subCats.length} sous-cat · {catModules.length} module{catModules.length > 1 ? 's' : ''} · {nbInter} noté{nbInter > 1 ? 's' : ''}
                  </span>
                  <button className="btn btn-ghost btn-sm" title="Renommer" onClick={() => startEditCat(cat)}>
                    <Icon name="edit" size={12} />
                  </button>
                  <button className="btn btn-ghost btn-sm" title="Supprimer définitivement"
                    style={{ color: 'var(--danger)' }} onClick={() => askDeleteCat(cat)}>
                    <Icon name="x" size={12} />
                  </button>
                </div>
              </div>

              {/* Sous-catégories (déplié) */}
              {isExpanded && (
                <div style={{ padding: '4px 0 12px 24px', background: 'var(--bg-alt)' }}>
                  {subCats.length === 0 && addingSubFor !== cat.id && (
                    <div className="text-xs text-muted" style={{ padding: '6px 12px' }}>
                      Aucune sous-catégorie. Clique sur « Ajouter une sous-catégorie ».
                    </div>
                  )}

                  {subCats.map(sub => {
                    const subModules = (modulesBySousCat[sub.id] || []).slice().sort((a, b) => (a.ordre || 0) - (b.ordre || 0));
                    const isSubExpanded = expandedSub[sub.id];
                    const isDropTarget = dropTargetSub === sub.id && dragModule && dragModule.sous_categorie_id !== sub.id;
                    return (
                      <div key={sub.id}
                        onDragOver={(e) => onDragOver(e, sub.id)}
                        onDragLeave={onDragLeave}
                        onDrop={(e) => onDrop(e, sub.id)}
                        style={{
                          borderTop: '1px dashed var(--border)',
                          background: isDropTarget ? 'var(--cyan-light)' : 'transparent',
                          outline: isDropTarget ? '2px dashed var(--cyan)' : 'none',
                          outlineOffset: -2,
                          transition: 'background 0.1s',
                        }}>
                        {/* Ligne SOUS-CATÉGORIE */}
                        <div className="flex-between" style={{ padding: '6px 12px', alignItems: 'center', gap: 8 }}>
                          <div className="flex gap-8" style={{ alignItems: 'center', flex: 1, minWidth: 0 }}>
                            <span onClick={() => toggleExpandSub(sub.id)}
                              style={{ cursor: 'pointer', transition: 'transform 0.15s', transform: isSubExpanded ? 'rotate(90deg)' : 'none', color: 'var(--text-muted)' }}>
                              <Icon name="chevronRight" size={12} />
                            </span>
                            {editingSub === sub.id ? (
                              <input type="text" autoFocus value={editSubText}
                                onChange={e => setEditSubText(e.target.value)}
                                onBlur={() => saveEditSub(sub.id)}
                                onKeyDown={e => { if (e.key === 'Enter') saveEditSub(sub.id); if (e.key === 'Escape') setEditingSub(null); }}
                                style={{ flex: 1, maxWidth: 320, fontSize: 13 }} />
                            ) : (
                              <span onDoubleClick={() => startEditSub(sub)}
                                onClick={() => toggleExpandSub(sub.id)}
                                style={{
                                  fontWeight: 500,
                                  color: sub.label === 'Général' ? 'var(--text-muted)' : 'var(--navy)',
                                  fontSize: 13,
                                  fontStyle: sub.label === 'Général' ? 'italic' : 'normal',
                                  cursor: 'pointer', userSelect: 'none',
                                }}>
                                {sub.label}
                              </span>
                            )}
                          </div>
                          <div className="flex gap-8" style={{ alignItems: 'center' }}>
                            <span className="text-xs text-muted">
                              {subModules.length} module{subModules.length > 1 ? 's' : ''}
                            </span>
                            <button className="btn btn-ghost btn-sm" style={{ padding: '2px 6px' }} title="Renommer" onClick={() => startEditSub(sub)}>
                              <Icon name="edit" size={11} />
                            </button>
                            {sub.label !== 'Général' && (
                              <button className="btn btn-ghost btn-sm" style={{ padding: '2px 6px', color: 'var(--danger)' }}
                                title="Supprimer (les modules iront vers Général)"
                                onClick={() => askDeleteSub(sub)}>
                                <Icon name="x" size={11} />
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Modules de la sous-catégorie (dépliés) */}
                        {isSubExpanded && (
                          <div style={{ padding: '0 0 6px 28px', background: '#fff' }}>
                            {subModules.length === 0 && addingModFor !== sub.id && (
                              <div className="text-xs text-muted" style={{ padding: '4px 0', fontStyle: 'italic' }}>
                                Glisse un module ici, ou ajoutes-en un nouveau.
                              </div>
                            )}
                            {subModules.map(mod => (
                              <div key={mod.id} className="flex-between"
                                draggable={true}
                                onDragStart={(e) => onDragStart(e, mod)}
                                onDragEnd={onDragEnd}
                                style={{
                                  padding: '4px 12px 4px 4px', alignItems: 'center',
                                  cursor: 'grab',
                                  opacity: dragModule?.id === mod.id ? 0.35 : 1,
                                  borderRadius: 4,
                                }}>
                                <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                                  <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>⋮⋮</span>
                                  {editingMod === mod.id ? (
                                    <input type="text" autoFocus value={editModText}
                                      onChange={e => setEditModText(e.target.value)}
                                      onBlur={() => saveEditMod(mod.id)}
                                      onKeyDown={e => { if (e.key === 'Enter') saveEditMod(mod.id); if (e.key === 'Escape') setEditingMod(null); }}
                                      style={{ width: '100%', maxWidth: 460, fontSize: 13 }} />
                                  ) : (
                                    <span className="text-sm"
                                      onDoubleClick={() => startEditMod(mod)}
                                      style={{ cursor: 'text', userSelect: 'none' }}>
                                      {mod.label}
                                    </span>
                                  )}
                                </div>
                                <div className="flex gap-4">
                                  <button className="btn btn-ghost btn-sm" style={{ padding: '2px 6px' }} title="Renommer" onClick={() => startEditMod(mod)}>
                                    <Icon name="edit" size={11} />
                                  </button>
                                  <button className="btn btn-ghost btn-sm" style={{ padding: '2px 6px', color: 'var(--danger)' }} title="Supprimer définitivement"
                                    onClick={() => askDeleteMod(mod, cat.label)}>
                                    <Icon name="x" size={11} />
                                  </button>
                                </div>
                              </div>
                            ))}

                            {/* Ajout de module */}
                            {addingModFor === sub.id ? (
                              <div className="flex gap-8" style={{ padding: '6px 4px', alignItems: 'center' }}>
                                <input type="text" placeholder="Nom du module" autoFocus value={newModText}
                                  onChange={e => setNewModText(e.target.value)}
                                  onKeyDown={e => { if (e.key === 'Enter') addMod(sub.id); if (e.key === 'Escape') setAddingModFor(null); }}
                                  style={{ flex: 1, maxWidth: 460 }} />
                                <button className="btn btn-primary btn-sm" onClick={() => addMod(sub.id)}>
                                  <Icon name="check" size={11} />
                                </button>
                                <button className="btn btn-ghost btn-sm" onClick={() => setAddingModFor(null)}>Annuler</button>
                              </div>
                            ) : (
                              <div style={{ padding: '4px 0' }}>
                                <button className="btn btn-ghost btn-sm" style={{ fontSize: 11 }} onClick={() => startAddMod(sub.id)}>
                                  <Icon name="plus" size={11} /> Ajouter un module
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {/* Ajout d'une sous-catégorie */}
                  {addingSubFor === cat.id ? (
                    <div className="flex gap-8" style={{ padding: '8px 12px', alignItems: 'center' }}>
                      <input type="text" placeholder="Nom de la sous-catégorie" autoFocus value={newSubText}
                        onChange={e => setNewSubText(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') addSub(cat.id); if (e.key === 'Escape') setAddingSubFor(null); }}
                        style={{ flex: 1, maxWidth: 360 }} />
                      <button className="btn btn-primary btn-sm" onClick={() => addSub(cat.id)}>
                        <Icon name="check" size={11} />
                      </button>
                      <button className="btn btn-ghost btn-sm" onClick={() => setAddingSubFor(null)}>Annuler</button>
                    </div>
                  ) : (
                    <div style={{ padding: '8px 12px' }}>
                      <button className="btn btn-ghost btn-sm" style={{ fontSize: 11 }} onClick={() => startAddSub(cat.id)}>
                        <Icon name="plus" size={11} /> Ajouter une sous-catégorie
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* TARIFICATION (info) */}
      <div className="card mt-24">
        <div className="card-title">Tarification</div>
        <div className="text-sm text-muted mb-16">
          Une journée d’intervention dure <strong>{window.HEURES_PAR_JOUR}h</strong> (paramétrable dans le fichier config.js).
          TJM = taux horaire × {window.HEURES_PAR_JOUR}.
        </div>
        <div style={{ padding: '12px 14px', background: 'var(--cyan-light)', borderRadius: 8, display: 'inline-block' }}>
          <span className="text-sm">Exemple — 75 €/h → TJM <strong>{fmtEur(calcTJM(75))}</strong> · ½ j <strong>{fmtEur(calcDemiJournee(75))}</strong></span>
        </div>
      </div>

      {/* MODALE : suppression d'une sous-catégorie */}
      {deleteSubModal && (
        <div className="modal-backdrop" onClick={() => setDeleteSubModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 460 }}>
            <div className="modal-head">
              <h3 style={{ color: 'var(--danger)' }}>Supprimer la sous-catégorie</h3>
              <div className="modal-close" onClick={() => setDeleteSubModal(null)}><Icon name="x" size={16} /></div>
            </div>
            <div className="text-sm" style={{ marginBottom: 12 }}>
              Tu vas supprimer la sous-catégorie <strong>{deleteSubModal.label}</strong>.
            </div>
            {deleteSubModal.nbModules > 0 ? (
              <div className="text-sm" style={{ background: '#fff8e5', padding: '10px 12px', borderRadius: 6, marginBottom: 16, color: '#856404' }}>
                ⓘ Les <strong>{deleteSubModal.nbModules} module{deleteSubModal.nbModules > 1 ? 's' : ''}</strong> qui y sont rattaché{deleteSubModal.nbModules > 1 ? 's seront déplacés' : ' sera déplacé'} automatiquement vers la sous-catégorie <strong>Général</strong> de la même catégorie. Aucune perte de donnée.
              </div>
            ) : (
              <div className="text-sm text-muted" style={{ marginBottom: 16 }}>
                Aucun module rattaché à cette sous-catégorie.
              </div>
            )}
            <div className="modal-foot">
              <button className="btn btn-ghost" onClick={() => setDeleteSubModal(null)}>Annuler</button>
              <button className="btn btn-primary" style={{ background: 'var(--danger)' }} onClick={confirmDeleteSub}>
                Supprimer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODALE : suppression définitive d'une catégorie */}
      {deleteCatModal && (
        <div className="modal-backdrop" onClick={() => setDeleteCatModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 500 }}>
            <div className="modal-head">
              <h3 style={{ color: 'var(--danger)' }}>Supprimer la catégorie</h3>
              <div className="modal-close" onClick={() => setDeleteCatModal(null)}><Icon name="x" size={16} /></div>
            </div>
            <div className="text-sm" style={{ marginBottom: 12 }}>
              Tu vas supprimer <strong>{deleteCatModal.label}</strong> et tout ce qui y est rattaché :
            </div>
            <ul style={{ background: '#ffe4e4', padding: '10px 12px 10px 32px', borderRadius: 6, marginBottom: 16, color: 'var(--danger)', fontSize: 13 }}>
              <li><strong>{deleteCatModal.nbModules}</strong> module{deleteCatModal.nbModules > 1 ? 's' : ''} de cette catégorie</li>
              <li><strong>{deleteCatModal.nbNotes}</strong> intervenant{deleteCatModal.nbNotes > 1 ? 's' : ''} noté{deleteCatModal.nbNotes > 1 ? 's' : ''} dans cette catégorie (toutes les notes seront perdues)</li>
              {deleteCatModal.nbModules > 0 && <li>Les créneaux du programme-type rattachés à ces modules deviendront « sans module assigné »</li>}
            </ul>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--danger)', marginBottom: 12 }}>⚠ Cette action est irréversible.</div>
            <div className="field">
              <div className="label">Pour confirmer, tape le nom : <strong>{deleteCatModal.label}</strong></div>
              <input value={deleteCatConfirm} onChange={e => setDeleteCatConfirm(e.target.value)}
                placeholder={deleteCatModal.label} autoFocus />
            </div>
            <div className="modal-foot">
              <button className="btn btn-ghost" onClick={() => setDeleteCatModal(null)}>Annuler</button>
              <button className="btn btn-primary"
                disabled={deleteCatConfirm.trim() !== deleteCatModal.label}
                style={deleteCatConfirm.trim() === deleteCatModal.label ? { background: 'var(--danger)' } : {}}
                onClick={confirmDeleteCat}>
                Supprimer définitivement
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODALE : suppression définitive d'un module */}
      {deleteModModal && (
        <div className="modal-backdrop" onClick={() => setDeleteModModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 460 }}>
            <div className="modal-head">
              <h3 style={{ color: 'var(--danger)' }}>Supprimer le module</h3>
              <div className="modal-close" onClick={() => setDeleteModModal(null)}><Icon name="x" size={16} /></div>
            </div>
            <div className="text-sm" style={{ marginBottom: 12 }}>
              Tu vas supprimer le module <strong>{deleteModModal.label}</strong> (catégorie <em>{deleteModModal.categorieLabel}</em>).
            </div>
            <div className="text-sm" style={{ background: '#fff8e5', padding: '10px 12px', borderRadius: 6, marginBottom: 16 }}>
              Les créneaux du programme-type qui utilisaient ce module deviendront « sans module assigné ». Tu pourras les ré-assigner depuis l'écran Programme-type.
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--danger)', marginBottom: 12 }}>⚠ Cette action est irréversible.</div>
            <div className="field">
              <div className="label">Pour confirmer, tape le nom : <strong>{deleteModModal.label}</strong></div>
              <input value={deleteModConfirm} onChange={e => setDeleteModConfirm(e.target.value)}
                placeholder={deleteModModal.label} autoFocus />
            </div>
            <div className="modal-foot">
              <button className="btn btn-ghost" onClick={() => setDeleteModModal(null)}>Annuler</button>
              <button className="btn btn-primary"
                disabled={deleteModConfirm.trim() !== deleteModModal.label}
                style={deleteModConfirm.trim() === deleteModModal.label ? { background: 'var(--danger)' } : {}}
                onClick={confirmDeleteMod}>
                Supprimer définitivement
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
