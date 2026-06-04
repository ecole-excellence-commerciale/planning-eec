// ============================================================
// PLANNING — vue consolidée du planning d'une promo
// ============================================================
// Affiche le planning concret d'une promo (programme-type déroulé sur les
// vraies dates), avec édition locale possible (changer un module pour cette
// promo seulement, sans toucher au programme-type).

const PLANNING_JOURS_LABELS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi'];

// Réutilise la fonction de coloration des catégories de admin-programme.js
// Si déjà définie globalement, on l'utilise; sinon on en fait une copie.
const couleurCat = (typeof couleurCategorie !== 'undefined') ? couleurCategorie : (label) => {
  if (!label) return { bg: '#f5f5f7', fg: '#666', border: '#ddd' };
  let hash = 0;
  for (let i = 0; i < label.length; i++) hash = (hash * 31 + label.charCodeAt(i)) | 0;
  const hue = Math.abs(hash) % 360;
  return {
    bg: `hsl(${hue}, 70%, 92%)`,
    fg: `hsl(${hue}, 55%, 28%)`,
    border: `hsl(${hue}, 50%, 75%)`,
  };
};

const PagePlanning = ({ data, onReload }) => {
  const toast = useToast();
  const { promos, niveaux, categories, modules, intervenants, campagne } = data;

  // Sélection de la promo (par défaut la 1ère)
  const [selectedPromoId, setSelectedPromoId] = useState(() => promos[0]?.id || null);
  const promo = promos.find(p => p.id === selectedPromoId) || null;
  const niveau = promo ? niveaux.find(n => n.id === promo.niveau_id) : null;

  // Chargement du planning + assignations inter-promos (pour détecter les conflits)
  const [planning, setPlanning] = useState([]);
  const [assignationsAutres, setAssignationsAutres] = useState([]); // {intervenant_id, promo_id, date_jour, periode}
  const [disposIntervenants, setDisposIntervenants] = useState([]); // dispos campagne actuelle
  const [loadingPlanning, setLoadingPlanning] = useState(false);

  // Recharger le planning d'une promo + assignations + dispos
  const loadPlanningEtAssignations = async (promoId) => {
    if (!promoId) { setPlanning([]); setAssignationsAutres([]); return; }
    setLoadingPlanning(true);
    try {
      const [p, autres] = await Promise.all([
        db.getPromoPlanning(promoId),
        // Toutes les assignations d'intervenants sur une fenêtre large (couvre toutes les promos)
        db.getAssignationsPeriode('2024-01-01', '2030-12-31'),
      ]);
      setPlanning(p);
      // Filtrer pour exclure les assignations de la promo en cours
      setAssignationsAutres(autres.filter(a => a.promo_id !== promoId));
    } catch (e) {
      console.error(e); toast('Erreur de chargement du planning', 'error');
    } finally {
      setLoadingPlanning(false);
    }
  };

  useEffect(() => {
    loadPlanningEtAssignations(promo?.id);
  }, [promo?.id]);

  // Charger les dispos de la campagne actuelle
  useEffect(() => {
    if (!campagne) { setDisposIntervenants([]); return; }
    db.getDisposCampagne(campagne.id)
      .then(setDisposIntervenants)
      .catch(e => console.error(e));
  }, [campagne?.id]);

  // État édition d'un créneau (modale)
  const [editing, setEditing] = useState(null);

  // État semaines dépliées : seule la 1ère est dépliée par défaut
  const [openSemaines, setOpenSemaines] = useState({});
  useEffect(() => {
    setOpenSemaines({ 1: true });
  }, [promo?.id]);

  const toggleSemaine = (num) => setOpenSemaines(s => ({ ...s, [num]: !s[num] }));

  // Index des modules/catégories/intervenants
  const moduleById = useMemo(() => Object.fromEntries(modules.map(m => [m.id, m])), [modules]);
  const categorieById = useMemo(() => Object.fromEntries(categories.map(c => [c.id, c])), [categories]);
  const intervenantById = useMemo(
    () => Object.fromEntries((intervenants || []).map(i => [i.id, i])),
    [intervenants]
  );
  const promoById = useMemo(() => Object.fromEntries(promos.map(p => [p.id, p])), [promos]);

  // ─── Sélection multiple pour affectation bulk ─────────────────────────
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedPlanningIds, setSelectedPlanningIds] = useState(new Set());
  const [bulkModalOpen, setBulkModalOpen] = useState(false);

  // Réinitialiser la sélection si on change de promo
  useEffect(() => {
    setSelectionMode(false);
    setSelectedPlanningIds(new Set());
    setBulkModalOpen(false);
  }, [promo?.id]);

  const toggleCellSelection = (planningId) => {
    if (!planningId) return; // on ne peut pas sélectionner une case sans entry
    setSelectedPlanningIds(prev => {
      const next = new Set(prev);
      if (next.has(planningId)) next.delete(planningId);
      else next.add(planningId);
      return next;
    });
  };

  const clearSelection = () => setSelectedPlanningIds(new Set());

  const exitSelectionMode = () => {
    setSelectionMode(false);
    setSelectedPlanningIds(new Set());
  };

  // Assignation en masse : applique le même intervenant à tous les créneaux sélectionnés
  const bulkAssignIntervenant = async (intervenantId) => {
    try {
      const ids = [...selectedPlanningIds];
      // Assignations en parallèle (Supabase gère les opérations concurrentes)
      await Promise.all(
        ids.map(pid => db.setPromoPlanningIntervenant(pid, intervenantId))
      );
      toast(
        intervenantId
          ? `${ids.length} créneau${ids.length > 1 ? 'x' : ''} affecté${ids.length > 1 ? 's' : ''}`
          : `Intervenant retiré sur ${ids.length} créneau${ids.length > 1 ? 'x' : ''}`,
        'success'
      );
      await loadPlanningEtAssignations(promo.id);
      setBulkModalOpen(false);
      exitSelectionMode();
    } catch (e) {
      console.error(e); toast(e.message || 'Erreur', 'error');
    }
  };

  // Détecter les conflits d'un créneau du planning courant :
  // un intervenant est en conflit s'il est aussi assigné à un créneau d'une autre
  // promo sur la même date×période.
  const conflitPour = (entry) => {
    if (!entry || !entry.intervenant_id) return null;
    const autresAffectations = assignationsAutres.filter(a =>
      a.intervenant_id === entry.intervenant_id &&
      a.date_jour === entry.date_jour &&
      a.periode === entry.periode
    );
    if (autresAffectations.length === 0) return null;
    // Récupérer les noms des promos en conflit
    const promosEnConflit = autresAffectations
      .map(a => promoById[a.promo_id]?.label)
      .filter(Boolean);
    return promosEnConflit;
  };

  // Helpers
  const findPlanningEntry = (semaineNum, dateJour, periode) =>
    planning.find(p => p.semaine_num === semaineNum && p.date_jour === dateJour && p.periode === periode);

  const moduleInfo = (moduleId) => {
    if (!moduleId) return null;
    const mod = moduleById[moduleId];
    if (!mod) return null;
    const cat = categorieById[mod.categorie_id];
    return { module: mod, categorie: cat, couleur: couleurCat(cat?.label) };
  };

  // Liste des semaines pédagogiques présentes dans ce planning
  const semainesPresentes = useMemo(() => {
    const set = new Set(planning.map(p => p.semaine_num));
    return Array.from(set).sort((a, b) => a - b);
  }, [planning]);

  // Pour chaque semaine, trouver le lundi (date réelle)
  const lundiBySemaine = useMemo(() => {
    const map = {};
    for (const p of planning) {
      if (map[p.semaine_num]) continue;
      // Calculer le lundi de la semaine de p.date_jour (heure locale)
      const d = new Date(p.date_jour + 'T00:00:00');
      const dow = d.getDay() === 0 ? 7 : d.getDay();
      const lundi = new Date(d.getTime() - (dow - 1) * 86400000);
      map[p.semaine_num] = isoDate(lundi);
    }
    return map;
  }, [planning]);

  // Résumé d'une semaine
  const resumeSemaine = (num) => {
    const cs = planning.filter(p => p.semaine_num === num);
    const remplis = cs.filter(p => p.module_id).length;
    const total = cs.length;
    const catCounts = {};
    cs.forEach(p => {
      const mod = moduleById[p.module_id];
      if (!mod) return;
      const cat = categorieById[mod.categorie_id];
      if (!cat) return;
      catCounts[cat.label] = (catCounts[cat.label] || 0) + 1;
    });
    const topCats = Object.entries(catCounts).sort((a, b) => b[1] - a[1]).slice(0, 3);
    return { remplis, total, topCats };
  };

  // Sauvegarde locale : update si entry existante, création si nouvelle case
  // Garde editing ouvert pour permettre d'enchaîner module → intervenant
  const saveModule = async (moduleId, keepOpen = false) => {
    if (!editing) return;
    try {
      let newPlanningId = editing.planningId;
      if (editing.planningId) {
        // Entry existante → update
        await db.setPromoPlanningModule(editing.planningId, moduleId);
      } else if (moduleId) {
        // Pas d'entry et on assigne un module → création
        const created = await db.addPromoPlanningEntry(
          promo.id, editing.semaineNum, editing.dateJour, editing.periode, moduleId
        );
        newPlanningId = created.id;
      } else {
        setEditing(null); return;
      }
      toast('Module enregistré', 'success');
      await loadPlanningEtAssignations(promo.id);
      // Si on enchaîne (UX intervenant), on reste sur la modale en MAJ l'editing
      if (keepOpen) {
        setEditing(prev => prev ? { ...prev, planningId: newPlanningId, currentModuleId: moduleId } : prev);
      } else {
        setEditing(null);
      }
    } catch (e) {
      console.error(e); toast(e.message || 'Erreur', 'error');
    }
  };

  // Assigner un intervenant à un créneau
  const saveIntervenant = async (intervenantId) => {
    if (!editing || !editing.planningId) return;
    try {
      await db.setPromoPlanningIntervenant(editing.planningId, intervenantId);
      toast(intervenantId ? 'Intervenant assigné' : 'Intervenant retiré', 'success');
      await loadPlanningEtAssignations(promo.id);
      setEditing(prev => prev ? { ...prev, currentIntervenantId: intervenantId } : prev);
    } catch (e) {
      console.error(e); toast(e.message || 'Erreur', 'error');
    }
  };

  // ─── Drag-and-drop : déplacer ou intervertir des créneaux ───────────────
  // dragging = info de la case source en cours de drag
  const [dragging, setDragging] = useState(null);
  // dragOverKey = clé "num-jour-periode" de la case actuellement survolée
  const [dragOverKey, setDragOverKey] = useState(null);

  const onDragStart = (e, src) => {
    if (!src.moduleId) { e.preventDefault(); return; }
    setDragging(src);
    e.dataTransfer.effectAllowed = 'move';
    // Mettre dans dataTransfer pour la compat navigateur
    try { e.dataTransfer.setData('text/plain', src.planningId || ''); } catch {}
  };
  const onDragEnd = () => { setDragging(null); setDragOverKey(null); };
  const onDragOver = (e, dstKey) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverKey !== dstKey) setDragOverKey(dstKey);
  };
  const onDragLeave = (e) => {
    // On ne reset que si on quitte vraiment la case (pas un enfant)
    if (e.currentTarget.contains(e.relatedTarget)) return;
    setDragOverKey(null);
  };
  const onDrop = async (e, dst) => {
    e.preventDefault();
    const src = dragging;
    setDragging(null);
    setDragOverKey(null);
    if (!src || !src.moduleId) return;
    // Même case → rien faire
    if (src.dateJour === dst.dateJour && src.periode === dst.periode) return;
    try {
      if (dst.planningId && dst.moduleId) {
        // Case cible occupée → SWAP des modules
        await db.setPromoPlanningModule(dst.planningId, src.moduleId);
        await db.setPromoPlanningModule(src.planningId, dst.moduleId);
        toast('Modules permutés', 'success');
      } else if (dst.planningId) {
        // Case cible existe mais vide → MOVE
        await db.setPromoPlanningModule(dst.planningId, src.moduleId);
        await db.setPromoPlanningModule(src.planningId, null);
        toast('Module déplacé', 'success');
      } else {
        // Case cible n'existe pas en base → CRÉATION + vidage source
        await db.addPromoPlanningEntry(
          promo.id, dst.semaineNum, dst.dateJour, dst.periode, src.moduleId
        );
        await db.setPromoPlanningModule(src.planningId, null);
        toast('Module déplacé', 'success');
      }
      const fresh = await db.getPromoPlanning(promo.id);
      setPlanning(fresh);
      // Recharger aussi les assignations (pour les conflits)
      const autres = await db.getAssignationsPeriode('2024-01-01', '2030-12-31');
      setAssignationsAutres(autres.filter(a => a.promo_id !== promo.id));
    } catch (err) {
      console.error(err);
      toast(err.message || 'Erreur de déplacement', 'error');
    }
  };

  return (
    <div className="page-content">
      <div className="page-header">
        <div>
          <div className="breadcrumb">PILOTAGE</div>
          <h1 className="page-title display-dot">Planning</h1>
          <div className="page-subtitle">Planning concret d'une promo, déroulé sur les vraies dates</div>
        </div>
      </div>

      {/* Sélecteur de promo */}
      {promos.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 40 }}>
          <div className="text-muted">
            Aucune promo créée. Va dans l'écran « Promos » pour en créer une.
          </div>
        </div>
      ) : (
        <>
          <div className="filters-bar">
            <div>
              <label className="label" style={{ marginBottom: 4, fontSize: 10 }}>Promo</label>
              <select value={selectedPromoId || ''} onChange={e => setSelectedPromoId(e.target.value)}>
                {promos.map(p => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
            </div>
            {promo && (() => {
              const creneauxAvecModule = planning.filter(p => p.module_id).length;
              const creneauxAvecIntervenant = planning.filter(p => p.intervenant_id).length;
              return (
                <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
                  <div className="text-xs text-muted">
                    {niveau && <span className={'chip ' + niveau.couleur} style={{ marginRight: 8 }}>{niveau.label}</span>}
                    {promo.date_debut && new Date(promo.date_debut + 'T00:00:00').toLocaleDateString('fr-FR')}
                    {' → '}
                    {promo.date_fin && new Date(promo.date_fin + 'T00:00:00').toLocaleDateString('fr-FR')}
                  </div>
                  <div className="text-sm" style={{ fontFamily: 'Gopher Heavy', color: 'var(--navy)' }}>
                    {semainesPresentes.length} semaines · {planning.length} créneaux
                  </div>
                  <div className="text-xs" style={{ marginTop: 4 }}>
                    <span style={{ color: 'var(--text-muted)' }}>Affectation : </span>
                    <strong style={{ color: creneauxAvecIntervenant === creneauxAvecModule ? 'var(--success, #2a9d4e)' : 'var(--navy)' }}>
                      {creneauxAvecIntervenant} / {creneauxAvecModule} intervenants
                    </strong>
                  </div>
                  <button
                    className={selectionMode ? 'btn btn-primary' : 'btn btn-ghost'}
                    onClick={() => selectionMode ? exitSelectionMode() : setSelectionMode(true)}
                    style={{ marginTop: 8, fontSize: 11, padding: '6px 12px' }}>
                    {selectionMode ? '✗ Quitter la sélection' : '☑ Sélection multiple'}
                  </button>
                </div>
              );
            })()}
          </div>
          {selectionMode && (
            <div style={{ background: 'var(--cyan-light)', border: '1px solid var(--cyan)', borderRadius: 6, padding: '8px 12px', marginBottom: 12, fontSize: 12, color: 'var(--navy)' }}>
              <strong>Mode sélection actif :</strong> cliquez sur les cases avec module pour les ajouter à la sélection.
              La barre en bas vous permettra ensuite de tous les affecter à un même intervenant.
            </div>
          )}

          {loadingPlanning && <div className="text-muted text-sm" style={{ padding: 20 }}>Chargement…</div>}

          {!loadingPlanning && semainesPresentes.length === 0 && (
            <div className="card" style={{ textAlign: 'center', padding: 30 }}>
              <div className="text-muted">Cette promo n'a pas encore de planning déroulé.</div>
            </div>
          )}

          {!loadingPlanning && semainesPresentes.map(num => {
            const res = resumeSemaine(num);
            const lundi = lundiBySemaine[num];
            const lundiD = lundi ? new Date(lundi + 'T00:00:00') : null;
            const venD = lundiD ? new Date(lundiD.getTime() + 4 * 86400000) : null;
            const isOpen = openSemaines[num];
            return (
              <div key={num} className="card" style={{ marginBottom: 8, padding: 0, overflow: 'hidden' }}>
                {/* Résumé semaine */}
                <div className="flex-between"
                  style={{ padding: '12px 16px', cursor: 'pointer', alignItems: 'center', gap: 12 }}
                  onClick={() => toggleSemaine(num)}>
                  <div className="flex gap-12" style={{ alignItems: 'center', flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'inline-block', transition: 'transform 0.15s', transform: isOpen ? 'rotate(90deg)' : 'none', color: 'var(--navy)' }}>
                      <Icon name="chevronRight" size={14} />
                    </span>
                    <div style={{ minWidth: 180 }}>
                      <div style={{ fontFamily: 'Gopher Heavy', color: 'var(--navy)', fontSize: 14 }}>
                        S{String(num).padStart(2, '0')}
                      </div>
                      {lundiD && venD && (
                        <div className="text-xs text-muted">
                          {lundiD.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })}
                          {' → '}
                          {venD.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })}
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', flex: 1 }}>
                      {res.topCats.length === 0 ? (
                        <span className="text-xs text-muted">Aucun module assigné</span>
                      ) : res.topCats.map(([catLabel, count]) => {
                        const col = couleurCat(catLabel);
                        return <span key={catLabel}
                          style={{ background: col.bg, color: col.fg, padding: '3px 10px', borderRadius: 4, fontSize: 11, fontWeight: 500 }}>
                          {catLabel} {count > 1 ? <span style={{ opacity: 0.7 }}>×{count}</span> : ''}
                        </span>;
                      })}
                    </div>
                  </div>
                  <div className="text-xs text-muted" style={{ whiteSpace: 'nowrap' }}>
                    {res.remplis} / {res.total} créneaux
                  </div>
                </div>

                {/* Détail déplié */}
                {isOpen && (
                  <div style={{ background: 'var(--bg-alt)', padding: 12, borderTop: '1px solid var(--border)' }}>
                    <table className="programme-grid" style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 4 }}>
                      <thead>
                        <tr>
                          <th style={{ width: 90, textAlign: 'left', fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, padding: '4px 8px' }}>CRÉNEAU</th>
                          {PLANNING_JOURS_LABELS.map((j, i) => {
                            const dateJour = lundiD ? new Date(lundiD.getTime() + i * 86400000) : null;
                            return (
                              <th key={j} style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, padding: '4px 8px', textAlign: 'left' }}>
                                <div>{j.toUpperCase()}</div>
                                {dateJour && (
                                  <div style={{ fontSize: 9, color: 'var(--navy)', marginTop: 2, fontWeight: 700 }}>
                                    {dateJour.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })}
                                  </div>
                                )}
                              </th>
                            );
                          })}
                        </tr>
                      </thead>
                      <tbody>
                        {['am', 'pm'].map(periode => (
                          <tr key={periode}>
                            <td style={{ fontSize: 11, color: 'var(--navy)', fontWeight: 700, padding: '8px', whiteSpace: 'nowrap' }}>
                              {periode === 'am' ? 'MATIN' : 'APRÈS-MIDI'}
                            </td>
                            {[0, 1, 2, 3, 4].map(jourIdx => {
                              const dateJour = lundiD ? isoDate(new Date(lundiD.getTime() + jourIdx * 86400000)) : null;
                              const entry = dateJour ? findPlanningEntry(num, dateJour, periode) : null;
                              const info = entry ? moduleInfo(entry.module_id) : null;
                              const cellKey = `${num}-${jourIdx}-${periode}`;
                              const isDragOver = dragOverKey === cellKey && dragging && (dragging.dateJour !== dateJour || dragging.periode !== periode);
                              const isDragSource = dragging && entry && dragging.planningId === entry.id;
                              const cellInfo = {
                                planningId: entry?.id || null,
                                semaineNum: num,
                                dateJour, periode,
                                moduleId: entry?.module_id || null,
                              };
                              const baseStyle = info ? {
                                background: info.couleur.bg,
                                color: info.couleur.fg,
                                border: '1px solid ' + info.couleur.border,
                              } : {
                                background: '#fff',
                                color: 'var(--text-muted)',
                                border: '1px dashed var(--border)',
                              };
                              const hoverStyle = isDragOver ? {
                                outline: '2px dashed var(--cyan)',
                                outlineOffset: -2,
                                background: 'var(--cyan-light)',
                              } : {};
                              const sourceStyle = isDragSource ? { opacity: 0.35 } : {};
                              // En mode sélection : seules les cases avec module sont sélectionnables
                              const isSelectable = selectionMode && !!(entry && info);
                              const isSelected = selectionMode && entry && selectedPlanningIds.has(entry.id);
                              const selectStyle = isSelected ? {
                                outline: '3px solid var(--cyan)',
                                outlineOffset: -2,
                              } : (selectionMode && !isSelectable ? { opacity: 0.4 } : {});
                              const draggable = !!(entry && info) && !selectionMode;
                              return (
                                <td key={jourIdx} style={{ padding: 0, position: 'relative' }}>
                                  <div
                                    draggable={draggable}
                                    onDragStart={selectionMode ? undefined : (e) => onDragStart(e, cellInfo)}
                                    onDragEnd={selectionMode ? undefined : onDragEnd}
                                    onDragOver={selectionMode ? undefined : (e) => onDragOver(e, cellKey)}
                                    onDragLeave={selectionMode ? undefined : onDragLeave}
                                    onDrop={selectionMode ? undefined : (e) => onDrop(e, cellInfo)}
                                    onClick={() => {
                                      if (selectionMode) {
                                        if (isSelectable) toggleCellSelection(entry.id);
                                        return;
                                      }
                                      setEditing({
                                        planningId: entry?.id || null,
                                        semaineNum: num,
                                        dateJour,
                                        periode,
                                        currentModuleId: entry?.module_id || null,
                                        currentIntervenantId: entry?.intervenant_id || null,
                                      });
                                    }}
                                    title={selectionMode
                                      ? (isSelectable ? 'Cliquer pour (dé)sélectionner' : 'Pas de module : non sélectionnable')
                                      : (info ? 'Glisser pour déplacer, cliquer pour modifier' : 'Cliquer pour assigner un module')}
                                    style={{
                                      ...baseStyle,
                                      ...hoverStyle,
                                      ...sourceStyle,
                                      ...selectStyle,
                                      padding: '8px 10px', borderRadius: 6,
                                      cursor: selectionMode ? (isSelectable ? 'pointer' : 'not-allowed') : (draggable ? 'grab' : 'pointer'),
                                      fontSize: 11, fontWeight: 500, minHeight: 44,
                                      display: 'flex', alignItems: 'center', lineHeight: 1.3,
                                      opacity: isDragSource ? 0.35 : (selectionMode && !isSelectable ? 0.4 : (info ? 1 : 0.6)),
                                      transition: 'background 0.1s, outline 0.1s',
                                    }}>
                                    {/* Indicateur de sélection */}
                                    {selectionMode && isSelectable && (
                                      <div style={{
                                        position: 'absolute', top: 4, right: 4,
                                        width: 16, height: 16, borderRadius: 4,
                                        border: '2px solid var(--cyan)',
                                        background: isSelected ? 'var(--cyan)' : '#fff',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        color: '#fff', fontSize: 10, fontWeight: 700,
                                      }}>
                                        {isSelected ? '✓' : ''}
                                      </div>
                                    )}
                                    {info ? (
                                      <div style={{ overflow: 'hidden', width: '100%' }}>
                                        <div style={{ fontWeight: 600 }}>{info.module.label}</div>
                                        {info.categorie && (
                                          <div style={{ opacity: 0.7, fontSize: 10, marginTop: 2 }}>
                                            {info.categorie.label}
                                          </div>
                                        )}
                                        {(() => {
                                          const interv = entry.intervenant_id && intervenantById[entry.intervenant_id];
                                          const conflits = conflitPour(entry);
                                          if (interv) {
                                            return (
                                              <div style={{ marginTop: 6, paddingTop: 4, borderTop: '1px solid ' + info.couleur.border, fontSize: 10, display: 'flex', alignItems: 'center', gap: 4 }}>
                                                <Icon name="user" size={10} />
                                                <span style={{ fontWeight: 600 }}>{interv.prenom} {interv.nom}</span>
                                                {conflits && (
                                                  <span
                                                    title={'⚠ Conflit : aussi sur ' + conflits.join(', ')}
                                                    style={{ marginLeft: 'auto', color: '#d97706', fontWeight: 700 }}>⚠</span>
                                                )}
                                              </div>
                                            );
                                          }
                                          return (
                                            <div style={{ marginTop: 6, paddingTop: 4, borderTop: '1px solid ' + info.couleur.border, fontSize: 10, opacity: 0.55, fontStyle: 'italic' }}>
                                              Aucun intervenant
                                            </div>
                                          );
                                        })()}
                                      </div>
                                    ) : entry ? (
                                      <span style={{ fontStyle: 'italic', opacity: 0.6 }}>+ Assigner un module</span>
                                    ) : (
                                      <span style={{ fontStyle: 'italic', opacity: 0.5 }}>+ Ajouter</span>
                                    )}
                                  </div>
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}

      {/* Modale d'édition (locale à la promo) */}
      {editing && (
        <ModalEditeurCreneau
          editing={editing}
          promo={promo}
          niveau={niveau}
          categories={categories}
          modules={modules}
          intervenants={intervenants || []}
          disposIntervenants={disposIntervenants}
          assignationsAutres={assignationsAutres}
          promoById={promoById}
          moduleById={moduleById}
          categorieById={categorieById}
          onSaveModule={saveModule}
          onClearModule={() => saveModule(null, true)}
          onSaveIntervenant={saveIntervenant}
          onClose={() => setEditing(null)}
        />
      )}

      {/* Barre sticky en bas — mode sélection multiple */}
      {selectionMode && selectedPlanningIds.size > 0 && (
        <div style={{
          position: 'fixed', bottom: 0, left: 0, right: 0,
          background: 'var(--navy)', color: '#fff',
          padding: '14px 24px',
          display: 'flex', alignItems: 'center', gap: 16,
          boxShadow: '0 -4px 16px rgba(0,0,0,0.15)',
          zIndex: 50,
        }}>
          <div style={{ flex: 1 }}>
            <strong style={{ fontSize: 16 }}>
              {selectedPlanningIds.size} créneau{selectedPlanningIds.size > 1 ? 'x' : ''} sélectionné{selectedPlanningIds.size > 1 ? 's' : ''}
            </strong>
            <span style={{ marginLeft: 12, opacity: 0.8, fontSize: 12 }}>
              Tous seront affectés au même intervenant
            </span>
          </div>
          <button className="btn btn-ghost" onClick={clearSelection}
            style={{ color: '#fff', borderColor: 'rgba(255,255,255,0.3)' }}>
            Tout désélectionner
          </button>
          <button className="btn btn-primary" onClick={() => setBulkModalOpen(true)}>
            <Icon name="user" size={14} /> Assigner un intervenant
          </button>
        </div>
      )}

      {/* Modale d'affectation en masse */}
      {bulkModalOpen && (
        <ModalAffectationBulk
          selectedPlanningIds={[...selectedPlanningIds]}
          planning={planning}
          promo={promo}
          niveau={niveau}
          intervenants={intervenants || []}
          disposIntervenants={disposIntervenants}
          assignationsAutres={assignationsAutres}
          promoById={promoById}
          moduleById={moduleById}
          categorieById={categorieById}
          onAssign={bulkAssignIntervenant}
          onClose={() => setBulkModalOpen(false)}
        />
      )}
    </div>
  );
};

// ============================================================
// MODALE — choix de module pour un créneau de promo
// (locale à la promo, ne modifie PAS le programme-type)
// ============================================================
const ModalEditeurCreneau = ({
  editing, promo, niveau, categories, modules, intervenants,
  disposIntervenants, assignationsAutres, promoById, moduleById, categorieById,
  onSaveModule, onClearModule, onSaveIntervenant, onClose,
}) => {
  // Onglet actif (par défaut "module" si pas de module assigné, sinon "intervenant"
  // pour aller plus vite à l'étape suivante)
  const [activeTab, setActiveTab] = useState(editing.currentModuleId ? 'intervenant' : 'module');

  // Formater la date du créneau
  const d = new Date(editing.dateJour + 'T00:00:00');
  const dateLabel = d.toLocaleDateString('fr-FR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
  const periodeLabel = editing.periode === 'am' ? 'matin' : 'après-midi';

  // Module actuel et catégorie associée
  const currentModule = editing.currentModuleId ? moduleById[editing.currentModuleId] : null;
  const currentCategorie = currentModule ? categorieById[currentModule.categorie_id] : null;
  const currentIntervenant = editing.currentIntervenantId
    ? intervenants.find(i => i.id === editing.currentIntervenantId)
    : null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}
        style={{ maxWidth: 720, maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
        <div className="modal-head">
          <div>
            <h3 style={{ marginBottom: 4 }}>S{String(editing.semaineNum).padStart(2, '0')} · {dateLabel} {periodeLabel}</h3>
            <div className="text-xs text-muted">
              ⓘ Cette modification ne concerne que <strong>{promo?.label}</strong>.
            </div>
          </div>
          <div className="modal-close" onClick={onClose}><Icon name="x" size={16} /></div>
        </div>

        {/* Récap module + intervenant actuels */}
        <div style={{ background: 'var(--bg-alt)', padding: 10, borderRadius: 6, marginBottom: 12, display: 'flex', gap: 16, fontSize: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Module</div>
            {currentModule ? (
              <div style={{ fontWeight: 600, color: 'var(--navy)' }}>
                {currentModule.label}
                {currentCategorie && (
                  <span style={{ opacity: 0.7, fontWeight: 400, marginLeft: 6, fontSize: 11 }}>
                    · {currentCategorie.label}
                  </span>
                )}
              </div>
            ) : (
              <div style={{ fontStyle: 'italic', color: 'var(--text-muted)' }}>Aucun module</div>
            )}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Intervenant</div>
            {currentIntervenant ? (
              <div style={{ fontWeight: 600, color: 'var(--navy)' }}>
                {currentIntervenant.prenom} {currentIntervenant.nom}
              </div>
            ) : (
              <div style={{ fontStyle: 'italic', color: 'var(--text-muted)' }}>Non assigné</div>
            )}
          </div>
        </div>

        {/* Onglets */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 12 }}>
          {[
            { id: 'module', label: 'Module' },
            { id: 'intervenant', label: 'Intervenant', disabled: !editing.planningId && !editing.currentModuleId },
          ].map(t => {
            const isActive = activeTab === t.id;
            const isDisabled = t.disabled;
            return (
              <div key={t.id}
                onClick={() => !isDisabled && setActiveTab(t.id)}
                style={{
                  padding: '8px 16px',
                  cursor: isDisabled ? 'not-allowed' : 'pointer',
                  fontWeight: isActive ? 700 : 500,
                  color: isDisabled ? 'var(--text-muted)' : (isActive ? 'var(--navy)' : 'var(--text-muted)'),
                  borderBottom: isActive ? '3px solid var(--cyan)' : '3px solid transparent',
                  opacity: isDisabled ? 0.4 : 1,
                  fontSize: 13,
                }}
                title={isDisabled ? "Assigne d'abord un module" : ''}>
                {t.label}
              </div>
            );
          })}
        </div>

        {/* Contenu de l'onglet */}
        {activeTab === 'module' ? (
          <OngletModule
            editing={editing}
            categories={categories}
            modules={modules}
            onSaveModule={onSaveModule}
            onClearModule={onClearModule}
            onClose={onClose}
          />
        ) : (
          <OngletIntervenant
            editing={editing}
            promo={promo}
            niveau={niveau}
            currentCategorie={currentCategorie}
            intervenants={intervenants}
            disposIntervenants={disposIntervenants}
            assignationsAutres={assignationsAutres}
            promoById={promoById}
            onSaveIntervenant={onSaveIntervenant}
            onClose={onClose}
          />
        )}
      </div>
    </div>
  );
};

// ─── Onglet "Module" ───────────────────────────────────────────────────
const OngletModule = ({ editing, categories, modules, onSaveModule, onClearModule, onClose }) => {
  const [search, setSearch] = useState('');
  const [selectedCatId, setSelectedCatId] = useState('all');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return modules
      .filter(m => selectedCatId === 'all' || m.categorie_id === selectedCatId)
      .filter(m => !q || m.label.toLowerCase().includes(q))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [modules, search, selectedCatId]);

  const grouped = useMemo(() => {
    const map = {};
    filtered.forEach(m => {
      const cat = categories.find(c => c.id === m.categorie_id);
      const catLabel = cat?.label || '— Sans catégorie —';
      (map[catLabel] = map[catLabel] || []).push(m);
    });
    return map;
  }, [filtered, categories]);

  return (
    <>
      <div className="flex gap-8 mb-16">
        <div style={{ position: 'relative', flex: 1 }}>
          <input type="search" placeholder="Rechercher un module…" value={search}
            autoFocus onChange={e => setSearch(e.target.value)} style={{ paddingLeft: 36 }} />
          <div style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }}>
            <Icon name="search" size={14} />
          </div>
        </div>
        <select value={selectedCatId} onChange={e => setSelectedCatId(e.target.value)}>
          <option value="all">Toutes les catégories</option>
          {categories.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
      </div>

      <div style={{ overflowY: 'auto', flex: 1, border: '1px solid var(--border)', borderRadius: 6 }}>
        {Object.keys(grouped).length === 0 ? (
          <div className="text-muted text-sm" style={{ padding: 24, textAlign: 'center' }}>
            Aucun module ne correspond.
          </div>
        ) : Object.entries(grouped).map(([catLabel, mods]) => {
          const col = couleurCat(catLabel);
          return (
            <div key={catLabel}>
              <div style={{ padding: '6px 12px', background: col.bg, color: col.fg, fontSize: 10, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase' }}>
                {catLabel}
              </div>
              {mods.map(m => {
                const isCurrent = m.id === editing.currentModuleId;
                return (
                  <div key={m.id}
                    onClick={() => onSaveModule(m.id, true)}
                    style={{
                      padding: '8px 14px', cursor: 'pointer',
                      background: isCurrent ? 'var(--cyan-light)' : '#fff',
                      borderBottom: '1px solid var(--bg-alt)',
                      fontSize: 13, display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    }}
                    onMouseEnter={e => { if (!isCurrent) e.currentTarget.style.background = 'var(--bg-alt)'; }}
                    onMouseLeave={e => { if (!isCurrent) e.currentTarget.style.background = '#fff'; }}>
                    <span>{m.label}</span>
                    {isCurrent && <Icon name="check" size={14} />}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      <div className="modal-foot">
        {editing.currentModuleId && (
          <button className="btn btn-ghost" onClick={onClearModule} style={{ color: 'var(--danger)' }}>
            <Icon name="x" size={12} /> Retirer le module
          </button>
        )}
        <button className="btn btn-ghost" onClick={onClose} style={{ marginLeft: 'auto' }}>Fermer</button>
      </div>
    </>
  );
};

// ─── Onglet "Intervenant" avec algorithme de suggestion ─────────────────
const OngletIntervenant = ({
  editing, promo, niveau, currentCategorie, intervenants,
  disposIntervenants, assignationsAutres, promoById,
  onSaveIntervenant, onClose,
}) => {
  const [search, setSearch] = useState('');
  const [filterNonQualifies, setFilterNonQualifies] = useState(true);

  // ─── Calculer pour chaque intervenant son score et son statut ──────────
  // Critères :
  //   • Niveau OK ?    (qualifié pour le niveau de la promo)
  //   • Qualif module : note sur la catégorie du module (0..5, null si pas de note)
  //   • Dispo          : déclarée dispo ce jour×période sur la campagne courante
  //   • Conflit        : déjà assigné ailleurs sur cette date×période
  //
  // Score = combinaison de ces critères (priorité aux dispos qualifiés sans conflit)
  const candidats = useMemo(() => {
    return intervenants.map(i => {
      const niveauOk = niveau ? (i.niveaux || []).includes(niveau.id) : true;
      const note = currentCategorie ? (i.ratings?.[currentCategorie.id] || null) : null;
      const qualifieModule = !!note;
      // Disponibilité : la table dispos contient les dispos déclarées
      // dispo.date_jour === editing.dateJour et dispo.periode === editing.periode
      const dispoRecord = disposIntervenants.find(d =>
        d.intervenant_id === i.id && d.date === editing.dateJour && d.periode === editing.periode
      );
      const dispoStatut = dispoRecord ? 'dispo' : 'inconnu';
      // Conflit ?
      const conflitsListe = assignationsAutres.filter(a =>
        a.intervenant_id === i.id && a.date_jour === editing.dateJour && a.periode === editing.periode
      ).map(a => promoById[a.promo_id]?.label).filter(Boolean);
      const hasConflit = conflitsListe.length > 0;

      // Score (plus haut = meilleur)
      let score = 0;
      if (niveauOk) score += 1000;
      if (qualifieModule) score += 100 + (note * 20); // note 5 → +200, note 1 → +120
      if (dispoStatut === 'dispo') score += 500;
      if (hasConflit) score -= 100; // pénalité de conflit (pas exclusion, juste warning)

      return {
        intervenant: i,
        niveauOk, note, qualifieModule,
        dispoStatut, hasConflit, conflitsListe,
        score,
      };
    }).sort((a, b) => b.score - a.score);
  }, [intervenants, niveau, currentCategorie, disposIntervenants, assignationsAutres, editing.dateJour, editing.periode, promoById]);

  // Filtre recherche + filtre "non qualifiés"
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return candidats.filter(c => {
      const i = c.intervenant;
      const matchSearch = !q || `${i.prenom} ${i.nom}`.toLowerCase().includes(q);
      const matchQualif = filterNonQualifies ? c.niveauOk : true;
      return matchSearch && matchQualif;
    });
  }, [candidats, search, filterNonQualifies]);

  return (
    <>
      <div className="flex gap-8 mb-16">
        <div style={{ position: 'relative', flex: 1 }}>
          <input type="search" placeholder="Rechercher un intervenant…" value={search}
            autoFocus onChange={e => setSearch(e.target.value)} style={{ paddingLeft: 36 }} />
          <div style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }}>
            <Icon name="search" size={14} />
          </div>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
          <input type="checkbox" checked={filterNonQualifies}
            onChange={e => setFilterNonQualifies(e.target.checked)} />
          <span>Masquer les non qualifiés pour le niveau</span>
        </label>
      </div>

      {!currentCategorie && (
        <div style={{ padding: 10, background: '#fff8e5', borderRadius: 6, marginBottom: 12, fontSize: 12, color: '#856404' }}>
          ⓘ Aucun module assigné : les intervenants ne sont pas classés par qualification de catégorie.
        </div>
      )}

      <div style={{ overflowY: 'auto', flex: 1, border: '1px solid var(--border)', borderRadius: 6 }}>
        {filtered.length === 0 ? (
          <div className="text-muted text-sm" style={{ padding: 24, textAlign: 'center' }}>
            Aucun intervenant ne correspond.
          </div>
        ) : filtered.map(c => {
          const i = c.intervenant;
          const isCurrent = i.id === editing.currentIntervenantId;
          return (
            <div key={i.id}
              onClick={() => onSaveIntervenant(i.id)}
              style={{
                padding: '10px 14px', cursor: 'pointer',
                background: isCurrent ? 'var(--cyan-light)' : '#fff',
                borderBottom: '1px solid var(--bg-alt)',
                fontSize: 13, display: 'flex', alignItems: 'center', gap: 10,
              }}
              onMouseEnter={e => { if (!isCurrent) e.currentTarget.style.background = 'var(--bg-alt)'; }}
              onMouseLeave={e => { if (!isCurrent) e.currentTarget.style.background = '#fff'; }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, color: 'var(--navy)' }}>
                  {i.prenom} {i.nom}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                  {i.ville && <span>{i.ville}</span>}
                  {i.taux_horaire && <span> · {i.taux_horaire}€/h</span>}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                {/* Note sur la catégorie */}
                {currentCategorie && (
                  c.note ? (
                    <span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 10, background: '#e8f4ea', color: '#1f6c33', fontWeight: 600 }}>
                      ★ {c.note}/5
                    </span>
                  ) : (
                    <span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 10, background: '#f0f0f3', color: '#888', fontStyle: 'italic' }}>
                      pas noté
                    </span>
                  )
                )}
                {/* Niveau */}
                {!c.niveauOk && (
                  <span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 10, background: '#ffe4e4', color: '#a83333', fontWeight: 600 }}
                    title={`Pas qualifié pour le niveau ${niveau?.label}`}>
                    ✗ niveau
                  </span>
                )}
                {/* Dispo */}
                {c.dispoStatut === 'dispo' && (
                  <span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 10, background: '#e3f1ff', color: '#1a5490', fontWeight: 600 }}
                    title="Déclaré disponible sur cette demi-journée">
                    ✓ dispo
                  </span>
                )}
                {/* Conflit */}
                {c.hasConflit && (
                  <span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 10, background: '#fff3cd', color: '#856404', fontWeight: 600 }}
                    title={'⚠ Déjà assigné : ' + c.conflitsListe.join(', ')}>
                    ⚠ conflit
                  </span>
                )}
                {isCurrent && <Icon name="check" size={14} />}
              </div>
            </div>
          );
        })}
      </div>

      <div className="modal-foot">
        {editing.currentIntervenantId && (
          <button className="btn btn-ghost" onClick={() => onSaveIntervenant(null)} style={{ color: 'var(--danger)' }}>
            <Icon name="x" size={12} /> Retirer l'intervenant
          </button>
        )}
        <button className="btn btn-ghost" onClick={onClose} style={{ marginLeft: 'auto' }}>Fermer</button>
      </div>
    </>
  );
};

// ============================================================
// MODALE — affectation en masse d'un intervenant à plusieurs créneaux
// ============================================================
const ModalAffectationBulk = ({
  selectedPlanningIds, planning, promo, niveau, intervenants,
  disposIntervenants, assignationsAutres, promoById, moduleById, categorieById,
  onAssign, onClose,
}) => {
  const [search, setSearch] = useState('');
  const [filterNonQualifies, setFilterNonQualifies] = useState(true);

  // Récupérer les entries sélectionnées avec leurs détails
  const selectedEntries = useMemo(() => {
    return selectedPlanningIds
      .map(pid => planning.find(p => p.id === pid))
      .filter(Boolean);
  }, [selectedPlanningIds, planning]);

  // Catégories distinctes couvertes par les modules sélectionnés
  // (utilisé pour calculer la note moyenne d'un intervenant)
  const categoriesIds = useMemo(() => {
    const set = new Set();
    selectedEntries.forEach(e => {
      const mod = moduleById[e.module_id];
      if (mod) set.add(mod.categorie_id);
    });
    return [...set];
  }, [selectedEntries, moduleById]);

  // Calculer le scoring "agrégé" pour chaque intervenant
  const candidats = useMemo(() => {
    const N = selectedEntries.length;
    return intervenants.map(i => {
      const niveauOk = niveau ? (i.niveaux || []).includes(niveau.id) : true;
      // Note moyenne sur les catégories couvertes (si l'intervenant a une note sur chacune)
      const notes = categoriesIds
        .map(cid => i.ratings?.[cid])
        .filter(n => typeof n === 'number');
      const noteMoyenne = notes.length > 0 ? (notes.reduce((s, n) => s + n, 0) / notes.length) : null;
      const qualifMoy = notes.length / (categoriesIds.length || 1); // 0..1 : couverture des catégories
      // Combien de créneaux où il est dispo / en conflit
      let nbDispos = 0;
      let nbConflits = 0;
      const conflitsPromos = new Set();
      selectedEntries.forEach(e => {
        const dispoFound = disposIntervenants.find(d =>
          d.intervenant_id === i.id && d.date === e.date_jour && d.periode === e.periode
        );
        if (dispoFound) nbDispos++;
        const conflits = assignationsAutres.filter(a =>
          a.intervenant_id === i.id && a.date_jour === e.date_jour && a.periode === e.periode
        );
        if (conflits.length > 0) {
          nbConflits++;
          conflits.forEach(c => {
            const promoLabel = promoById[c.promo_id]?.label;
            if (promoLabel) conflitsPromos.add(promoLabel);
          });
        }
      });
      // Scoring agrégé
      let score = 0;
      if (niveauOk) score += 1000;
      if (noteMoyenne) score += 100 + (noteMoyenne * 20);
      score += qualifMoy * 50; // couverture des catégories
      score += (nbDispos / Math.max(N, 1)) * 500;
      score -= (nbConflits / Math.max(N, 1)) * 200;
      return {
        intervenant: i,
        niveauOk, noteMoyenne, nbNotes: notes.length, totalCategories: categoriesIds.length,
        nbDispos, nbConflits, conflitsPromos: [...conflitsPromos],
        score, N,
      };
    }).sort((a, b) => b.score - a.score);
  }, [intervenants, niveau, categoriesIds, disposIntervenants, assignationsAutres, selectedEntries, promoById]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return candidats.filter(c => {
      const i = c.intervenant;
      const matchSearch = !q || `${i.prenom} ${i.nom}`.toLowerCase().includes(q);
      const matchQualif = filterNonQualifies ? c.niveauOk : true;
      return matchSearch && matchQualif;
    });
  }, [candidats, search, filterNonQualifies]);

  const N = selectedEntries.length;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}
        style={{ maxWidth: 780, maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
        <div className="modal-head">
          <div>
            <h3 style={{ marginBottom: 4 }}>
              Affecter un intervenant à {N} créneau{N > 1 ? 'x' : ''}
            </h3>
            <div className="text-xs text-muted">
              ⓘ Promo <strong>{promo?.label}</strong>. Les suggestions tiennent compte de la qualification, de la disponibilité et des conflits sur l'ensemble des créneaux sélectionnés.
            </div>
          </div>
          <div className="modal-close" onClick={onClose}><Icon name="x" size={16} /></div>
        </div>

        <div className="flex gap-8 mb-16">
          <div style={{ position: 'relative', flex: 1 }}>
            <input type="search" placeholder="Rechercher un intervenant…" value={search}
              autoFocus onChange={e => setSearch(e.target.value)} style={{ paddingLeft: 36 }} />
            <div style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }}>
              <Icon name="search" size={14} />
            </div>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
            <input type="checkbox" checked={filterNonQualifies}
              onChange={e => setFilterNonQualifies(e.target.checked)} />
            <span>Masquer les non qualifiés</span>
          </label>
        </div>

        <div style={{ overflowY: 'auto', flex: 1, border: '1px solid var(--border)', borderRadius: 6 }}>
          {filtered.length === 0 ? (
            <div className="text-muted text-sm" style={{ padding: 24, textAlign: 'center' }}>
              Aucun intervenant ne correspond.
            </div>
          ) : filtered.map(c => {
            const i = c.intervenant;
            return (
              <div key={i.id}
                onClick={() => onAssign(i.id)}
                style={{
                  padding: '10px 14px', cursor: 'pointer', background: '#fff',
                  borderBottom: '1px solid var(--bg-alt)',
                  fontSize: 13, display: 'flex', alignItems: 'center', gap: 10,
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-alt)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = '#fff'; }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, color: 'var(--navy)' }}>
                    {i.prenom} {i.nom}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                    {i.ville && <span>{i.ville}</span>}
                    {i.taux_horaire && <span> · {i.taux_horaire}€/h</span>}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  {/* Note moyenne sur les catégories couvertes */}
                  {c.noteMoyenne != null ? (
                    <span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 10, background: '#e8f4ea', color: '#1f6c33', fontWeight: 600 }}
                      title={`Note moyenne sur ${c.nbNotes}/${c.totalCategories} catégorie(s) concernée(s)`}>
                      ★ {c.noteMoyenne.toFixed(1)}/5
                    </span>
                  ) : (
                    <span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 10, background: '#f0f0f3', color: '#888', fontStyle: 'italic' }}>
                      pas noté
                    </span>
                  )}
                  {!c.niveauOk && (
                    <span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 10, background: '#ffe4e4', color: '#a83333', fontWeight: 600 }}>
                      ✗ niveau
                    </span>
                  )}
                  {c.nbDispos > 0 && (
                    <span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 10, background: '#e3f1ff', color: '#1a5490', fontWeight: 600 }}
                      title={`Disponible sur ${c.nbDispos}/${c.N} créneaux`}>
                      ✓ {c.nbDispos}/{c.N} dispo
                    </span>
                  )}
                  {c.nbConflits > 0 && (
                    <span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 10, background: '#fff3cd', color: '#856404', fontWeight: 600 }}
                      title={`Déjà assigné sur ${c.nbConflits} créneaux concernés (${c.conflitsPromos.join(', ')})`}>
                      ⚠ {c.nbConflits} conflit{c.nbConflits > 1 ? 's' : ''}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={() => onAssign(null)} style={{ color: 'var(--danger)' }}>
            <Icon name="x" size={12} /> Retirer l'intervenant des créneaux sélectionnés
          </button>
          <button className="btn btn-ghost" onClick={onClose} style={{ marginLeft: 'auto' }}>Annuler</button>
        </div>
      </div>
    </div>
  );
};
