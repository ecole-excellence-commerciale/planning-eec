// ============================================================
// PROMOS — instances concrètes d'un programme-type
// ============================================================
// Liste, création (assistant en 3 étapes), édition du calendrier
// d'alternance (sélection visuelle des semaines sur un mini-calendrier).

const PagePromos = ({ data, onReload }) => {
  const toast = useToast();
  const { niveaux, programmes, promos } = data;
  const [view, setView] = useState({ kind: 'list' });
  // view.kind = 'list' | 'create' | 'edit' avec view.promoId

  if (view.kind === 'create') {
    return <PromoCreateOrEdit
      data={data}
      onCancel={() => setView({ kind: 'list' })}
      onDone={() => { setView({ kind: 'list' }); onReload(); }}
    />;
  }
  if (view.kind === 'edit') {
    return <PromoCreateOrEdit
      data={data}
      promoId={view.promoId}
      onCancel={() => setView({ kind: 'list' })}
      onDone={() => { setView({ kind: 'list' }); onReload(); }}
    />;
  }

  // VUE LISTE
  const niveauById = Object.fromEntries(niveaux.map(n => [n.id, n]));
  const programmeById = Object.fromEntries(programmes.map(p => [p.id, p]));

  const archiverPromo = async (p) => {
    if (!confirm(`Archiver « ${p.label} » ?\n\nLa promo disparaît de la liste mais son planning est conservé.`)) return;
    try {
      await db.archivePromo(p.id);
      toast('Promo archivée', 'success'); onReload();
    } catch (e) { toast(e.message, 'error'); }
  };

  return (
    <div className="page-content">
      <div className="page-header">
        <div>
          <div className="breadcrumb">GESTION</div>
          <h1 className="page-title display-dot">Promos</h1>
          <div className="page-subtitle">Promotions concrètes avec leur calendrier d'alternance</div>
        </div>
        <button className="btn btn-primary" onClick={() => setView({ kind: 'create' })}>
          <Icon name="plus" /> Nouvelle promo
        </button>
      </div>

      {promos.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 40 }}>
          <div className="text-muted mb-16">
            Aucune promo créée. Une promo est une instance concrète d'un programme-type
            (par ex. « Promo Bac+2 A · Septembre 2026 »).
          </div>
          <button className="btn btn-primary" onClick={() => setView({ kind: 'create' })}>
            <Icon name="plus" size={14} /> Créer la première promo
          </button>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Promo</th>
                <th>Niveau</th>
                <th>Programme</th>
                <th>Période</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {promos.map(p => {
                const niv = niveauById[p.niveau_id];
                const prog = programmeById[p.programme_type_id];
                return (
                  <tr key={p.id} onClick={() => setView({ kind: 'edit', promoId: p.id })}>
                    <td>
                      <div className="td-name">{p.label}</div>
                    </td>
                    <td>
                      {niv && <span className={'chip ' + niv.couleur}>{niv.label}</span>}
                    </td>
                    <td>
                      <span className="text-sm text-muted">{prog?.label || '—'}</span>
                    </td>
                    <td className="text-sm">
                      {p.date_debut && new Date(p.date_debut + 'T00:00:00').toLocaleDateString('fr-FR')}
                      {' → '}
                      {p.date_fin && new Date(p.date_fin + 'T00:00:00').toLocaleDateString('fr-FR')}
                    </td>
                    <td onClick={e => e.stopPropagation()}>
                      <button className="btn btn-ghost btn-sm" onClick={() => archiverPromo(p)} title="Archiver">
                        <Icon name="x" size={12} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

// ============================================================
// CRÉATION / ÉDITION d'une promo
// ============================================================
// Si promoId est passé : mode édition (charge la promo existante)
// Sinon : mode création (formulaire vide)

const PromoCreateOrEdit = ({ data, promoId, onCancel, onDone }) => {
  const toast = useToast();
  const { niveaux, programmes } = data;
  const isEdit = !!promoId;

  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [label, setLabel] = useState('');
  const [niveauId, setNiveauId] = useState(niveaux[0]?.id || '');
  // Le programme-type est déduit du niveau (un seul par niveau)
  const programmeForNiveau = programmes.find(p => p.niveau_id === niveauId);
  const programmeTypeId = programmeForNiveau?.id || '';

  // Semaines sélectionnées (ISO strings de lundis)
  const [semainesSelectees, setSemainesSelectees] = useState([]);

  // Mois en cours d'affichage dans le calendrier (par défaut : septembre 2026)
  const [moisAffichage, setMoisAffichage] = useState(() => {
    const d = new Date(2026, 8, 1); // 8 = septembre (0-indexed)
    return d;
  });

  // Modale de suppression définitive
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');

  // Charger la promo si édition
  useEffect(() => {
    if (!isEdit) return;
    (async () => {
      try {
        const promo = await db.getPromo(promoId);
        setLabel(promo.label);
        setNiveauId(promo.niveau_id);
        const semaines = await db.getPromoSemaines(promoId);
        setSemainesSelectees(semaines);
        // Positionner le calendrier sur la date de début
        if (promo.date_debut) {
          const d = new Date(promo.date_debut + 'T00:00:00');
          setMoisAffichage(new Date(d.getFullYear(), d.getMonth(), 1));
        }
      } catch (e) {
        toast(e.message || 'Erreur de chargement', 'error');
      } finally {
        setLoading(false);
      }
    })();
  }, [promoId]);

  // ---- Toggle d'une semaine ----
  const toggleSemaine = (lundiISO) => {
    setSemainesSelectees(prev => {
      if (prev.includes(lundiISO)) return prev.filter(d => d !== lundiISO);
      return [...prev, lundiISO].sort();
    });
  };

  // ---- Navigation calendrier ----
  const moisSuivant = () => setMoisAffichage(d => new Date(d.getFullYear(), d.getMonth() + 1, 1));
  const moisPrecedent = () => setMoisAffichage(d => new Date(d.getFullYear(), d.getMonth() - 1, 1));

  // ---- Save ----
  const handleSave = async () => {
    if (!label.trim()) { toast('Le nom de la promo est obligatoire', 'error'); return; }
    if (!niveauId) { toast('Choisis un niveau', 'error'); return; }
    if (!programmeTypeId) { toast('Aucun programme-type n\'existe pour ce niveau. Crée-en un dans l\'écran Programme.', 'error'); return; }
    if (semainesSelectees.length === 0) { toast('Sélectionne au moins une semaine de cours', 'error'); return; }

    setSaving(true);
    try {
      if (isEdit) {
        await db.renamePromo(promoId, label.trim());
        await db.updatePromoCalendrier(promoId, programmeTypeId, semainesSelectees);
        toast('Promo mise à jour', 'success');
      } else {
        await db.addPromo({
          niveauId, programmeTypeId,
          label: label.trim(),
          dateDebut: semainesSelectees[0],
          semaines: semainesSelectees,
        });
        toast('Promo créée', 'success');
      }
      onDone();
    } catch (e) {
      console.error(e);
      toast(e.message || 'Erreur lors de la sauvegarde', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    try {
      await db.deletePromo(promoId);
      toast('Promo supprimée', 'success');
      onDone();
    } catch (e) { toast(e.message || 'Erreur', 'error'); }
  };

  if (loading) {
    return <div className="page-content"><div className="text-muted">Chargement de la promo…</div></div>;
  }

  // ---- Construction du mini-calendrier (4 mois affichés à la fois) ----
  const moisAffiches = [];
  for (let i = 0; i < 4; i++) {
    moisAffiches.push(new Date(moisAffichage.getFullYear(), moisAffichage.getMonth() + i, 1));
  }

  return (
    <div className="page-content">
      <div className="page-header">
        <div>
          <div className="breadcrumb">
            <a onClick={onCancel} style={{ cursor: 'pointer' }}>Promos</a> <span className="sep">›</span> {isEdit ? 'Modifier' : 'Nouvelle promo'}
          </div>
          <h1 className="page-title display-dot">{isEdit ? label || 'Modifier la promo' : 'Nouvelle promo'}</h1>
          <div className="page-subtitle">{isEdit ? 'Édition de la promo et de son calendrier' : 'Création d\'une nouvelle promotion'}</div>
        </div>
        <button className="btn btn-ghost" onClick={onCancel}><Icon name="arrowLeft" /> Retour</button>
      </div>

      <div className="grid-2-1">
        {/* COLONNE GAUCHE : sélection des semaines */}
        <div>
          <div className="card mb-16">
            <div className="flex-between mb-16" style={{ alignItems: 'center' }}>
              <div className="card-title" style={{ marginBottom: 0 }}>Calendrier d'alternance</div>
              <div className="flex gap-8" style={{ alignItems: 'center' }}>
                <button className="btn btn-ghost btn-sm" onClick={moisPrecedent}>‹</button>
                <span className="text-sm" style={{ minWidth: 200, textAlign: 'center', fontWeight: 600, color: 'var(--navy)' }}>
                  {moisAffichage.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}
                  {' → '}
                  {moisAffiches[3].toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}
                </span>
                <button className="btn btn-ghost btn-sm" onClick={moisSuivant}>›</button>
              </div>
            </div>

            <div className="text-sm text-muted mb-16">
              Coche les semaines où la promo est en cours. La 1ère semaine cochée devient la semaine pédagogique #1 du programme-type, la 2ème devient la #2, etc.
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
              {moisAffiches.map((m, idx) => (
                <MiniMois key={idx}
                  mois={m}
                  semainesSelectees={semainesSelectees}
                  onToggle={toggleSemaine}
                />
              ))}
            </div>
          </div>

          {/* Récap des semaines sélectionnées */}
          <div className="card">
            <div className="card-title">
              Semaines sélectionnées <span className="chip cyan" style={{ marginLeft: 8 }}>{semainesSelectees.length}</span>
            </div>
            {semainesSelectees.length === 0 ? (
              <div className="text-sm text-muted" style={{ padding: '12px 0', textAlign: 'center' }}>
                Aucune semaine. Coche les semaines de cours dans le calendrier ci-dessus.
              </div>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {semainesSelectees.map((lundiISO, idx) => {
                  const d = new Date(lundiISO + 'T00:00:00');
                  const ven = new Date(d.getTime() + 4 * 86400000);
                  return (
                    <span key={lundiISO} className="chip" style={{ background: 'var(--cyan-light)', color: 'var(--navy)', padding: '4px 10px', fontSize: 11 }}>
                      <strong>S{String(idx + 1).padStart(2, '0')}</strong>{' '}
                      {d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })}
                      {' → '}
                      {ven.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })}
                      <span style={{ marginLeft: 6, cursor: 'pointer', opacity: 0.6 }} onClick={() => toggleSemaine(lundiISO)}>×</span>
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* COLONNE DROITE : infos générales */}
        <div>
          <div className="card mb-16">
            <div className="card-title">Informations</div>
            <div className="field">
              <div className="label">Nom de la promo *</div>
              <input type="text" value={label} onChange={e => setLabel(e.target.value)}
                placeholder="Ex. Promo Bac+2 A · Sept 2026" />
            </div>
            <div className="field">
              <div className="label">Niveau *</div>
              <select value={niveauId} onChange={e => setNiveauId(e.target.value)} disabled={isEdit}>
                {niveaux.map(n => <option key={n.id} value={n.id}>{n.label}</option>)}
              </select>
              {isEdit && <div className="help">Le niveau ne peut pas être changé après création.</div>}
            </div>
            <div className="field">
              <div className="label">Programme-type associé</div>
              {programmeForNiveau ? (
                <div style={{ padding: '8px 12px', background: 'var(--cyan-light)', borderRadius: 6, fontSize: 13 }}>
                  {programmeForNiveau.label}
                </div>
              ) : (
                <div style={{ padding: '8px 12px', background: '#ffe4e4', borderRadius: 6, fontSize: 13, color: 'var(--danger)' }}>
                  Aucun programme-type pour ce niveau. Crée-en un dans l'écran « Programme » avant de continuer.
                </div>
              )}
            </div>
            {semainesSelectees.length > 0 && programmeForNiveau && (
              <div className="field">
                <div className="label">Période</div>
                <div className="text-sm">
                  Du <strong>{new Date(semainesSelectees[0] + 'T00:00:00').toLocaleDateString('fr-FR')}</strong>{' '}
                  au <strong>{new Date(new Date(semainesSelectees[semainesSelectees.length - 1] + 'T00:00:00').getTime() + 4 * 86400000).toLocaleDateString('fr-FR')}</strong>
                </div>
                <div className="help">
                  {semainesSelectees.length < programmeForNiveau.nombre_semaines && (
                    <span style={{ color: 'var(--danger)' }}>
                      ⚠ {semainesSelectees.length} semaine(s) cochée(s) pour un programme de {programmeForNiveau.nombre_semaines} semaines. Les semaines pédagogiques au-delà ne seront pas déroulées.
                    </span>
                  )}
                  {semainesSelectees.length === programmeForNiveau.nombre_semaines && (
                    <span style={{ color: 'var(--success)' }}>✓ Nombre de semaines cohérent avec le programme.</span>
                  )}
                  {semainesSelectees.length > programmeForNiveau.nombre_semaines && (
                    <span style={{ color: 'var(--danger)' }}>
                      ⚠ {semainesSelectees.length} semaines cochées pour un programme de seulement {programmeForNiveau.nombre_semaines}. Les semaines supplémentaires seront ignorées.
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="flex gap-8" style={{ justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost" onClick={onCancel}>Annuler</button>
            <button className="btn btn-primary" disabled={saving || !programmeTypeId} onClick={handleSave}>
              <Icon name="check" size={12} /> {saving ? 'Enregistrement…' : (isEdit ? 'Mettre à jour' : 'Créer la promo')}
            </button>
          </div>

          {isEdit && (
            <div className="card mt-24">
              <div className="card-title" style={{ color: 'var(--danger)' }}>Zone dangereuse</div>
              <div className="text-sm text-muted mb-16">
                Supprimer cette promo effacera <strong>toutes les assignations d'intervenants</strong> sur son planning.
                Cette action est irréversible.
              </div>
              <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }}
                onClick={() => { setShowDeleteConfirm(true); setDeleteConfirmText(''); }}>
                Supprimer définitivement…
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Modale de suppression */}
      {showDeleteConfirm && (
        <div className="modal-backdrop" onClick={() => setShowDeleteConfirm(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 460 }}>
            <div className="modal-head">
              <h3 style={{ color: 'var(--danger)' }}>Suppression définitive</h3>
              <div className="modal-close" onClick={() => setShowDeleteConfirm(false)}><Icon name="x" size={16} /></div>
            </div>
            <div className="text-sm" style={{ marginBottom: 12 }}>
              Tu vas supprimer <strong>{label}</strong> et tout son planning.
            </div>
            <div style={{ background: '#ffe4e4', padding: 10, borderRadius: 6, marginBottom: 16, color: 'var(--danger)', fontSize: 13 }}>
              ⚠ Cette action est irréversible. Toutes les assignations d'intervenants seront perdues.
            </div>
            <div className="field">
              <div className="label">Pour confirmer, tape le nom : <strong>{label}</strong></div>
              <input value={deleteConfirmText} onChange={e => setDeleteConfirmText(e.target.value)} placeholder={label} autoFocus />
            </div>
            <div className="modal-foot">
              <button className="btn btn-ghost" onClick={() => setShowDeleteConfirm(false)}>Annuler</button>
              <button className="btn btn-primary"
                disabled={deleteConfirmText.trim() !== label}
                style={deleteConfirmText.trim() === label ? { background: 'var(--danger)' } : {}}
                onClick={handleDelete}>
                Supprimer définitivement
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ============================================================
// MINI-CALENDRIER MENSUEL avec cases SEMAINES cliquables
// ============================================================
// Affiche un mois en grille L-D, où chaque LIGNE = une semaine cliquable
// (= toute la semaine est cochée d'un coup).

const MiniMois = ({ mois, semainesSelectees, onToggle }) => {
  // Calculer le premier jour du mois et la grille
  const year = mois.getFullYear();
  const month = mois.getMonth(); // 0-indexed
  const premier = new Date(year, month, 1);
  // Trouver le lundi de la semaine du 1er
  const dow = premier.getDay() === 0 ? 7 : premier.getDay();
  const debutGrille = new Date(year, month, 1 - (dow - 1));

  // Construire 6 semaines × 7 jours (max)
  const semaines = [];
  for (let s = 0; s < 6; s++) {
    const sem = [];
    for (let d = 0; d < 7; d++) {
      const date = new Date(debutGrille.getTime() + (s * 7 + d) * 86400000);
      sem.push(date);
    }
    semaines.push(sem);
  }

  // Filtrer : garder une semaine si elle contient au moins 1 jour du mois courant
  const semainesAffichees = semaines.filter(sem => sem.some(d => d.getMonth() === month));

  const today = new Date();

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
      <div style={{ background: 'var(--navy)', color: 'var(--cyan)', padding: '8px 12px', fontSize: 11, fontWeight: 700, textAlign: 'center', textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {mois.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
        <thead>
          <tr style={{ background: 'var(--bg-alt)' }}>
            {['L','M','M','J','V','S','D'].map((j, i) => (
              <th key={i} style={{ padding: '4px 0', textAlign: 'center', fontWeight: 600, color: 'var(--text-muted)' }}>{j}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {semainesAffichees.map((sem, sIdx) => {
            const lundi = sem[0];
            const lundiISO = isoDate(lundi);
            const isSelected = semainesSelectees.includes(lundiISO);
            return (
              <tr key={sIdx}
                onClick={() => onToggle(lundiISO)}
                style={{
                  cursor: 'pointer',
                  background: isSelected ? 'var(--cyan)' : 'transparent',
                  transition: 'background 0.1s',
                }}
                onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = 'var(--cyan-light)'; }}
                onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = 'transparent'; }}>
                {sem.map((day, dIdx) => {
                  const dansMois = day.getMonth() === month;
                  const estWeekend = dIdx >= 5;
                  const estAujourdhui = day.toDateString() === today.toDateString();
                  return (
                    <td key={dIdx} style={{
                      padding: '5px 0', textAlign: 'center',
                      color: !dansMois ? 'var(--border)' : estWeekend ? 'var(--text-muted)' : (isSelected ? 'var(--navy)' : 'var(--text)'),
                      fontWeight: estAujourdhui ? 700 : (isSelected ? 600 : 400),
                      fontSize: 11,
                      border: estAujourdhui ? '1px solid var(--navy)' : 'none',
                      borderRadius: estAujourdhui ? 3 : 0,
                    }}>
                      {day.getDate()}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
