// ============================================================
// PROGRAMME-TYPE — visualisation et édition
// ============================================================
// Affiche le squelette pédagogique d'un programme (Bac+2 / Mastère / Bootcamp)
// sous forme de 25 semaines repliables. Chaque case (jour × demi-journée) peut
// recevoir un module assigné, choisi parmi ceux d'une catégorie.

const JOURS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi'];
const JOUR_LETTRES = ['L', 'M', 'M', 'J', 'V'];

// Hash stable d'une chaîne → couleur pastel HSL (pour colorer les catégories)
function couleurCategorie(label) {
  if (!label) return { bg: '#f5f5f7', fg: '#666' };
  let hash = 0;
  for (let i = 0; i < label.length; i++) hash = (hash * 31 + label.charCodeAt(i)) | 0;
  const hue = Math.abs(hash) % 360;
  return {
    bg: `hsl(${hue}, 70%, 92%)`,
    fg: `hsl(${hue}, 55%, 28%)`,
    border: `hsl(${hue}, 50%, 75%)`,
  };
}

const PageProgramme = ({ data, onReload }) => {
  const toast = useToast();
  const { niveaux, programmes, categories, modules } = data;

  // Programme actuellement sélectionné
  const [selectedNiveauId, setSelectedNiveauId] = useState(() => {
    // Par défaut : le niveau qui a un programme (probablement Bac+2)
    const niveauAvecProg = niveaux.find(n => programmes.some(p => p.niveau_id === n.id));
    return niveauAvecProg ? niveauAvecProg.id : (niveaux[0]?.id || null);
  });

  // Programme correspondant au niveau choisi
  const programme = programmes.find(p => p.niveau_id === selectedNiveauId) || null;

  // Charger les créneaux du programme sélectionné
  const [creneaux, setCreneaux] = useState([]);
  const [loadingCreneaux, setLoadingCreneaux] = useState(false);

  useEffect(() => {
    if (!programme) { setCreneaux([]); return; }
    setLoadingCreneaux(true);
    db.getProgrammeCreneaux(programme.id)
      .then(setCreneaux)
      .catch(e => { console.error(e); toast('Erreur de chargement du programme', 'error'); })
      .finally(() => setLoadingCreneaux(false));
  }, [programme?.id]);

  // État de l'édition d'une case (modale de sélection de module)
  const [editing, setEditing] = useState(null); // { semaineNum, jour, periode, creneauId, currentModuleId }

  // Création d'un nouveau programme-type pour un niveau qui n'en a pas
  const [creatingForNiveau, setCreatingForNiveau] = useState(false);

  // Semaines dépliées (par défaut : toutes repliées)
  const [openSemaines, setOpenSemaines] = useState({});
  const toggleSemaine = (num) => setOpenSemaines(s => ({ ...s, [num]: !s[num] }));

  // Index : modules et catégories par id
  const moduleById = useMemo(() => Object.fromEntries(modules.map(m => [m.id, m])), [modules]);
  const categorieById = useMemo(() => Object.fromEntries(categories.map(c => [c.id, c])), [categories]);

  // Helper : retrouve le créneau pour une semaine/jour/période donnée
  const findCreneau = (semaine, jour, periode) =>
    creneaux.find(c => c.semaine_num === semaine && c.jour === jour && c.periode === periode);

  // Helper : info d'un module + sa catégorie + couleur
  const moduleInfo = (moduleId) => {
    if (!moduleId) return null;
    const mod = moduleById[moduleId];
    if (!mod) return null;
    const cat = categorieById[mod.categorie_id];
    return { module: mod, categorie: cat, couleur: couleurCategorie(cat?.label) };
  };

  // Helper : trouver le numéro de semaine maximal effectivement présent dans le programme
  const semainesPresentes = useMemo(() => {
    const s = new Set(creneaux.map(c => c.semaine_num));
    const max = Math.max(programme?.nombre_semaines || 25, ...Array.from(s));
    return Array.from({ length: max }, (_, i) => i + 1);
  }, [creneaux, programme?.nombre_semaines]);

  // Résumé d'une semaine : nombre de créneaux remplis, catégories dominantes
  const resumeSemaine = (num) => {
    const cs = creneaux.filter(c => c.semaine_num === num);
    const remplis = cs.filter(c => c.module_id).length;
    const total = cs.length;
    // Top 2 catégories les plus présentes dans la semaine
    const catCounts = {};
    cs.forEach(c => {
      const mod = moduleById[c.module_id];
      if (!mod) return;
      const cat = categorieById[mod.categorie_id];
      if (!cat) return;
      catCounts[cat.label] = (catCounts[cat.label] || 0) + 1;
    });
    const topCats = Object.entries(catCounts).sort((a, b) => b[1] - a[1]).slice(0, 3);
    return { remplis, total, topCats };
  };

  // ---- Sauvegarde de la modification d'un créneau ----
  const saveCreneauModule = async (moduleId) => {
    if (!editing) return;
    try {
      if (editing.creneauId) {
        await db.setCreneauModule(editing.creneauId, moduleId);
      } else {
        // Le créneau n'existe pas encore en base — on le crée
        await db.addCreneau(programme.id, editing.semaineNum, editing.jour, editing.periode, moduleId);
      }
      toast('Créneau mis à jour', 'success');
      // Recharger localement les créneaux
      const fresh = await db.getProgrammeCreneaux(programme.id);
      setCreneaux(fresh);
      setEditing(null);
    } catch (e) {
      console.error(e);
      toast(e.message || 'Erreur de sauvegarde', 'error');
    }
  };

  // ---- Création d'un programme vide pour un niveau qui n'en a pas ----
  const createProgrammeForCurrentNiveau = async () => {
    if (!selectedNiveauId) return;
    setCreatingForNiveau(true);
    try {
      const niveau = niveaux.find(n => n.id === selectedNiveauId);
      const label = `Programme ${niveau?.label || ''}`.trim();
      await db.addProgrammeType(selectedNiveauId, label, 25);
      toast(`Programme créé pour ${niveau?.label}`, 'success');
      onReload();
    } catch (e) {
      toast(e.message || 'Erreur', 'error');
    } finally {
      setCreatingForNiveau(false);
    }
  };

  // ============================================================
  // RENDU
  // ============================================================
  return (
    <div className="page-content">
      <div className="page-header">
        <div>
          <div className="breadcrumb">GESTION</div>
          <h1 className="page-title display-dot">Programme</h1>
          <div className="page-subtitle">
            Squelette pédagogique du parcours — par niveau
          </div>
        </div>
      </div>

      {/* Sélecteur de programme (niveau) */}
      <div className="filters-bar">
        <div>
          <label className="label" style={{ marginBottom: 4, fontSize: 10 }}>Programme du niveau</label>
          <select value={selectedNiveauId || ''} onChange={e => setSelectedNiveauId(e.target.value)}>
            {niveaux.map(n => {
              const hasProg = programmes.some(p => p.niveau_id === n.id);
              return <option key={n.id} value={n.id}>
                {n.label} {hasProg ? '' : '— (vide)'}
              </option>;
            })}
          </select>
        </div>
        {programme && (
          <div style={{ marginLeft: 'auto' }}>
            <div className="text-xs text-muted">{programme.label}</div>
            <div className="text-sm" style={{ fontFamily: 'Gopher Heavy', color: 'var(--navy)' }}>
              {semainesPresentes.length} semaines · {creneaux.length} créneaux
            </div>
          </div>
        )}
      </div>

      {/* Cas : aucun programme pour ce niveau → proposer d'en créer un */}
      {!programme && selectedNiveauId && (
        <div className="card" style={{ textAlign: 'center', padding: 40 }}>
          <div className="text-muted mb-16">
            Aucun programme-type n'a encore été créé pour ce niveau.
          </div>
          <button className="btn btn-primary" disabled={creatingForNiveau} onClick={createProgrammeForCurrentNiveau}>
            <Icon name="plus" size={14} />
            {creatingForNiveau ? 'Création…' : 'Créer un programme vide (25 semaines)'}
          </button>
          <div className="help mt-16">
            Tu pourras ensuite ajouter modules et créneaux semaine par semaine.
          </div>
        </div>
      )}

      {/* Cas : un programme existe → afficher ses semaines */}
      {programme && (
        <div>
          {loadingCreneaux && <div className="text-muted text-sm" style={{ padding: 20 }}>Chargement…</div>}

          {!loadingCreneaux && semainesPresentes.map(num => {
            const res = resumeSemaine(num);
            const isOpen = openSemaines[num];
            return (
              <div key={num} className="card" style={{ marginBottom: 8, padding: 0, overflow: 'hidden' }}>
                {/* Ligne résumé de la semaine */}
                <div className="flex-between"
                  style={{ padding: '12px 16px', cursor: 'pointer', alignItems: 'center', gap: 12 }}
                  onClick={() => toggleSemaine(num)}>
                  <div className="flex gap-12" style={{ alignItems: 'center', flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'inline-block', transition: 'transform 0.15s', transform: isOpen ? 'rotate(90deg)' : 'none', color: 'var(--navy)' }}>
                      <Icon name="chevronRight" size={14} />
                    </span>
                    <div style={{ minWidth: 80 }}>
                      <div style={{ fontFamily: 'Gopher Heavy', color: 'var(--navy)', fontSize: 14 }}>
                        S{String(num).padStart(2, '0')}
                      </div>
                    </div>
                    {/* Mini-aperçu : badges des catégories dominantes */}
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', flex: 1 }}>
                      {res.topCats.length === 0 ? (
                        <span className="text-xs text-muted">Aucun module assigné</span>
                      ) : res.topCats.map(([catLabel, count]) => {
                        const col = couleurCategorie(catLabel);
                        return <span key={catLabel}
                          style={{
                            background: col.bg, color: col.fg,
                            padding: '3px 10px', borderRadius: 4, fontSize: 11, fontWeight: 500
                          }}>
                          {catLabel} {count > 1 ? <span style={{ opacity: 0.7 }}>×{count}</span> : ''}
                        </span>;
                      })}
                    </div>
                  </div>
                  <div className="text-xs text-muted" style={{ whiteSpace: 'nowrap' }}>
                    {res.remplis} / {res.total || 10} créneaux
                  </div>
                </div>

                {/* Détail déplié : grille 5 jours × 2 demi-journées */}
                {isOpen && (
                  <div style={{ background: 'var(--bg-alt)', padding: 12, borderTop: '1px solid var(--border)' }}>
                    <table className="programme-grid" style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 4 }}>
                      <thead>
                        <tr>
                          <th style={{ width: 90, textAlign: 'left', fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, padding: '4px 8px' }}>CRÉNEAU</th>
                          {JOURS.map((j, i) => (
                            <th key={j} style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, padding: '4px 8px', textAlign: 'left' }}>
                              {j.toUpperCase()}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {['am', 'pm'].map(periode => (
                          <tr key={periode}>
                            <td style={{ fontSize: 11, color: 'var(--navy)', fontWeight: 700, padding: '8px', whiteSpace: 'nowrap' }}>
                              {periode === 'am' ? 'MATIN' : 'APRÈS-MIDI'}
                            </td>
                            {[1, 2, 3, 4, 5].map(jour => {
                              const cr = findCreneau(num, jour, periode);
                              const info = cr ? moduleInfo(cr.module_id) : null;
                              const style = info ? {
                                background: info.couleur.bg,
                                color: info.couleur.fg,
                                border: '1px solid ' + info.couleur.border,
                              } : {
                                background: '#fff',
                                color: 'var(--text-muted)',
                                border: '1px dashed var(--border)',
                              };
                              return (
                                <td key={jour} style={{ padding: 0 }}>
                                  <div
                                    onClick={() => setEditing({
                                      semaineNum: num, jour, periode,
                                      creneauId: cr?.id || null,
                                      currentModuleId: cr?.module_id || null,
                                    })}
                                    style={{
                                      ...style,
                                      padding: '8px 10px', borderRadius: 6, cursor: 'pointer',
                                      fontSize: 11, fontWeight: 500, minHeight: 44,
                                      display: 'flex', alignItems: 'center',
                                      lineHeight: 1.3,
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
                                    ) : cr ? (
                                      <span style={{ fontStyle: 'italic', opacity: 0.5 }}>+ Assigner</span>
                                    ) : (
                                      <span style={{ fontStyle: 'italic', opacity: 0.4 }}>—</span>
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
        </div>
      )}

      {/* MODALE : sélection d'un module pour le créneau */}
      {editing && (
        <ModalChoixModule
          editing={editing}
          categories={categories}
          modules={modules}
          onSave={saveCreneauModule}
          onClear={() => saveCreneauModule(null)}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
};

// ============================================================
// MODALE de choix de module pour un créneau
// ============================================================
const ModalChoixModule = ({ editing, categories, modules, onSave, onClear, onClose }) => {
  const [search, setSearch] = useState('');
  const [selectedCatId, setSelectedCatId] = useState('all');

  // Modules filtrés selon search + catégorie
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return modules
      .filter(m => selectedCatId === 'all' || m.categorie_id === selectedCatId)
      .filter(m => !q || m.label.toLowerCase().includes(q))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [modules, search, selectedCatId]);

  // Groupement par catégorie pour l'affichage
  const grouped = useMemo(() => {
    const map = {};
    filtered.forEach(m => {
      const cat = categories.find(c => c.id === m.categorie_id);
      const catLabel = cat?.label || '— Sans catégorie —';
      (map[catLabel] = map[catLabel] || []).push(m);
    });
    return map;
  }, [filtered, categories]);

  const jourLabel = JOURS[editing.jour - 1];
  const periodeLabel = editing.periode === 'am' ? 'matin' : 'après-midi';

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}
        style={{ maxWidth: 640, maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
        <div className="modal-head">
          <h3>S{String(editing.semaineNum).padStart(2, '0')} · {jourLabel} {periodeLabel}</h3>
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
            const col = couleurCategorie(catLabel);
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
