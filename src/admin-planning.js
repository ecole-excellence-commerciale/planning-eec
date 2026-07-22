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

// Couleurs du calque « disponibilités intervenant » (2 sélections max simultanées).
// Choisies distinctes du navy/cyan de la charte et de l'orange des conflits,
// pour rester lisibles en surimpression sur les pastilles de catégorie.
const DISPO_OVERLAY_COLORS = ['#059669', '#7c3aed']; // émeraude, violet
const withAlpha = (hex, a) => {
  const n = hex.replace('#', '');
  const r = parseInt(n.slice(0, 2), 16);
  const g = parseInt(n.slice(2, 4), 16);
  const b = parseInt(n.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
};

// Outil de vérification : types de conflit détectables sur un planning.
// code = badge 1 lettre affiché sur la case ; priorité = ordre de l'anneau coloré.
const CONFLICT_META = {
  indispo:          { code: 'D', color: '#dc2626', label: 'Intervenant assigné mais non disponible', priorite: 3 },
  non_qualifie:     { code: 'Q', color: '#9333ea', label: 'Intervenant non qualifié pour ce module', priorite: 2 },
  sans_intervenant: { code: 'I', color: '#d97706', label: 'Créneau avec module mais sans intervenant', priorite: 1 },
};

// Statuts de validation d'un créneau (ordre = niveau de verrouillage croissant)
const STATUT_ORDRE = ['provisoire', 'cale', 'confirme'];
const STATUT_META = {
  provisoire: { label: 'Provisoire', icon: '',   color: '#94a3b8', desc: 'Modifiable et déplaçable librement' },
  cale:       { label: 'Calé',       icon: '📌', color: '#ea580c', desc: 'À ne plus bouger — modification possible avec avertissement' },
  confirme:   { label: 'Confirmé',   icon: '🔒', color: '#16a34a', desc: 'Validé avec l’intervenant — verrou fort' },
};
const statutOf = (entry) => (entry && entry.statut_validation) || 'provisoire';

const PagePlanning = ({ data, onReload }) => {
  const toast = useToast();
  const { promos, niveaux, categories, sousCategories = [], modules, intervenants, campagne } = data;

  // Sélection de la promo (par défaut la 1ère)
  const [selectedPromoId, setSelectedPromoId] = useState(() => promos[0]?.id || null);
  const promo = promos.find(p => p.id === selectedPromoId) || null;
  const niveau = promo ? niveaux.find(n => n.id === promo.niveau_id) : null;

  // Catégories et modules filtrés par le niveau de la promo
  // (les promos Bac+2 ne voient que les modules Bac+2, idem Mastère)
  const categoriesNiveau = useMemo(
    () => promo ? categories.filter(c => c.niveau_id === promo.niveau_id) : categories,
    [categories, promo]
  );
  const modulesNiveau = useMemo(() => {
    if (!promo) return modules;
    const catIds = new Set(categoriesNiveau.map(c => c.id));
    return modules.filter(m => catIds.has(m.categorie_id));
  }, [modules, categoriesNiveau, promo]);

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
    setDispoOverlayIds([]); // le calque repart à zéro si la campagne change
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
  const sousCategorieById = useMemo(() => Object.fromEntries(sousCategories.map(s => [s.id, s])), [sousCategories]);
  const intervenantById = useMemo(
    () => Object.fromEntries((intervenants || []).map(i => [i.id, i])),
    [intervenants]
  );
  const promoById = useMemo(() => Object.fromEntries(promos.map(p => [p.id, p])), [promos]);

  // Avancement de la validation sur la promo courante (créneaux ayant un module)
  const validationStats = useMemo(() => {
    let provisoire = 0, cale = 0, confirme = 0;
    for (const e of planning) {
      if (!e.module_id) continue;
      const s = e.statut_validation || 'provisoire';
      if (s === 'confirme') confirme++;
      else if (s === 'cale') cale++;
      else provisoire++;
    }
    return { provisoire, cale, confirme, total: provisoire + cale + confirme };
  }, [planning]);

  // ─── Sélection multiple pour affectation bulk ─────────────────────────
  const [selectionMode, setSelectionMode] = useState(false);
  // Map de cellKey ("num-date-periode") → { planningId, semaineNum, dateJour, periode, currentModuleId, currentIntervenantId }
  const [selectedCells, setSelectedCells] = useState(new Map());
  const [bulkModalOpen, setBulkModalOpen] = useState(false);       // affectation intervenant
  const [bulkModuleModalOpen, setBulkModuleModalOpen] = useState(false); // affectation module

  // ─── Synchronisation planning ← programme-type ────────────────────────
  const [syncModalOpen, setSyncModalOpen] = useState(false);
  // Appliquer la sync : un seul upsert batch, puis rechargement du planning.
  // Les intervenants déjà affectés sont préservés (non spécifiés dans le payload).
  const appliquerSyncProgramme = async (rows) => {
    try {
      const n = await db.syncPlanningModules(rows);
      const fresh = await db.getPromoPlanning(promo.id);
      setPlanning(fresh);
      setSyncModalOpen(false);
      toast(`${n} créneau${n > 1 ? 'x' : ''} mis à jour depuis le programme`, 'success');
    } catch (e) {
      console.error(e);
      toast('Erreur lors de la synchronisation', 'error');
    }
  };

  // ─── Calque « disponibilités intervenant » (2 max) ────────────────────
  // dispoOverlayIds : tableau ordonné d'intervenant_id (l'index → couleur).
  const [dispoOverlayIds, setDispoOverlayIds] = useState([]);

  const toggleDispoOverlay = (intervenantId) => {
    setDispoOverlayIds(prev => {
      if (prev.includes(intervenantId)) return prev.filter(id => id !== intervenantId);
      if (prev.length >= 2) return prev; // plafond à 2 pour rester lisible
      return [...prev, intervenantId];
    });
  };

  // Intervenants ayant au moins une dispo sur la campagne courante (triés par nom).
  // On propose en priorité ceux du niveau de la promo, mais sans exclure les autres.
  const intervenantsAvecDispo = useMemo(() => {
    const idsAvecDispo = new Set(disposIntervenants.map(d => d.intervenant_id));
    return (intervenants || [])
      .filter(i => idsAvecDispo.has(i.id))
      .map(i => ({
        ...i,
        _duNiveau: niveau ? (i.niveaux || []).includes(niveau.id) : true,
      }))
      .sort((a, b) =>
        (b._duNiveau - a._duNiveau) ||
        (a.nom || '').localeCompare(b.nom || '') ||
        (a.prenom || '').localeCompare(b.prenom || '')
      );
  }, [intervenants, disposIntervenants, niveau]);

  // Pour chaque intervenant affiché en calque : un Set de clés "date|periode"
  // → test O(1) par cellule. Recalculé seulement si la sélection ou les dispos changent.
  const dispoSetsByIntervenant = useMemo(() => {
    const map = {};
    for (const id of dispoOverlayIds) {
      map[id] = new Set(
        disposIntervenants
          .filter(d => d.intervenant_id === id)
          .map(d => `${d.date}|${d.periode}`)
      );
    }
    return map;
  }, [dispoOverlayIds, disposIntervenants]);

  // Couleur d'un intervenant selon sa position dans la sélection (0 ou 1).
  const couleurDispo = (intervenantId) => {
    const idx = dispoOverlayIds.indexOf(intervenantId);
    return idx === -1 ? null : DISPO_OVERLAY_COLORS[idx];
  };

  // ─── Outil de vérification des conflits ───────────────────────────────
  const [verifMode, setVerifMode] = useState(false);

  // Lookups dispo réutilisables pour TOUS les intervenants (pas seulement le calque)
  const dispoSetByInterv = useMemo(() => {
    const map = {};
    for (const d of disposIntervenants) {
      (map[d.intervenant_id] = map[d.intervenant_id] || new Set()).add(`${d.date}|${d.periode}`);
    }
    return map;
  }, [disposIntervenants]);

  // Analyse du planning courant : pour chaque créneau, la liste de ses conflits.
  // Renvoie { byEntryId: {id: [types]}, liste: [{entry, types, sousDispo}], compteurs }
  const verif = useMemo(() => {
    const byEntryId = {};
    const liste = [];
    const compteurs = { indispo: 0, non_qualifie: 0, sans_intervenant: 0 };
    for (const e of planning) {
      if (!e.module_id) continue; // case vide = pas un conflit
      const types = [];
      let sousDispo = null; // 'inconnu' (aucune dispo renseignée) | 'autre' (dispo ailleurs)
      if (!e.intervenant_id) {
        types.push('sans_intervenant');
      } else {
        // Disponibilité
        const set = dispoSetByInterv[e.intervenant_id];
        const estDispo = set && set.has(`${e.date_jour}|${e.periode}`);
        if (!estDispo) {
          types.push('indispo');
          sousDispo = set ? 'autre' : 'inconnu';
        }
        // Qualification (note sur la sous-catégorie du module)
        const mod = moduleById[e.module_id];
        const scid = mod?.sous_categorie_id;
        const note = scid ? (intervenantById[e.intervenant_id]?.ratings?.[scid] || null) : null;
        if (!note) types.push('non_qualifie');
      }
      if (types.length) {
        byEntryId[e.id] = types;
        liste.push({ entry: e, types, sousDispo });
        types.forEach(t => { compteurs[t]++; });
      }
    }
    liste.sort((a, b) =>
      a.entry.date_jour.localeCompare(b.entry.date_jour) ||
      (a.entry.periode === 'am' ? -1 : 1)
    );
    return { byEntryId, liste, compteurs, total: liste.length };
  }, [planning, dispoSetByInterv, moduleById, intervenantById]);

  // Anneau coloré d'une case = conflit de plus haute priorité
  const couleurAnneau = (types) => {
    let best = null;
    for (const t of types) {
      if (!best || CONFLICT_META[t].priorite > CONFLICT_META[best].priorite) best = t;
    }
    return best ? CONFLICT_META[best].color : null;
  };

  // Réinitialiser la sélection si on change de promo
  useEffect(() => {
    setSelectionMode(false);
    setSelectedCells(new Map());
    setBulkModalOpen(false);
    setBulkModuleModalOpen(false);
    setVerifMode(false);
  }, [promo?.id]);

  const toggleCellSelection = (cellKey, cellInfo) => {
    setSelectedCells(prev => {
      const next = new Map(prev);
      if (next.has(cellKey)) next.delete(cellKey);
      else next.set(cellKey, cellInfo);
      return next;
    });
  };

  const clearSelection = () => setSelectedCells(new Map());

  const exitSelectionMode = () => {
    setSelectionMode(false);
    setSelectedCells(new Map());
  };

  // Cellules sélectionnées sous forme de liste utilisable
  const selectedCellsList = useMemo(() => [...selectedCells.values()], [selectedCells]);

  // Combien des cellules sélectionnées ont déjà un module (= sont éligibles
  // à l'affectation d'intervenant)
  const nbCellsWithModule = selectedCellsList.filter(c => c.currentModuleId).length;

  // Assignation en masse d'un INTERVENANT : applique à toutes les cells qui ont déjà
  // un module (= une entry). Les cellules sans module sont ignorées (impossible
  // d'affecter un intervenant à un créneau qui n'a pas de module).
  const bulkAssignIntervenant = async (intervenantId) => {
    try {
      const cells = selectedCellsList.filter(c => c.planningId);
      await Promise.all(
        cells.map(c => db.setPromoPlanningIntervenant(c.planningId, intervenantId))
      );
      toast(
        intervenantId
          ? `${cells.length} créneau${cells.length > 1 ? 'x' : ''} affecté${cells.length > 1 ? 's' : ''}`
          : `Intervenant retiré sur ${cells.length} créneau${cells.length > 1 ? 'x' : ''}`,
        'success'
      );
      await loadPlanningEtAssignations(promo.id);
      setBulkModalOpen(false);
      exitSelectionMode();
    } catch (e) {
      console.error(e); toast(e.message || 'Erreur', 'error');
    }
  };

  // Assignation en masse d'un MODULE : applique à toutes les cells.
  // Si l'entry existe déjà, update du module_id. Sinon, création d'une nouvelle entry.
  const bulkAssignModule = async (moduleId) => {
    try {
      const cells = selectedCellsList;
      await Promise.all(cells.map(async c => {
        if (c.planningId) {
          // Entry existante : mise à jour du module (pas de toucher à l'intervenant)
          await db.setPromoPlanningModule(c.planningId, moduleId);
        } else if (moduleId) {
          // Pas d'entry et on veut un module : création
          await db.addPromoPlanningEntry(promo.id, c.semaineNum, c.dateJour, c.periode, moduleId);
        }
        // Pas d'entry + pas de module (= "retirer le module" sur une case déjà vide) → no-op
      }));
      toast(
        moduleId
          ? `${cells.length} créneau${cells.length > 1 ? 'x' : ''} affecté${cells.length > 1 ? 's' : ''}`
          : `Module retiré sur ${cells.filter(c => c.planningId).length} créneau${cells.filter(c => c.planningId).length > 1 ? 'x' : ''}`,
        'success'
      );
      await loadPlanningEtAssignations(promo.id);
      setBulkModuleModalOpen(false);
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
    const sousCat = mod.sous_categorie_id ? sousCategorieById[mod.sous_categorie_id] : null;
    return { module: mod, categorie: cat, sousCategorie: sousCat, couleur: couleurCat(cat?.label) };
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
      const lundi = addJours(d, -(dow - 1));
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
    if (!confirmEditionVerrouillee('le module')) return;
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
    if (!confirmEditionVerrouillee('l’intervenant')) return;
    try {
      await db.setPromoPlanningIntervenant(editing.planningId, intervenantId);
      toast(intervenantId ? 'Intervenant assigné' : 'Intervenant retiré', 'success');
      await loadPlanningEtAssignations(promo.id);
      setEditing(prev => prev ? { ...prev, currentIntervenantId: intervenantId } : prev);
    } catch (e) {
      console.error(e); toast(e.message || 'Erreur', 'error');
    }
  };

  // Demande confirmation si le créneau en cours d'édition est calé/confirmé.
  // Renvoie true si on peut continuer, false si l'utilisateur annule.
  const confirmEditionVerrouillee = (quoi) => {
    const st = editing?.currentStatut || 'provisoire';
    if (st === 'provisoire') return true;
    const m = STATUT_META[st];
    return window.confirm(
      `Ce créneau est « ${m.label} » (${m.desc}).\n\nModifier ${quoi} quand même ?`
    );
  };

  // Changer le statut de validation du créneau en cours d'édition
  const saveStatut = async (statut) => {
    if (!editing) return;
    if (!editing.planningId) {
      toast('Assigne d’abord un module à ce créneau', 'error');
      return;
    }
    try {
      await db.setPlanningStatut([editing.planningId], statut);
      toast(`Statut : ${STATUT_META[statut].label}`, 'success');
      await loadPlanningEtAssignations(promo.id);
      setEditing(prev => prev ? { ...prev, currentStatut: statut } : prev);
    } catch (e) {
      console.error(e); toast(e.message || 'Erreur', 'error');
    }
  };

  // Appliquer un statut à la sélection multiple (créneaux ayant un module)
  const bulkSetStatut = async (statut) => {
    const ids = selectedCellsList.filter(c => c.planningId).map(c => c.planningId);
    if (ids.length === 0) {
      toast('Aucun créneau avec module dans la sélection', 'error');
      return;
    }
    try {
      await db.setPlanningStatut(ids, statut);
      toast(`${ids.length} créneau${ids.length > 1 ? 'x' : ''} → ${STATUT_META[statut].label}`, 'success');
      await loadPlanningEtAssignations(promo.id);
      exitSelectionMode();
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
    // Cible verrouillée (calé/confirmé) → on refuse le dépôt
    if (dst.statut && dst.statut !== 'provisoire') {
      toast(`Créneau « ${STATUT_META[dst.statut].label} » : libère-le d’abord (repasse-le en Provisoire)`, 'error');
      return;
    }
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
                  <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 8 }}>
                    <button
                      className={verifMode ? 'btn btn-primary' : 'btn btn-ghost'}
                      onClick={() => setVerifMode(v => !v)}
                      title="Mettre en avant les conflits du planning"
                      style={{ fontSize: 11, padding: '6px 12px' }}>
                      {verifMode ? '✓ Vérification active' : '🔍 Vérifier'}
                    </button>
                    <button
                      className="btn btn-ghost"
                      onClick={() => setSyncModalOpen(true)}
                      title="Mettre à jour ce planning depuis le programme-type"
                      style={{ fontSize: 11, padding: '6px 12px' }}>
                      🔄 Sync programme
                    </button>
                    <button
                      className={selectionMode ? 'btn btn-primary' : 'btn btn-ghost'}
                      onClick={() => selectionMode ? exitSelectionMode() : setSelectionMode(true)}
                      style={{ fontSize: 11, padding: '6px 12px' }}>
                      {selectionMode ? '✗ Quitter la sélection' : '☑ Sélection multiple'}
                    </button>
                  </div>
                  {/* Avancement de la validation */}
                  {validationStats.total > 0 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8, fontSize: 11, color: 'var(--text-muted)' }}>
                      <span style={{ fontWeight: 600 }}>Validation :</span>
                      <div style={{ flex: 1, maxWidth: 240, height: 6, borderRadius: 999, background: 'var(--border)', overflow: 'hidden', display: 'flex' }}>
                        <div style={{ width: `${100 * validationStats.confirme / validationStats.total}%`, background: STATUT_META.confirme.color }} />
                        <div style={{ width: `${100 * validationStats.cale / validationStats.total}%`, background: STATUT_META.cale.color }} />
                      </div>
                      <span title="Confirmés">🔒 {validationStats.confirme}</span>
                      <span title="Calés">📌 {validationStats.cale}</span>
                      <span style={{ opacity: 0.7 }}>· {validationStats.provisoire} provisoire{validationStats.provisoire > 1 ? 's' : ''}</span>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>

          {/* Barre « Voir les disponibilités » — calque transparent (2 max) */}
          {promo && intervenantsAvecDispo.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', background: 'var(--bg-alt, #f7f7fb)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 12px', marginBottom: 12 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--navy)', display: 'flex', alignItems: 'center', gap: 6 }}>
                👁 Voir les dispos
              </span>
              {/* Puces des intervenants affichés */}
              {dispoOverlayIds.map(id => {
                const it = intervenantById[id];
                const col = couleurDispo(id);
                if (!it) return null;
                return (
                  <span key={id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: '#fff', background: col, borderRadius: 999, padding: '4px 8px 4px 10px' }}>
                    {it.prenom} {it.nom}
                    <button onClick={() => toggleDispoOverlay(id)}
                      title="Retirer du calque"
                      style={{ background: 'rgba(255,255,255,0.25)', border: 'none', color: '#fff', borderRadius: 999, width: 16, height: 16, lineHeight: '14px', cursor: 'pointer', fontSize: 11, padding: 0 }}>
                      ✕
                    </button>
                  </span>
                );
              })}
              {/* Sélecteur d'ajout (désactivé à 2) */}
              {dispoOverlayIds.length < 2 ? (
                <select
                  value=""
                  onChange={e => { if (e.target.value) toggleDispoOverlay(e.target.value); }}
                  style={{ fontSize: 12, maxWidth: 240 }}>
                  <option value="">+ Ajouter un intervenant…</option>
                  {intervenantsAvecDispo
                    .filter(i => !dispoOverlayIds.includes(i.id))
                    .map(i => (
                      <option key={i.id} value={i.id}>
                        {i.prenom} {i.nom}{i._duNiveau ? '' : ' (autre niveau)'}
                      </option>
                    ))}
                </select>
              ) : (
                <span className="text-xs text-muted">Maximum 2 intervenants affichés — retirez-en un pour en ajouter un autre.</span>
              )}
              {dispoOverlayIds.length > 0 && (
                <button className="btn btn-ghost" onClick={() => setDispoOverlayIds([])}
                  style={{ fontSize: 11, padding: '4px 10px', marginLeft: 'auto' }}>
                  Tout masquer
                </button>
              )}
            </div>
          )}

          {/* Panneau de vérification des conflits */}
          {verifMode && promo && (
            <VerifPanel
              verif={verif}
              moduleById={moduleById}
              intervenantById={intervenantById}
            />
          )}

          {selectionMode && (
            <div style={{ background: 'var(--cyan-light)', border: '1px solid var(--cyan)', borderRadius: 6, padding: '8px 12px', marginBottom: 12, fontSize: 12, color: 'var(--navy)' }}>
              <strong>Mode sélection actif :</strong> cliquez sur les cases (vides ou occupées) pour les ajouter à la sélection.
              La barre en bas vous permettra ensuite d'y affecter le même module et/ou le même intervenant en un clic.
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
            const venD = lundiD ? addJours(lundiD, 4) : null;
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
                            const dateJour = lundiD ? addJours(lundiD, i) : null;
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
                              const dateJour = lundiD ? isoDate(addJours(lundiD, jourIdx)) : null;
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
                                statut: statutOf(entry),
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
                              // En mode sélection : TOUTES les cases sont sélectionnables
                              // (avec ou sans module — pour pouvoir bulk-assigner un module à des cases vides)
                              const selCellKey = `${num}-${dateJour}-${periode}`;
                              const isSelectable = selectionMode;
                              const isSelected = selectionMode && selectedCells.has(selCellKey);
                              const selectStyle = isSelected ? {
                                outline: '3px solid var(--cyan)',
                                outlineOffset: -2,
                              } : {};
                              const statut = statutOf(entry);
                              const statutMeta = statut !== 'provisoire' ? STATUT_META[statut] : null;
                              // Seuls les créneaux "provisoire" sont déplaçables (calé/confirmé = verrouillés)
                              const draggable = !!(entry && info) && !selectionMode && statut === 'provisoire';
                              // Calque dispos : quels intervenants sélectionnés sont dispo ici ?
                              const dispoActifs = dateJour
                                ? dispoOverlayIds.filter(id => dispoSetsByIntervenant[id]?.has(`${dateJour}|${periode}`))
                                : [];
                              // Vérification : conflits de cette case (si le mode est actif)
                              const cellConflicts = (verifMode && entry) ? (verif.byEntryId[entry.id] || null) : null;
                              const verifDim = verifMode && entry && !cellConflicts; // toute case OK/vide → estompée
                              const anneauConflit = cellConflicts ? couleurAnneau(cellConflicts) : null;
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
                                        toggleCellSelection(selCellKey, {
                                          planningId: entry?.id || null,
                                          semaineNum: num,
                                          dateJour,
                                          periode,
                                          currentModuleId: entry?.module_id || null,
                                          currentIntervenantId: entry?.intervenant_id || null,
                                        });
                                        return;
                                      }
                                      setEditing({
                                        planningId: entry?.id || null,
                                        semaineNum: num,
                                        dateJour,
                                        periode,
                                        currentModuleId: entry?.module_id || null,
                                        currentIntervenantId: entry?.intervenant_id || null,
                                        currentStatut: statutOf(entry),
                                      });
                                    }}
                                    title={selectionMode
                                      ? 'Cliquer pour (dé)sélectionner'
                                      : (info ? 'Glisser pour déplacer, cliquer pour modifier' : 'Cliquer pour assigner un module')}
                                    style={{
                                      ...baseStyle,
                                      ...hoverStyle,
                                      ...sourceStyle,
                                      ...selectStyle,
                                      ...(anneauConflit ? { outline: `3px solid ${anneauConflit}`, outlineOffset: -2 } : {}),
                                      ...(statutMeta ? { boxShadow: `inset 4px 0 0 0 ${statutMeta.color}` } : {}),
                                      padding: '8px 10px', borderRadius: 6,
                                      cursor: selectionMode ? 'pointer' : (draggable ? 'grab' : 'pointer'),
                                      fontSize: 11, fontWeight: 500, minHeight: 44,
                                      display: 'flex', alignItems: 'center', lineHeight: 1.3,
                                      opacity: isDragSource ? 0.35 : (verifDim ? 0.4 : (info ? 1 : 0.6)),
                                      transition: 'background 0.1s, outline 0.1s, opacity 0.1s',
                                    }}>
                                    {/* Badge statut de validation (📌 calé / 🔒 confirmé) */}
                                    {statutMeta && (
                                      <div title={`${statutMeta.label} — ${statutMeta.desc}`} style={{
                                        position: 'absolute', bottom: 3, right: 4,
                                        fontSize: 10, lineHeight: 1, pointerEvents: 'none',
                                      }}>
                                        {statutMeta.icon}
                                      </div>
                                    )}
                                    {/* Indicateur de sélection */}
                                    {selectionMode && (
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
                                        {info.sousCategorie && info.sousCategorie.label !== 'Général' && (
                                          <div style={{ opacity: 0.55, fontSize: 9, fontStyle: 'italic', marginTop: 1 }}>
                                            {info.sousCategorie.label}
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
                                                    title={'Déjà affecté en parallèle : ' + conflits.join(', ')}
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
                                  {/* Calque « disponibilités » — translucide, non bloquant */}
                                  {dispoActifs.length > 0 && (
                                    <div style={{
                                      position: 'absolute', inset: 0, borderRadius: 6,
                                      pointerEvents: 'none', overflow: 'hidden',
                                      background: dispoActifs.length === 2
                                        ? `linear-gradient(135deg, ${withAlpha(couleurDispo(dispoActifs[0]), 0.18)} 0 50%, ${withAlpha(couleurDispo(dispoActifs[1]), 0.18)} 50% 100%)`
                                        : withAlpha(couleurDispo(dispoActifs[0]), 0.16),
                                    }}>
                                      {/* Liseré(s) en haut : un segment par intervenant dispo */}
                                      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 4, display: 'flex' }}>
                                        {dispoActifs.map(id => (
                                          <div key={id} style={{ flex: 1, background: couleurDispo(id) }} />
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                  {/* Badges de conflit (mode vérification) */}
                                  {cellConflicts && (
                                    <div style={{ position: 'absolute', top: 4, right: 4, display: 'flex', gap: 3, pointerEvents: 'none' }}>
                                      {cellConflicts.map(t => (
                                        <span key={t} title={CONFLICT_META[t].label}
                                          style={{
                                            width: 16, height: 16, borderRadius: 4,
                                            background: CONFLICT_META[t].color, color: '#fff',
                                            fontSize: 10, fontWeight: 800,
                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            boxShadow: '0 1px 2px rgba(0,0,0,0.25)',
                                          }}>
                                          {CONFLICT_META[t].code}
                                        </span>
                                      ))}
                                    </div>
                                  )}
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
          categories={categoriesNiveau}
          modules={modulesNiveau}
          intervenants={intervenants || []}
          disposIntervenants={disposIntervenants}
          assignationsAutres={assignationsAutres}
          promoById={promoById}
          moduleById={moduleById}
          categorieById={categorieById}
          sousCategorieById={sousCategorieById}
          onSaveModule={saveModule}
          onClearModule={() => saveModule(null, true)}
          onSaveIntervenant={saveIntervenant}
          onSaveStatut={saveStatut}
          onClose={() => setEditing(null)}
        />
      )}

      {/* Barre sticky en bas — mode sélection multiple */}
      {selectionMode && selectedCells.size > 0 && (
        <div style={{
          position: 'fixed', bottom: 0, left: 0, right: 0,
          background: 'var(--navy)', color: '#fff',
          padding: '14px 24px',
          display: 'flex', alignItems: 'center', gap: 12,
          boxShadow: '0 -4px 16px rgba(0,0,0,0.15)',
          zIndex: 50,
        }}>
          <div style={{ flex: 1 }}>
            <strong style={{ fontSize: 16 }}>
              {selectedCells.size} créneau{selectedCells.size > 1 ? 'x' : ''} sélectionné{selectedCells.size > 1 ? 's' : ''}
            </strong>
            <span style={{ marginLeft: 12, opacity: 0.8, fontSize: 12 }}>
              Choisis l'action en lot à appliquer
            </span>
          </div>
          <button className="btn btn-ghost" onClick={clearSelection}
            style={{ color: '#fff', borderColor: 'rgba(255,255,255,0.3)' }}>
            Tout désélectionner
          </button>
          <button className="btn btn-primary" onClick={() => setBulkModuleModalOpen(true)}
            style={{ background: 'var(--cyan)', color: 'var(--navy)', borderColor: 'var(--cyan)' }}>
            <Icon name="plus" size={14} /> Assigner un module
          </button>
          <button className="btn btn-primary"
            onClick={() => setBulkModalOpen(true)}
            disabled={nbCellsWithModule === 0}
            title={nbCellsWithModule === 0
              ? 'Affecte d\'abord un module aux créneaux sélectionnés'
              : (nbCellsWithModule < selectedCells.size
                  ? `Sera appliqué sur les ${nbCellsWithModule} créneaux ayant déjà un module`
                  : '')}
            style={{ opacity: nbCellsWithModule === 0 ? 0.5 : 1 }}>
            <Icon name="user" size={14} /> Assigner un intervenant
            {nbCellsWithModule > 0 && nbCellsWithModule < selectedCells.size && (
              <span style={{ marginLeft: 6, fontSize: 11, opacity: 0.85 }}>
                ({nbCellsWithModule}/{selectedCells.size})
              </span>
            )}
          </button>
          <div style={{ width: 1, alignSelf: 'stretch', background: 'rgba(255,255,255,0.25)', margin: '0 2px' }} />
          <span style={{ fontSize: 12, opacity: 0.8 }}>Statut :</span>
          {STATUT_ORDRE.map(st => {
            const m = STATUT_META[st];
            return (
              <button key={st} className="btn btn-ghost"
                onClick={() => bulkSetStatut(st)}
                disabled={nbCellsWithModule === 0}
                title={nbCellsWithModule === 0 ? 'Affecte d’abord un module' : m.desc}
                style={{
                  color: '#fff', borderColor: m.color, background: 'transparent',
                  opacity: nbCellsWithModule === 0 ? 0.4 : 1, fontSize: 12, padding: '6px 10px',
                }}>
                {m.icon ? m.icon + ' ' : ''}{m.label}
              </button>
            );
          })}
        </div>
      )}

      {/* Modale d'affectation en masse d'un INTERVENANT */}
      {bulkModalOpen && (
        <ModalAffectationBulk
          selectedCells={selectedCellsList.filter(c => c.planningId).map(c => ({
            id: c.planningId, date_jour: c.dateJour, periode: c.periode,
            module_id: c.currentModuleId,
          }))}
          planning={planning}
          promo={promo}
          niveau={niveau}
          intervenants={intervenants || []}
          disposIntervenants={disposIntervenants}
          assignationsAutres={assignationsAutres}
          promoById={promoById}
          moduleById={moduleById}
          categorieById={categorieById}
          sousCategorieById={sousCategorieById}
          onAssign={bulkAssignIntervenant}
          onClose={() => setBulkModalOpen(false)}
        />
      )}

      {/* Modale d'affectation en masse d'un MODULE */}
      {bulkModuleModalOpen && (
        <ModalAffectationModuleBulk
          selectedCells={selectedCellsList}
          promo={promo}
          categories={categoriesNiveau}
          modules={modulesNiveau}
          sousCategorieById={sousCategorieById}
          categorieById={categorieById}
          onAssign={bulkAssignModule}
          onClose={() => setBulkModuleModalOpen(false)}
        />
      )}

      {/* Modale de synchronisation planning ← programme-type */}
      {syncModalOpen && promo && (
        <ModalSyncProgramme
          promo={promo}
          planning={planning}
          moduleById={moduleById}
          onApply={appliquerSyncProgramme}
          onClose={() => setSyncModalOpen(false)}
        />
      )}
    </div>
  );
};

// ============================================================
// PANNEAU — vérification des conflits du planning
// ============================================================
// Récap + détail des 3 types de conflit. N'effectue aucune écriture :
// il met seulement en avant ce qui mérite l'attention de l'admin.
const VerifPanel = ({ verif, moduleById, intervenantById }) => {
  const [showDetails, setShowDetails] = useState(false);
  const { compteurs, liste, total } = verif;

  const fmtCase = (e) => {
    const d = new Date(e.date_jour + 'T00:00:00');
    return `S${String(e.semaine_num).padStart(2, '0')} · ${d.toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: 'short' })} ${e.periode === 'am' ? 'matin' : 'a-m'}`;
  };

  if (total === 0) {
    return (
      <div style={{ background: '#ecfdf5', border: '1px solid #6ee7b7', borderRadius: 8, padding: '12px 14px', marginBottom: 12, fontSize: 13, color: '#065f46', fontWeight: 600 }}>
        ✓ Aucun conflit détecté sur ce planning. 🎉
      </div>
    );
  }

  // Détail groupé par type
  const ordreTypes = ['indispo', 'non_qualifie', 'sans_intervenant'];

  return (
    <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 14px', marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <strong style={{ fontSize: 13, color: 'var(--navy)' }}>
          {total} créneau{total > 1 ? 'x' : ''} à vérifier
        </strong>
        {ordreTypes.map(t => compteurs[t] > 0 && (
          <span key={t} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
            <span style={{ width: 16, height: 16, borderRadius: 4, background: CONFLICT_META[t].color, color: '#fff', fontSize: 10, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {CONFLICT_META[t].code}
            </span>
            <span style={{ color: 'var(--text-muted)' }}>{compteurs[t]} · {CONFLICT_META[t].label}</span>
          </span>
        ))}
        <button className="btn btn-ghost" style={{ fontSize: 11, padding: '4px 10px', marginLeft: 'auto' }}
          onClick={() => setShowDetails(s => !s)}>
          {showDetails ? 'Masquer le détail' : 'Voir le détail'}
        </button>
      </div>

      <div className="text-xs text-muted" style={{ marginTop: 6 }}>
        Les cases concernées sont entourées et marquées sur la grille (les cases sans conflit sont estompées). Clique une case pour la corriger.
      </div>

      {showDetails && (
        <div style={{ marginTop: 10, border: '1px solid var(--border)', borderRadius: 6, maxHeight: 260, overflowY: 'auto' }}>
          {liste.map(({ entry, types, sousDispo }) => {
            const mod = moduleById[entry.module_id];
            const interv = entry.intervenant_id ? intervenantById[entry.intervenant_id] : null;
            return (
              <div key={entry.id} style={{ padding: '8px 12px', borderBottom: '1px solid var(--bg-alt)', fontSize: 12, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <span style={{ whiteSpace: 'nowrap', color: 'var(--text-muted)', minWidth: 130 }}>{fmtCase(entry)}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontWeight: 600 }}>{mod?.label || 'Module ?'}</span>
                  {interv && <span className="text-muted"> — {interv.prenom} {interv.nom}</span>}
                  <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 3 }}>
                    {types.map(t => (
                      <span key={t} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: CONFLICT_META[t].color, fontWeight: 600 }}>
                        <span style={{ width: 14, height: 14, borderRadius: 3, background: CONFLICT_META[t].color, color: '#fff', fontSize: 9, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{CONFLICT_META[t].code}</span>
                        {t === 'indispo'
                          ? (sousDispo === 'inconnu' ? 'Aucune dispo renseignée' : 'Pas dispo ce créneau')
                          : (t === 'non_qualifie' ? 'Non qualifié' : 'Sans intervenant')}
                      </span>
                    ))}
                  </span>
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

// ============================================================
// MODALE — synchronisation du planning d'une promo depuis son programme-type
// ============================================================
// Diagnostic AVANT toute modification :
//   🟢 cases vides du planning qui ont un module dans le programme → "à remplir"
//   🟠 cases dont le module diffère du programme → "différentes" (écrasement opt-in)
//   📌 cases avec un module mais rien dans le programme → JAMAIS touchées
// Deux modes : "compléter" (vides uniquement, défaut) ou "aligner" (vides + différentes).
// Les intervenants déjà affectés sont toujours conservés.
const ModalSyncProgramme = ({ promo, planning, moduleById, onApply, onClose }) => {
  const [creneaux, setCreneaux] = useState(null); // null = chargement en cours
  const [erreur, setErreur] = useState(null);
  const [mode, setMode] = useState('completer'); // 'completer' | 'aligner'
  const [saving, setSaving] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  // Charger le programme-type de la promo
  useEffect(() => {
    if (!promo.programme_type_id) {
      setErreur("Cette promo n'est rattachée à aucun programme-type.");
      return;
    }
    db.getProgrammeCreneaux(promo.programme_type_id)
      .then(setCreneaux)
      .catch(e => { console.error(e); setErreur('Impossible de charger le programme.'); });
  }, [promo.id]);

  // Diff planning ↔ programme (clé = semaine_num + jour de semaine + période)
  const diff = useMemo(() => {
    if (!creneaux) return null;
    const pcByKey = {};
    creneaux.forEach(c => { pcByKey[`${c.semaine_num}-${c.jour}-${c.periode}`] = c; });
    const aRemplir = [], aEcraser = [], horsProgramme = [];
    let identiques = 0;
    for (const e of planning) {
      const d = new Date(e.date_jour + 'T00:00:00');
      const jour = d.getDay(); // 1 = lundi … 5 = vendredi (pas de week-end en planning)
      const pc = pcByKey[`${e.semaine_num}-${jour}-${e.periode}`];
      const target = pc?.module_id || null;
      if (target && !e.module_id) aRemplir.push({ entry: e, target });
      else if (target && e.module_id && target !== e.module_id) aEcraser.push({ entry: e, target });
      else if (!target && e.module_id) horsProgramme.push(e);
      else if (target && target === e.module_id) identiques++;
    }
    return { aRemplir, aEcraser, horsProgramme, identiques };
  }, [creneaux, planning]);

  const selection = diff
    ? (mode === 'aligner' ? [...diff.aRemplir, ...diff.aEcraser] : diff.aRemplir)
    : [];
  const nbIntervenantsConserves = diff
    ? diff.aEcraser.filter(({ entry }) => entry.intervenant_id).length
    : 0;

  const handleApply = async () => {
    if (selection.length === 0) return;
    const rows = selection.map(({ entry, target }) => ({
      promo_id: promo.id,
      semaine_num: entry.semaine_num,
      date_jour: entry.date_jour,
      periode: entry.periode,
      module_id: target,
    }));
    setSaving(true);
    try { await onApply(rows); } finally { setSaving(false); }
  };

  const fmtCase = (e) => {
    const d = new Date(e.date_jour + 'T00:00:00');
    return `S${String(e.semaine_num).padStart(2, '0')} · ${d.toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: 'short' })} ${e.periode === 'am' ? 'matin' : 'a-m'}`;
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}
        style={{ maxWidth: 640, maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
        <div className="modal-head">
          <div>
            <h3 style={{ marginBottom: 4 }}>Synchroniser avec le programme</h3>
            <div className="text-xs text-muted">
              ⓘ Promo <strong>{promo.label}</strong> — le planning est comparé au programme-type,
              puis seules les cases que vous validez ci-dessous sont mises à jour.
              Les intervenants déjà affectés sont <strong>toujours conservés</strong>.
            </div>
          </div>
          <div className="modal-close" onClick={onClose}><Icon name="x" size={16} /></div>
        </div>

        {erreur && (
          <div style={{ color: 'var(--danger)', fontSize: 13, padding: '16px 0' }}>{erreur}</div>
        )}

        {!erreur && !diff && (
          <div className="text-muted text-sm" style={{ padding: 20 }}>Analyse du programme…</div>
        )}

        {!erreur && diff && (
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {/* Diagnostic */}
            <div style={{ border: '1px solid var(--border)', borderRadius: 6, padding: '10px 14px', marginBottom: 14, fontSize: 13, lineHeight: 1.7 }}>
              <div>🟢 <strong>{diff.aRemplir.length}</strong> case{diff.aRemplir.length > 1 ? 's' : ''} vide{diff.aRemplir.length > 1 ? 's' : ''} à remplir depuis le programme</div>
              <div>🟠 <strong>{diff.aEcraser.length}</strong> case{diff.aEcraser.length > 1 ? 's' : ''} avec un module <em>différent</em> du programme</div>
              <div className="text-muted">✓ {diff.identiques} déjà identique{diff.identiques > 1 ? 's' : ''} · 📌 {diff.horsProgramme.length} remplie{diff.horsProgramme.length > 1 ? 's' : ''} hors programme (jamais touchée{diff.horsProgramme.length > 1 ? 's' : ''})</div>
            </div>

            {diff.aRemplir.length === 0 && diff.aEcraser.length === 0 ? (
              <div className="text-sm" style={{ padding: '8px 0', color: 'var(--navy)' }}>
                ✓ Le planning est déjà à jour par rapport au programme. Rien à faire !
              </div>
            ) : (
              <>
                {/* Choix du mode */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
                  <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', cursor: 'pointer', fontSize: 13 }}>
                    <input type="radio" name="syncmode" checked={mode === 'completer'}
                      onChange={() => setMode('completer')} style={{ marginTop: 3 }} />
                    <span>
                      <strong>Compléter uniquement les cases vides</strong> ({diff.aRemplir.length})
                      <div className="text-xs text-muted">Aucun module existant n'est modifié. Recommandé.</div>
                    </span>
                  </label>
                  <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', cursor: diff.aEcraser.length === 0 ? 'not-allowed' : 'pointer', fontSize: 13, opacity: diff.aEcraser.length === 0 ? 0.5 : 1 }}>
                    <input type="radio" name="syncmode" checked={mode === 'aligner'}
                      disabled={diff.aEcraser.length === 0}
                      onChange={() => setMode('aligner')} style={{ marginTop: 3 }} />
                    <span>
                      <strong>Aligner aussi les cases différentes</strong> ({diff.aRemplir.length + diff.aEcraser.length})
                      <div className="text-xs text-muted">
                        ⚠ Remplace le module sur {diff.aEcraser.length} case{diff.aEcraser.length > 1 ? 's' : ''} déjà remplie{diff.aEcraser.length > 1 ? 's' : ''}.
                        {nbIntervenantsConserves > 0 && <> L'intervenant reste affecté sur {nbIntervenantsConserves} d'entre elles : vérifiez qu'il est qualifié pour le nouveau module.</>}
                      </div>
                    </span>
                  </label>
                </div>

                {/* Détail des changements */}
                <button className="btn btn-ghost" style={{ fontSize: 11, padding: '4px 10px', marginBottom: 8 }}
                  onClick={() => setShowDetails(s => !s)}>
                  {showDetails ? 'Masquer le détail' : `Voir le détail (${selection.length})`}
                </button>
                {showDetails && (
                  <div style={{ border: '1px solid var(--border)', borderRadius: 6, maxHeight: 220, overflowY: 'auto', fontSize: 12, marginBottom: 8 }}>
                    {selection
                      .slice()
                      .sort((a, b) => a.entry.date_jour.localeCompare(b.entry.date_jour) || a.entry.periode.localeCompare(b.entry.periode))
                      .map(({ entry, target }) => (
                        <div key={entry.id} style={{ padding: '6px 12px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8, alignItems: 'baseline' }}>
                          <span style={{ whiteSpace: 'nowrap', color: 'var(--text-muted)' }}>{fmtCase(entry)}</span>
                          <span style={{ flex: 1 }}>
                            {entry.module_id
                              ? <><s style={{ color: 'var(--text-muted)' }}>{moduleById[entry.module_id]?.label || '?'}</s> → <strong>{moduleById[target]?.label || '?'}</strong></>
                              : <><em style={{ color: 'var(--text-muted)' }}>vide</em> → <strong>{moduleById[target]?.label || '?'}</strong></>}
                          </span>
                        </div>
                      ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        <div className="flex gap-8" style={{ marginTop: 14, justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary"
            disabled={saving || !diff || selection.length === 0}
            onClick={handleApply}>
            {saving ? 'Application…' : `Appliquer (${selection.length} case${selection.length > 1 ? 's' : ''})`}
          </button>
        </div>
      </div>
    </div>
  );
};

// ============================================================
// MODALE — choix de module pour un créneau de promo
// (locale à la promo, ne modifie PAS le programme-type)
// ============================================================
const ModalEditeurCreneau = ({
  editing, promo, niveau, categories, modules, intervenants,
  disposIntervenants, assignationsAutres, promoById, moduleById, categorieById, sousCategorieById,
  onSaveModule, onClearModule, onSaveIntervenant, onSaveStatut, onClose,
}) => {
  // Onglet actif (par défaut "module" si pas de module assigné, sinon "intervenant"
  // pour aller plus vite à l'étape suivante)
  const [activeTab, setActiveTab] = useState(editing.currentModuleId ? 'intervenant' : 'module');

  // Formater la date du créneau
  const d = new Date(editing.dateJour + 'T00:00:00');
  const dateLabel = d.toLocaleDateString('fr-FR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
  const periodeLabel = editing.periode === 'am' ? 'matin' : 'après-midi';

  // Module actuel, sous-catégorie et catégorie associées
  const currentModule = editing.currentModuleId ? moduleById[editing.currentModuleId] : null;
  const currentSousCategorie = currentModule?.sous_categorie_id
    ? (sousCategorieById?.[currentModule.sous_categorie_id] || null) : null;
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
              <div>
                <div style={{ fontWeight: 600, color: 'var(--navy)' }}>{currentModule.label}</div>
                {currentCategorie && (
                  <div style={{ opacity: 0.7, fontSize: 11, marginTop: 2 }}>
                    {currentCategorie.label}
                    {currentSousCategorie && currentSousCategorie.label !== 'Général' && (
                      <span style={{ marginLeft: 4 }}>· <em>{currentSousCategorie.label}</em></span>
                    )}
                  </div>
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

        {/* Statut de validation du créneau */}
        {editing.planningId ? (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
              Statut de validation
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {STATUT_ORDRE.map(st => {
                const m = STATUT_META[st];
                const actif = (editing.currentStatut || 'provisoire') === st;
                return (
                  <button key={st}
                    onClick={() => { if (!actif) onSaveStatut(st); }}
                    title={m.desc}
                    style={{
                      flex: 1, padding: '8px 10px', borderRadius: 6, cursor: actif ? 'default' : 'pointer',
                      border: `1.5px solid ${actif ? m.color : 'var(--border)'}`,
                      background: actif ? m.color : '#fff',
                      color: actif ? '#fff' : 'var(--text)',
                      fontWeight: actif ? 700 : 500, fontSize: 12,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                      transition: 'all 0.12s',
                    }}>
                    {m.icon && <span>{m.icon}</span>}{m.label}
                  </button>
                );
              })}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
              {STATUT_META[editing.currentStatut || 'provisoire'].desc}
            </div>
          </div>
        ) : null}

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
            currentSousCategorie={currentSousCategorie}
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
  editing, promo, niveau, currentCategorie, currentSousCategorie, intervenants,
  disposIntervenants, assignationsAutres, promoById,
  onSaveIntervenant, onClose,
}) => {
  const [search, setSearch] = useState('');
  const [filterNonQualifies, setFilterNonQualifies] = useState(true);

  // ─── Calculer pour chaque intervenant son score et son statut ──────────
  // Critères :
  //   • Niveau OK ?    (qualifié pour le niveau de la promo)
  //   • Qualif module : note sur la SOUS-CATÉGORIE du module (0..5, null si pas de note)
  //   • Dispo          : déclarée dispo ce jour×période sur la campagne courante
  //   • Conflit        : déjà assigné ailleurs sur cette date×période
  const candidats = useMemo(() => {
    return intervenants.map(i => {
      const niveauOk = niveau ? (i.niveaux || []).includes(niveau.id) : true;
      // Note sur la sous-catégorie du module (pas la catégorie comme avant)
      const note = currentSousCategorie ? (i.ratings?.[currentSousCategorie.id] || null) : null;
      const qualifieModule = !!note;
      const dispoRecord = disposIntervenants.find(d =>
        d.intervenant_id === i.id && d.date === editing.dateJour && d.periode === editing.periode
      );
      const dispoStatut = dispoRecord ? 'dispo' : 'inconnu';
      const conflitsListe = assignationsAutres.filter(a =>
        a.intervenant_id === i.id && a.date_jour === editing.dateJour && a.periode === editing.periode
      ).map(a => promoById[a.promo_id]?.label).filter(Boolean);
      const hasConflit = conflitsListe.length > 0;

      let score = 0;
      if (niveauOk) score += 1000;
      if (qualifieModule) score += 100 + (note * 20);
      if (dispoStatut === 'dispo') score += 500;
      if (hasConflit) score -= 100;

      return {
        intervenant: i,
        niveauOk, note, qualifieModule,
        dispoStatut, hasConflit, conflitsListe,
        score,
      };
    }).sort((a, b) => b.score - a.score);
  }, [intervenants, niveau, currentSousCategorie, disposIntervenants, assignationsAutres, editing.dateJour, editing.periode, promoById]);

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

      {!currentSousCategorie && (
        <div style={{ padding: 10, background: '#fff8e5', borderRadius: 6, marginBottom: 12, fontSize: 12, color: '#856404' }}>
          ⓘ Aucun module assigné : les intervenants ne sont pas classés par qualification.
        </div>
      )}
      {currentSousCategorie && currentSousCategorie.label === 'Général' && (
        <div style={{ padding: 10, background: '#fff8e5', borderRadius: 6, marginBottom: 12, fontSize: 12, color: '#856404' }}>
          ⓘ Ce module est dans la sous-catégorie <strong>Général</strong> — pour un meilleur classement, déplace-le vers une sous-catégorie spécifique dans « Niveaux & catégories ».
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
                {/* Note sur la sous-catégorie */}
                {currentSousCategorie && (
                  c.note ? (
                    <span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 10, background: '#e8f4ea', color: '#1f6c33', fontWeight: 600 }}
                      title={`Note sur ${currentSousCategorie.label}`}>
                      ★ {c.note}/5
                    </span>
                  ) : (
                    <span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 10, background: '#f0f0f3', color: '#888', fontStyle: 'italic' }}
                      title={`Pas de note sur ${currentSousCategorie.label}`}>
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
                {/* Déjà affecté ailleurs sur ce créneau */}
                {c.hasConflit && (
                  <span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 10, background: '#fef3e8', color: '#9a6a14', fontWeight: 600 }}
                    title={'Déjà affecté sur ' + c.conflitsListe.join(', ') + ' au même créneau'}>
                    ⓘ déjà affecté {c.conflitsListe.length === 1 ? c.conflitsListe[0] : ''}
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
  selectedCells, planning, promo, niveau, intervenants,
  disposIntervenants, assignationsAutres, promoById, moduleById, categorieById, sousCategorieById,
  onAssign, onClose,
}) => {
  const [search, setSearch] = useState('');
  const [filterNonQualifies, setFilterNonQualifies] = useState(true);

  // Les cellules sélectionnées sont déjà fournies avec leurs détails utiles
  // (objets { id, date_jour, periode, module_id }). On les utilise directement.
  const selectedEntries = selectedCells;

  // Sous-catégories distinctes couvertes par les modules sélectionnés
  // (utilisé pour calculer la note moyenne d'un intervenant)
  const sousCategoriesIds = useMemo(() => {
    const set = new Set();
    selectedEntries.forEach(e => {
      const mod = moduleById[e.module_id];
      if (mod?.sous_categorie_id) set.add(mod.sous_categorie_id);
    });
    return [...set];
  }, [selectedEntries, moduleById]);

  // Calculer le scoring "agrégé" pour chaque intervenant
  const candidats = useMemo(() => {
    const N = selectedEntries.length;
    return intervenants.map(i => {
      const niveauOk = niveau ? (i.niveaux || []).includes(niveau.id) : true;
      // Note moyenne sur les sous-catégories couvertes
      const notes = sousCategoriesIds
        .map(scid => i.ratings?.[scid])
        .filter(n => typeof n === 'number');
      const noteMoyenne = notes.length > 0 ? (notes.reduce((s, n) => s + n, 0) / notes.length) : null;
      const qualifMoy = notes.length / (sousCategoriesIds.length || 1); // 0..1 : couverture des sous-cat
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
      let score = 0;
      if (niveauOk) score += 1000;
      if (noteMoyenne) score += 100 + (noteMoyenne * 20);
      score += qualifMoy * 50;
      score += (nbDispos / Math.max(N, 1)) * 500;
      score -= (nbConflits / Math.max(N, 1)) * 200;
      return {
        intervenant: i,
        niveauOk, noteMoyenne, nbNotes: notes.length, totalSousCategories: sousCategoriesIds.length,
        nbDispos, nbConflits, conflitsPromos: [...conflitsPromos],
        score, N,
      };
    }).sort((a, b) => b.score - a.score);
  }, [intervenants, niveau, sousCategoriesIds, disposIntervenants, assignationsAutres, selectedEntries, promoById]);

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
                      title={`Note moyenne sur ${c.nbNotes}/${c.totalSousCategories} sous-catégorie(s) concernée(s)`}>
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
                    <span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 10, background: '#fef3e8', color: '#9a6a14', fontWeight: 600 }}
                      title={`Déjà affecté sur ${c.nbConflits} des créneaux sélectionnés (${c.conflitsPromos.join(', ')})`}>
                      ⓘ déjà affecté ×{c.nbConflits}
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

// ============================================================
// MODALE — affectation en masse d'un MODULE à plusieurs créneaux
// ============================================================
const ModalAffectationModuleBulk = ({
  selectedCells, promo, categories, modules, sousCategorieById, categorieById,
  onAssign, onClose,
}) => {
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

  const N = selectedCells.length;
  const nbAvecModuleExistant = selectedCells.filter(c => c.currentModuleId).length;
  const nbCasesVides = N - nbAvecModuleExistant;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}
        style={{ maxWidth: 720, maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
        <div className="modal-head">
          <div>
            <h3 style={{ marginBottom: 4 }}>
              Affecter un module à {N} créneau{N > 1 ? 'x' : ''}
            </h3>
            <div className="text-xs text-muted">
              ⓘ Promo <strong>{promo?.label}</strong>.
              {nbAvecModuleExistant > 0 && nbCasesVides > 0 && (
                <> Le module sera <strong>remplacé</strong> sur {nbAvecModuleExistant} case{nbAvecModuleExistant > 1 ? 's' : ''} et <strong>créé</strong> sur {nbCasesVides} case{nbCasesVides > 1 ? 's' : ''} vide{nbCasesVides > 1 ? 's' : ''}.</>
              )}
              {nbAvecModuleExistant > 0 && nbCasesVides === 0 && (
                <> Le module sera <strong>remplacé</strong> sur les {nbAvecModuleExistant} case{nbAvecModuleExistant > 1 ? 's' : ''} sélectionnée{nbAvecModuleExistant > 1 ? 's' : ''}.</>
              )}
              {nbAvecModuleExistant === 0 && (
                <> Le module sera <strong>créé</strong> sur les {nbCasesVides} case{nbCasesVides > 1 ? 's' : ''} vide{nbCasesVides > 1 ? 's' : ''}.</>
              )}
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
                  // Récupérer la sous-catégorie pour info
                  const sub = m.sous_categorie_id ? sousCategorieById?.[m.sous_categorie_id] : null;
                  return (
                    <div key={m.id}
                      onClick={() => onAssign(m.id)}
                      style={{
                        padding: '8px 14px', cursor: 'pointer', background: '#fff',
                        borderBottom: '1px solid var(--bg-alt)',
                        fontSize: 13, display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-alt)'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = '#fff'; }}>
                      <span>{m.label}</span>
                      {sub && sub.label !== 'Général' && (
                        <span className="text-xs text-muted" style={{ fontStyle: 'italic' }}>{sub.label}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>

        <div className="modal-foot">
          {nbAvecModuleExistant > 0 && (
            <button className="btn btn-ghost" onClick={() => onAssign(null)} style={{ color: 'var(--danger)' }}>
              <Icon name="x" size={12} /> Retirer le module des créneaux sélectionnés
            </button>
          )}
          <button className="btn btn-ghost" onClick={onClose} style={{ marginLeft: 'auto' }}>Annuler</button>
        </div>
      </div>
    </div>
  );
};
