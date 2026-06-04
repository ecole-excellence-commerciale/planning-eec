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
  const { promos, niveaux, categories, modules } = data;

  // Sélection de la promo (par défaut la 1ère)
  const [selectedPromoId, setSelectedPromoId] = useState(() => promos[0]?.id || null);
  const promo = promos.find(p => p.id === selectedPromoId) || null;
  const niveau = promo ? niveaux.find(n => n.id === promo.niveau_id) : null;

  // Chargement du planning
  const [planning, setPlanning] = useState([]);
  const [loadingPlanning, setLoadingPlanning] = useState(false);

  useEffect(() => {
    if (!promo) { setPlanning([]); return; }
    setLoadingPlanning(true);
    db.getPromoPlanning(promo.id)
      .then(setPlanning)
      .catch(e => { console.error(e); toast('Erreur de chargement du planning', 'error'); })
      .finally(() => setLoadingPlanning(false));
  }, [promo?.id]);

  // État édition d'un créneau (modale)
  const [editing, setEditing] = useState(null);
  // {planningId, semaineNum, dateJour, periode, currentModuleId}

  // État semaines dépliées : seule la 1ère est dépliée par défaut
  // (recalculé quand on change de promo)
  const [openSemaines, setOpenSemaines] = useState({});
  useEffect(() => {
    // Quand on change de promo, ne déplier que la S01
    setOpenSemaines({ 1: true });
  }, [promo?.id]);

  const toggleSemaine = (num) => setOpenSemaines(s => ({ ...s, [num]: !s[num] }));

  // Index des modules/catégories
  const moduleById = useMemo(() => Object.fromEntries(modules.map(m => [m.id, m])), [modules]);
  const categorieById = useMemo(() => Object.fromEntries(categories.map(c => [c.id, c])), [categories]);

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
      // Calculer le lundi de la semaine de p.date_jour
      const d = new Date(p.date_jour + 'T00:00:00');
      const dow = d.getDay() === 0 ? 7 : d.getDay();
      const lundi = new Date(d.getTime() - (dow - 1) * 86400000);
      map[p.semaine_num] = lundi.toISOString().slice(0, 10);
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

  // Sauvegarde locale (sur la promo, pas sur le programme-type)
  const saveModule = async (moduleId) => {
    if (!editing) return;
    try {
      await db.setPromoPlanningModule(editing.planningId, moduleId);
      toast('Créneau mis à jour pour cette promo', 'success');
      const fresh = await db.getPromoPlanning(promo.id);
      setPlanning(fresh);
      setEditing(null);
    } catch (e) {
      console.error(e); toast(e.message || 'Erreur', 'error');
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
            {promo && (
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
              </div>
            )}
          </div>

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
                              const dateJour = lundiD ? new Date(lundiD.getTime() + jourIdx * 86400000).toISOString().slice(0, 10) : null;
                              const entry = dateJour ? findPlanningEntry(num, dateJour, periode) : null;
                              const info = entry ? moduleInfo(entry.module_id) : null;
                              const style = info ? {
                                background: info.couleur.bg,
                                color: info.couleur.fg,
                                border: '1px solid ' + info.couleur.border,
                              } : {
                                background: '#fff',
                                color: 'var(--text-muted)',
                                border: '1px dashed var(--border)',
                              };
                              const clickable = !!entry;
                              return (
                                <td key={jourIdx} style={{ padding: 0 }}>
                                  <div
                                    onClick={() => {
                                      if (!entry) return;
                                      setEditing({
                                        planningId: entry.id,
                                        semaineNum: num,
                                        dateJour,
                                        periode,
                                        currentModuleId: entry.module_id,
                                      });
                                    }}
                                    style={{
                                      ...style,
                                      padding: '8px 10px', borderRadius: 6, cursor: clickable ? 'pointer' : 'default',
                                      fontSize: 11, fontWeight: 500, minHeight: 44,
                                      display: 'flex', alignItems: 'center', lineHeight: 1.3,
                                      opacity: clickable ? 1 : 0.5,
                                    }}>
                                    {info ? (
                                      <div style={{ overflow: 'hidden' }}>
                                        <div style={{ fontWeight: 600 }}>{info.module.label}</div>
                                        {info.categorie && (
                                          <div style={{ opacity: 0.7, fontSize: 10, marginTop: 2 }}>
                                            {info.categorie.label}
                                          </div>
                                        )}
                                      </div>
                                    ) : entry ? (
                                      <span style={{ fontStyle: 'italic', opacity: 0.6 }}>+ Assigner un module</span>
                                    ) : (
                                      <span style={{ fontStyle: 'italic', opacity: 0.4 }}>— Hors créneau</span>
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
        <ModalChoixModulePlanning
          editing={editing}
          promoLabel={promo?.label}
          categories={categories}
          modules={modules}
          onSave={saveModule}
          onClear={() => saveModule(null)}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
};

// ============================================================
// MODALE — choix de module pour un créneau de promo
// (locale à la promo, ne modifie PAS le programme-type)
// ============================================================
const ModalChoixModulePlanning = ({ editing, promoLabel, categories, modules, onSave, onClear, onClose }) => {
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

  // Formater la date du créneau
  const d = new Date(editing.dateJour + 'T00:00:00');
  const dateLabel = d.toLocaleDateString('fr-FR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
  const periodeLabel = editing.periode === 'am' ? 'matin' : 'après-midi';

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}
        style={{ maxWidth: 640, maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
        <div className="modal-head">
          <div>
            <h3 style={{ marginBottom: 4 }}>S{String(editing.semaineNum).padStart(2, '0')} · {dateLabel} {periodeLabel}</h3>
            <div className="text-xs text-muted">
              ⓘ Cette modification ne concerne que <strong>{promoLabel}</strong> — le programme-type reste inchangé.
            </div>
          </div>
          <div className="modal-close" onClick={onClose}><Icon name="x" size={16} /></div>
        </div>

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
                      onClick={() => onSave(m.id)}
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
            <button className="btn btn-ghost" onClick={onClear} style={{ color: 'var(--danger)' }}>
              <Icon name="x" size={12} /> Retirer le module
            </button>
          )}
          <button className="btn btn-ghost" onClick={onClose} style={{ marginLeft: 'auto' }}>Annuler</button>
        </div>
      </div>
    </div>
  );
};
