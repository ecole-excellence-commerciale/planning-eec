// ============================================================
// PAGE BUDGET — pilotage par PROMO et par MOIS
// Engagé = Facturé (BDC/Ypareo/manuel) + Prévisionnel (créneaux planifiés non couverts).
// Réconciliation chronologique : les heures déjà couvertes par un BDC éteignent
// les créneaux les plus anciens ; le reste alimente le prévisionnel des mois suivants.
// ============================================================
const _eur0 = (n) => (Number(n) || 0).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const _eur2 = (n) => (Number(n) || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
const _n2 = (n) => (Number(n) || 0).toFixed(2).replace('.', ',');
const _num = (v) => { const n = parseFloat(String(v).replace(',', '.')); return isNaN(n) ? 0 : n; };

const STATUT_FACT = {
  previsionnel: { label: 'Prévisionnel', color: '#94a3b8' },
  facture: { label: 'Facturé', color: '#ea580c' },
  paye: { label: 'Payé', color: '#16a34a' },
  annule: { label: 'Annulé', color: '#cbd5e1' },
};
const SOURCE_FACT = { bdc: 'BDC', ypareo: 'Ypareo', manuel: 'Manuel' };
const MOIS_FR = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const moisLabel = (k) => {
  if (!k || k === 'n/c') return 'Non daté';
  const [a, m] = k.split('-');
  return `${MOIS_FR[parseInt(m, 10) - 1] || '?'} ${a}`;
};
const SANS_PROMO = '__sans__';

// Cellule éditable : état local, enregistrement à la sortie du champ (ou Entrée)
const EditCell = ({ value, onCommit, type = 'text', width = 92, align = 'right', placeholder }) => {
  const [v, setV] = useState(value == null ? '' : value);
  useEffect(() => { setV(value == null ? '' : value); }, [value]);
  const commit = () => { if (String(v) !== String(value == null ? '' : value)) onCommit(v); };
  return (
    <input
      type={type} value={v} placeholder={placeholder}
      onChange={e => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); }}
      style={{ width, textAlign: align, fontSize: 12, padding: '3px 5px' }}
    />
  );
};

const PageBudget = ({ data }) => {
  const toast = useToast();
  const { intervenants = [], promos = [], niveaux = [] } = data;
  const HEURES_DEMI = ((window.EEC_CONFIG && window.EEC_CONFIG.HEURES_PAR_JOUR) || 7) / 2;

  const [budgets, setBudgets] = useState([]);
  const [facturations, setFacturations] = useState([]);
  const [planningEng, setPlanningEng] = useState([]);
  const [seuil, setSeuil] = useState(85);
  const [loading, setLoading] = useState(true);
  const [onglet, setOnglet] = useState('synthese');
  const [promoFocus, setPromoFocus] = useState('all');
  const [ongletFact, setOngletFact] = useState('tous');

  const tauxById = useMemo(() => Object.fromEntries(intervenants.map(i => [i.id, Number(i.taux_horaire) || 0])), [intervenants]);
  const promoById = useMemo(() => Object.fromEntries(promos.map(p => [p.id, p])), [promos]);
  const nomPromo = (id) => (id && promoById[id] ? promoById[id].label : 'Non affecté');

  const charger = async () => {
    setLoading(true);
    try {
      const [b, f, pe, s] = await Promise.all([
        db.getBudgets(), db.getFacturations(), db.getPlanningEngagement(), db.getParametre('seuil_alerte'),
      ]);
      setBudgets(b); setFacturations(f); setPlanningEng(pe);
      setSeuil(s != null ? Number(s) : 85);
    } catch (e) { console.error(e); toast(e.message || 'Erreur de chargement', 'error'); }
    finally { setLoading(false); }
  };
  useEffect(() => { charger(); }, []);

  // ============================================================
  // MOTEUR : ventilation par promo × mois
  // ============================================================
  const moteur = useMemo(() => {
    const factActives = facturations.filter(f => f.statut === 'facture' || f.statut === 'paye');

    // 1) Heures déjà couvertes par un BDC, par (promo, intervenant)
    const bdcH = {};
    facturations
      .filter(f => f.source === 'bdc' && f.statut !== 'annule' && f.intervenant_id)
      .forEach(f => {
        const k = (f.promo_id || SANS_PROMO) + '||' + f.intervenant_id;
        bdcH[k] = (bdcH[k] || 0) + (Number(f.heures) || 0);
      });

    // 2) Créneaux planifiés groupés par (promo, intervenant)
    const grp = {};
    planningEng.forEach(r => {
      if (!r.intervenant_id) return;
      const k = (r.promo_id || SANS_PROMO) + '||' + r.intervenant_id;
      (grp[k] = grp[k] || []).push(r);
    });

    // 3) Consommation chronologique : les heures BDC éteignent les créneaux les plus anciens
    const prevCell = {};   // promo||mois -> €
    const prevHCell = {};  // promo||mois -> heures
    Object.keys(grp).forEach(k => {
      const rows = grp[k].slice().sort((a, b) => {
        const d = String(a.date_jour || '').localeCompare(String(b.date_jour || ''));
        if (d !== 0) return d;
        return (a.periode === 'am' ? -1 : 1) - (b.periode === 'am' ? -1 : 1);
      });
      const sep = k.indexOf('||');
      const promoId = k.slice(0, sep);
      const taux = tauxById[k.slice(sep + 2)] || 0;
      let couvert = bdcH[k] || 0;
      rows.forEach(r => {
        let h = HEURES_DEMI;
        if (couvert > 0) { const use = Math.min(couvert, h); couvert -= use; h -= use; }
        if (h <= 0.001) return;
        const mois = String(r.date_jour || '').slice(0, 7) || 'n/c';
        const key = promoId + '||' + mois;
        prevCell[key] = (prevCell[key] || 0) + h * taux;
        prevHCell[key] = (prevHCell[key] || 0) + h;
      });
    });

    // 4) Facturé par (promo, mois) — mois d'imputation, sinon début de période
    const factCell = {};
    factActives.forEach(f => {
      const src = f.mois_imputation || f.periode_debut || '';
      const mois = String(src).slice(0, 7) || 'n/c';
      const key = (f.promo_id || SANS_PROMO) + '||' + mois;
      factCell[key] = (factCell[key] || 0) + (Number(f.montant) || 0);
    });

    // 5) Budget par promo (enveloppes actives)
    const budgetPromo = {};
    budgets.filter(b => b.actif).forEach(b => {
      const key = b.promo_id || SANS_PROMO;
      budgetPromo[key] = (budgetPromo[key] || 0) + (Number(b.montant) || 0);
    });

    // 6) Liste des mois rencontrés
    const moisSet = new Set();
    Object.keys(prevCell).forEach(k => moisSet.add(k.split('||')[1]));
    Object.keys(factCell).forEach(k => moisSet.add(k.split('||')[1]));
    const mois = Array.from(moisSet).filter(Boolean).sort();

    // 7) Liste des promos concernées
    const promoSet = new Set([...Object.keys(budgetPromo)]);
    Object.keys(prevCell).forEach(k => promoSet.add(k.split('||')[0]));
    Object.keys(factCell).forEach(k => promoSet.add(k.split('||')[0]));

    const parPromo = Array.from(promoSet).map(pid => {
      let fac = 0, prev = 0;
      mois.forEach(m => { fac += factCell[pid + '||' + m] || 0; prev += prevCell[pid + '||' + m] || 0; });
      const budget = budgetPromo[pid] || 0;
      const engage = fac + prev;
      return {
        promo_id: pid, label: pid === SANS_PROMO ? 'Non affecté' : nomPromo(pid),
        budget, facture: fac, prev, engage, reste: budget - engage,
        pct: budget > 0 ? Math.round((engage / budget) * 100) : null,
      };
    }).sort((a, b) => b.budget - a.budget || b.engage - a.engage);

    return { prevCell, prevHCell, factCell, budgetPromo, mois, parPromo };
  }, [budgets, facturations, planningEng, tauxById, promoById, HEURES_DEMI]);

  // Vue mensuelle (toutes promos ou une seule), avec cumul et reste
  const parMois = useMemo(() => {
    const cible = promoFocus;
    const budget = cible === 'all'
      ? Object.values(moteur.budgetPromo).reduce((a, b) => a + b, 0)
      : (moteur.budgetPromo[cible] || 0);
    let cumul = 0;
    const lignes = moteur.mois.map(m => {
      let fac = 0, prev = 0;
      if (cible === 'all') {
        Object.keys(moteur.factCell).forEach(k => { if (k.endsWith('||' + m)) fac += moteur.factCell[k]; });
        Object.keys(moteur.prevCell).forEach(k => { if (k.endsWith('||' + m)) prev += moteur.prevCell[k]; });
      } else {
        fac = moteur.factCell[cible + '||' + m] || 0;
        prev = moteur.prevCell[cible + '||' + m] || 0;
      }
      const total = fac + prev;
      cumul += total;
      return { mois: m, facture: fac, prev, total, cumul, reste: budget - cumul };
    }).filter(l => l.total > 0.005);
    return { budget, lignes };
  }, [moteur, promoFocus]);

  // Totaux globaux
  const budgetTotal = useMemo(() => budgets.filter(b => b.actif).reduce((s, b) => s + (Number(b.montant) || 0), 0), [budgets]);
  const facture = useMemo(() => moteur.parPromo.reduce((s, r) => s + r.facture, 0), [moteur]);
  const previsionnel = useMemo(() => moteur.parPromo.reduce((s, r) => s + r.prev, 0), [moteur]);
  const paye = useMemo(() => facturations.filter(f => f.statut === 'paye').reduce((s, f) => s + (Number(f.montant) || 0), 0), [facturations]);
  const engage = facture + previsionnel;
  const reste = budgetTotal - engage;
  const pct = budgetTotal > 0 ? Math.round((engage / budgetTotal) * 100) : 0;
  const alertes = useMemo(() => moteur.parPromo.filter(r => r.budget > 0 && r.pct != null && r.pct >= seuil), [moteur, seuil]);
  const barColor = pct > 100 ? 'var(--danger)' : (pct >= seuil ? '#ea580c' : 'var(--navy)');

  // ============================================================
  // ACTIONS
  // ============================================================
  const majBudget = async (b, patch) => {
    setBudgets(bs => bs.map(x => x.id === b.id ? { ...x, ...patch } : x));
    try { await db.updateBudget(b.id, patch); } catch (e) { console.error(e); toast('Erreur', 'error'); charger(); }
  };
  const majBudgetCalc = (b, champ, val) => {
    const patch = { [champ]: _num(val) };
    const tarif = champ === 'tarif' ? _num(val) : Number(b.tarif) || 0;
    const vol = champ === 'volume_h' ? _num(val) : Number(b.volume_h) || 0;
    if (champ === 'tarif' || champ === 'volume_h') patch.montant = +(tarif * vol).toFixed(2);
    majBudget(b, patch);
  };
  const ajoutBudget = async () => {
    try {
      const b = await db.addBudget({ annee: new Date().getFullYear(), libelle: 'Nouvelle enveloppe', niveau: '', tarif: 0, volume_h: 0, montant: 0, actif: true });
      setBudgets(bs => [...bs, b]); toast('Enveloppe ajoutée', 'success');
    } catch (e) { console.error(e); toast(e.message || 'Erreur', 'error'); }
  };
  const supprBudget = async (b) => {
    if (!confirm(`Supprimer l’enveloppe « ${b.libelle} » ?`)) return;
    try { await db.deleteBudget(b.id); setBudgets(bs => bs.filter(x => x.id !== b.id)); toast('Supprimée', 'success'); }
    catch (e) { console.error(e); toast(e.message || 'Erreur', 'error'); }
  };

  const majFact = async (f, patch) => {
    setFacturations(fs => fs.map(x => x.id === f.id ? { ...x, ...patch } : x));
    try { await db.updateFacturation(f.id, patch); } catch (e) { console.error(e); toast('Erreur', 'error'); charger(); }
  };
  const majFactCalc = (f, champ, val) => {
    const patch = { [champ]: _num(val) };
    const h = champ === 'heures' ? _num(val) : Number(f.heures) || 0;
    const t = champ === 'taux' ? _num(val) : Number(f.taux) || 0;
    if ((champ === 'heures' || champ === 'taux') && h > 0 && t > 0) patch.montant = +(h * t).toFixed(2);
    majFact(f, patch);
  };
  const ajoutFact = async () => {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const f = await db.addFacturation({ libelle: 'Nouvelle ligne', source: 'manuel', statut: 'facture', periode_debut: today, montant: 0, avant_coupure: false });
      setFacturations(fs => [f, ...fs]); setOngletFact('manuel'); toast('Ligne ajoutée', 'success');
    } catch (e) { console.error(e); toast(e.message || 'Erreur', 'error'); }
  };
  const supprFact = async (f) => {
    if (!confirm(`Supprimer la ligne « ${f.libelle} » ?`)) return;
    try { await db.deleteFacturation(f.id); setFacturations(fs => fs.filter(x => x.id !== f.id)); toast('Supprimée', 'success'); }
    catch (e) { console.error(e); toast(e.message || 'Erreur', 'error'); }
  };
  const majSeuil = async (v) => {
    setSeuil(v);
    try { await db.setParametre('seuil_alerte', String(v)); } catch (e) { console.error(e); toast('Erreur', 'error'); }
  };

  const exportCSV = () => {
    const sep = ';', esc = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const L = [];
    L.push(esc('SUIVI BUDGET — export du ' + new Date().toLocaleDateString('fr-FR')));
    L.push('');
    [['Budget disponible', budgetTotal], ['Engagé', engage], ['Facturé', facture], ['Prévisionnel', previsionnel], ['Payé', paye], ['Reste', reste]]
      .forEach(([k, v]) => L.push([esc(k), _n2(v)].join(sep)));
    L.push(''); L.push(esc('PAR PROMO'));
    L.push(['Promo', 'Budget', 'Facturé', 'Prévisionnel', 'Engagé', 'Reste', '%'].map(esc).join(sep));
    moteur.parPromo.forEach(r => L.push([esc(r.label), _n2(r.budget), _n2(r.facture), _n2(r.prev), _n2(r.engage), _n2(r.reste), r.pct != null ? r.pct : ''].join(sep)));
    L.push(''); L.push(esc('PAR MOIS — ' + (promoFocus === 'all' ? 'toutes promos' : nomPromo(promoFocus))));
    L.push(['Mois', 'Facturé', 'Prévisionnel', 'Total mois', 'Cumulé', 'Reste'].map(esc).join(sep));
    parMois.lignes.forEach(l => L.push([esc(moisLabel(l.mois)), _n2(l.facture), _n2(l.prev), _n2(l.total), _n2(l.cumul), _n2(l.reste)].join(sep)));
    L.push(''); L.push(esc('LIGNES DE FACTURATION'));
    L.push(['Libellé', 'Promo', 'Source', 'Statut', 'Début', 'Fin', 'Mois imputation', 'Heures', 'Taux', 'Montant'].map(esc).join(sep));
    facturations.forEach(f => L.push([esc(f.libelle), esc(f.promo_id ? nomPromo(f.promo_id) : ''), esc(SOURCE_FACT[f.source] || f.source),
      esc((STATUT_FACT[f.statut] || {}).label || f.statut), esc(f.periode_debut || ''), esc(f.periode_fin || ''),
      esc(f.mois_imputation || ''), f.heures != null ? _n2(f.heures) : '', f.taux != null ? _n2(f.taux) : '', _n2(f.montant)].join(sep)));
    const blob = new Blob(['\uFEFF' + L.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a');
    a.href = url; a.download = 'suivi_budget.csv'; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  };

  const factFiltrees = ongletFact === 'tous' ? facturations : facturations.filter(f => f.source === ongletFact);

  if (loading) return <div className="page-content"><div className="page-header"><h1 className="page-title display-dot">Budget</h1></div><div className="text-muted">Chargement…</div></div>;

  const Onglet = ({ id, label }) => (
    <div onClick={() => setOnglet(id)}
      style={{ padding: '6px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600,
        background: onglet === id ? 'var(--navy)' : 'transparent', color: onglet === id ? '#fff' : 'var(--text)' }}>
      {label}
    </div>
  );

  return (
    <div className="page-content">
      <div className="page-header">
        <div>
          <div className="breadcrumb">PILOTAGE</div>
          <h1 className="page-title display-dot">Budget &amp; facturation</h1>
          <div className="page-subtitle">Suivi des dépenses d’intervention par promo et par mois.</div>
        </div>
        <div className="flex gap-8" style={{ alignItems: 'flex-end' }}>
          <div className="field" style={{ marginBottom: 0 }}>
            <div className="label" style={{ fontSize: 10 }}>Seuil alerte (%)</div>
            <input type="number" value={seuil} style={{ width: 70 }} onChange={e => majSeuil(parseInt(e.target.value) || 0)} />
          </div>
          <button className="btn btn-secondary btn-sm" onClick={exportCSV}><Icon name="download" size={12} /> Export CSV</button>
        </div>
      </div>

      <div className="flex gap-8" style={{ background: 'var(--bg-alt)', borderRadius: 8, padding: 4, marginBottom: 4, flexWrap: 'wrap' }}>
        <Onglet id="synthese" label="Synthèse" />
        <Onglet id="promo" label="Par promo" />
        <Onglet id="mois" label="Par mois" />
        <Onglet id="enveloppes" label="Enveloppes" />
        <Onglet id="facturation" label="Facturation" />
      </div>

      {/* ---------------- SYNTHÈSE ---------------- */}
      {onglet === 'synthese' && (
        <React.Fragment>
          {alertes.length > 0 && (
            <div className="card" style={{ borderLeft: '4px solid var(--danger)', background: '#fff6f6' }}>
              <div style={{ fontWeight: 600, color: 'var(--danger)', marginBottom: 6 }}>⚠ Alertes budget ({alertes.length})</div>
              {alertes.map(a => (
                <div key={a.promo_id} className="text-sm" style={{ marginBottom: 2 }}>
                  {a.reste < 0 ? '🔴' : '🟠'} <strong>{a.label}</strong> — engagé {_eur0(a.engage)} / budget {_eur0(a.budget)} ({a.pct}%)
                  {a.reste < 0 ? ' · dépassement !' : ` · seuil ${seuil}% atteint`}
                </div>
              ))}
            </div>
          )}

          <div className="kpi-grid">
            <div className="kpi"><div className="kpi-label">Budget disponible</div><div className="kpi-value">{_eur0(budgetTotal)}</div><div className="kpi-sub">{budgets.filter(b => b.actif).length} enveloppe(s) active(s)</div></div>
            <div className="kpi"><div className="kpi-label">Engagé</div><div className="kpi-value" style={{ color: barColor }}>{_eur0(engage)}</div><div className="kpi-sub">{pct}% du budget</div></div>
            <div className="kpi"><div className="kpi-label">Reste disponible</div><div className="kpi-value" style={{ color: reste < 0 ? 'var(--danger)' : '#16a34a' }}>{_eur0(reste)}</div><div className="kpi-sub">{reste < 0 ? 'Dépassement !' : 'sous plafond'}</div></div>
            <div className="kpi"><div className="kpi-label">Facturé / Payé</div><div className="kpi-value">{_eur0(facture)}</div><div className="kpi-sub">dont payé {_eur0(paye)}</div></div>
          </div>

          <div className="card" style={{ marginTop: 4 }}>
            <div className="flex-between" style={{ marginBottom: 6, fontSize: 12 }}><span>Consommation du budget</span><span style={{ fontWeight: 600, color: barColor }}>{pct}%</span></div>
            <div style={{ height: 12, background: 'var(--bg-alt)', borderRadius: 6, overflow: 'hidden', display: 'flex' }}>
              <div style={{ width: Math.min(100, budgetTotal ? (facture / budgetTotal) * 100 : 0) + '%', height: '100%', background: '#ea580c' }} />
              <div style={{ width: Math.min(100, budgetTotal ? (previsionnel / budgetTotal) * 100 : 0) + '%', height: '100%', background: '#93c5fd' }} />
            </div>
            <div className="flex gap-16 mt-8" style={{ fontSize: 11, color: 'var(--text-muted)', flexWrap: 'wrap' }}>
              <span>🟠 Facturé : {_eur2(facture)}</span><span>🔵 Prévisionnel : {_eur2(previsionnel)}</span><span>🟢 Payé : {_eur2(paye)}</span>
            </div>
          </div>
        </React.Fragment>
      )}

      {/* ---------------- PAR PROMO ---------------- */}
      {onglet === 'promo' && (
        <div className="card">
          <div className="card-title">Par promo</div>
          <div className="help" style={{ marginBottom: 10 }}>Clique sur une promo pour voir son détail mensuel. Les enveloppes non reliées à une promo apparaissent en « Non affecté ».</div>
          <table className="table" style={{ fontSize: 13 }}>
            <thead><tr>
              <th style={{ textAlign: 'left' }}>Promo</th><th>Budget</th><th>Facturé</th><th>Prévu</th><th>Engagé</th><th>Reste</th><th>%</th>
            </tr></thead>
            <tbody>
              {moteur.parPromo.map(r => (
                <tr key={r.promo_id} style={{ background: (r.pct != null && r.pct >= seuil) ? '#fff6f6' : 'transparent', cursor: 'pointer' }}
                  onClick={() => { setPromoFocus(r.promo_id); setOnglet('mois'); }}>
                  <td style={{ textAlign: 'left', fontWeight: 600 }}>{r.label}</td>
                  <td>{r.budget ? _eur0(r.budget) : '—'}</td>
                  <td>{_eur0(r.facture)}</td>
                  <td style={{ color: '#2563eb' }}>{_eur0(r.prev)}</td>
                  <td style={{ fontWeight: 600 }}>{_eur0(r.engage)}</td>
                  <td style={{ color: r.budget && r.reste < 0 ? 'var(--danger)' : 'inherit' }}>{r.budget ? _eur0(r.reste) : '—'}</td>
                  <td style={{ fontWeight: 600, color: r.pct != null && r.pct > 100 ? 'var(--danger)' : 'inherit' }}>{r.pct != null ? r.pct + '%' : '—'}</td>
                </tr>
              ))}
              <tr style={{ borderTop: '2px solid var(--border)', fontWeight: 700 }}>
                <td style={{ textAlign: 'left' }}>Total</td>
                <td>{_eur0(budgetTotal)}</td><td>{_eur0(facture)}</td><td>{_eur0(previsionnel)}</td>
                <td>{_eur0(engage)}</td><td style={{ color: reste < 0 ? 'var(--danger)' : 'inherit' }}>{_eur0(reste)}</td><td>{pct}%</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* ---------------- PAR MOIS ---------------- */}
      {onglet === 'mois' && (
        <div className="card">
          <div className="flex-between" style={{ alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
            <div className="card-title" style={{ marginBottom: 0 }}>Vision mensuelle</div>
            <div className="field" style={{ marginBottom: 0, minWidth: 240 }}>
              <select value={promoFocus} onChange={e => setPromoFocus(e.target.value)}>
                <option value="all">Toutes les promos</option>
                {moteur.parPromo.map(r => <option key={r.promo_id} value={r.promo_id}>{r.label}</option>)}
              </select>
            </div>
          </div>
          <div className="help" style={{ marginBottom: 10 }}>
            Budget de référence : <strong>{_eur0(parMois.budget)}</strong>. « Reste » = budget moins le cumul engagé à la fin du mois.
          </div>
          {parMois.lignes.length === 0 ? <div className="text-muted text-sm">Aucun engagement daté pour cette sélection.</div> : (
            <table className="table" style={{ fontSize: 13 }}>
              <thead><tr>
                <th style={{ textAlign: 'left' }}>Mois</th><th>Facturé</th><th>Prévu</th><th>Total mois</th><th>Cumulé</th><th>Reste</th>
              </tr></thead>
              <tbody>
                {parMois.lignes.map(l => (
                  <tr key={l.mois} style={{ background: l.reste < 0 ? '#fff6f6' : 'transparent' }}>
                    <td style={{ textAlign: 'left', fontWeight: 600 }}>{moisLabel(l.mois)}</td>
                    <td style={{ color: '#ea580c' }}>{l.facture ? _eur0(l.facture) : '—'}</td>
                    <td style={{ color: '#2563eb' }}>{l.prev ? _eur0(l.prev) : '—'}</td>
                    <td style={{ fontWeight: 600 }}>{_eur0(l.total)}</td>
                    <td className="text-muted">{_eur0(l.cumul)}</td>
                    <td style={{ fontWeight: 600, color: l.reste < 0 ? 'var(--danger)' : '#16a34a' }}>{parMois.budget ? _eur0(l.reste) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ---------------- ENVELOPPES ---------------- */}
      {onglet === 'enveloppes' && (
        <div className="card">
          <div className="flex-between" style={{ alignItems: 'center', marginBottom: 8 }}>
            <div className="card-title" style={{ marginBottom: 0 }}>Enveloppes budgétaires</div>
            <button className="btn btn-secondary btn-sm" onClick={ajoutBudget}><Icon name="plus" size={12} /> Ajouter</button>
          </div>
          <div className="help" style={{ marginBottom: 10 }}>
            Tous les champs sont modifiables (validation en quittant la case). Modifier le tarif ou le volume recalcule le montant ;
            saisir directement un montant le force. Relie chaque enveloppe à sa promo pour alimenter les vues par promo et par mois.
          </div>
          <table className="table" style={{ fontSize: 12 }}>
            <thead><tr>
              <th style={{ width: 40 }}>Actif</th><th style={{ textAlign: 'left' }}>Libellé</th><th style={{ textAlign: 'left' }}>Niveau</th>
              <th>Élèves</th><th>Tarif €/h</th><th>Volume h</th><th>Montant</th><th style={{ textAlign: 'left' }}>Promo</th><th></th>
            </tr></thead>
            <tbody>
              {budgets.map(b => (
                <tr key={b.id} style={{ opacity: b.actif ? 1 : 0.45 }}>
                  <td style={{ textAlign: 'center' }}><input type="checkbox" checked={!!b.actif} onChange={e => majBudget(b, { actif: e.target.checked })} /></td>
                  <td style={{ textAlign: 'left' }}><EditCell value={b.libelle} align="left" width={210} onCommit={v => majBudget(b, { libelle: v })} /></td>
                  <td style={{ textAlign: 'left' }}><EditCell value={b.niveau} align="left" width={90} onCommit={v => majBudget(b, { niveau: v })} /></td>
                  <td><EditCell value={b.nb_eleves} type="number" width={58} onCommit={v => majBudget(b, { nb_eleves: parseInt(v) || null })} /></td>
                  <td><EditCell value={b.tarif} type="number" width={64} onCommit={v => majBudgetCalc(b, 'tarif', v)} /></td>
                  <td><EditCell value={b.volume_h} type="number" width={68} onCommit={v => majBudgetCalc(b, 'volume_h', v)} /></td>
                  <td><EditCell value={b.montant} type="number" width={88} onCommit={v => majBudget(b, { montant: _num(v) })} /></td>
                  <td style={{ textAlign: 'left' }}>
                    <select value={b.promo_id || ''} style={{ fontSize: 11, padding: '2px 4px', maxWidth: 180 }} onChange={e => majBudget(b, { promo_id: e.target.value || null })}>
                      <option value="">— non reliée —</option>
                      {promos.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                    </select>
                  </td>
                  <td><div className="modal-close" onClick={() => supprBudget(b)} title="Supprimer"><Icon name="x" size={14} /></div></td>
                </tr>
              ))}
              <tr style={{ borderTop: '2px solid var(--border)', fontWeight: 700 }}>
                <td></td><td style={{ textAlign: 'left' }}>Total actif</td><td></td><td></td><td></td><td></td>
                <td style={{ color: 'var(--navy)', textAlign: 'right' }}>{_eur0(budgetTotal)}</td><td></td><td></td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* ---------------- FACTURATION ---------------- */}
      {onglet === 'facturation' && (
        <div className="card">
          <div className="flex-between" style={{ alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
            <div className="card-title" style={{ marginBottom: 0 }}>Lignes de facturation</div>
            <div className="flex gap-8" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
              <div className="flex gap-8" style={{ background: 'var(--bg-alt)', borderRadius: 6, padding: 3 }}>
                {['tous', 'bdc', 'ypareo', 'manuel'].map(s => (
                  <div key={s} onClick={() => setOngletFact(s)} style={{ padding: '4px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 12, fontWeight: 600, background: ongletFact === s ? 'var(--navy)' : 'transparent', color: ongletFact === s ? '#fff' : 'var(--text)' }}>
                    {s === 'tous' ? 'Tous' : SOURCE_FACT[s]}
                  </div>
                ))}
              </div>
              <button className="btn btn-secondary btn-sm" onClick={ajoutFact}><Icon name="plus" size={12} /> Ligne manuelle</button>
            </div>
          </div>
          <div className="help" style={{ marginBottom: 10 }}>
            Champs modifiables. Heures × taux recalcule le montant ; un montant saisi directement est conservé.
            « Mois imput. » force le mois de rattachement dans la vision mensuelle (sinon c’est le mois de début).
          </div>
          {factFiltrees.length === 0 ? <div className="text-muted text-sm" style={{ padding: '10px 0' }}>Aucune ligne.</div> : (
            <div style={{ overflowX: 'auto' }}>
              <table className="table" style={{ fontSize: 11, minWidth: 1100 }}>
                <thead><tr>
                  <th style={{ textAlign: 'left' }}>Libellé</th><th style={{ textAlign: 'left' }}>Intervenant</th><th style={{ textAlign: 'left' }}>Promo</th>
                  <th>Source</th><th>Début</th><th>Fin</th><th>Mois imput.</th><th>Heures</th><th>Taux</th><th>Montant</th><th>Statut</th><th></th>
                </tr></thead>
                <tbody>
                  {factFiltrees.map(f => (
                    <tr key={f.id} style={{ opacity: f.statut === 'annule' ? 0.4 : 1 }}>
                      <td style={{ textAlign: 'left' }}>
                        <EditCell value={f.libelle} align="left" width={200} onCommit={v => majFact(f, { libelle: v })} />
                        {f.avant_coupure && <span className="badge" style={{ marginLeft: 4, fontSize: 9 }}>historique</span>}
                      </td>
                      <td style={{ textAlign: 'left' }}>
                        <select value={f.intervenant_id || ''} style={{ fontSize: 11, padding: '2px 4px', maxWidth: 140 }} onChange={e => majFact(f, { intervenant_id: e.target.value || null })}>
                          <option value="">— non relié —</option>
                          {intervenants.map(i => <option key={i.id} value={i.id}>{i.prenom} {i.nom}</option>)}
                        </select>
                      </td>
                      <td style={{ textAlign: 'left' }}>
                        <select value={f.promo_id || ''} style={{ fontSize: 11, padding: '2px 4px', maxWidth: 150 }} onChange={e => majFact(f, { promo_id: e.target.value || null })}>
                          <option value="">— aucune —</option>
                          {promos.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                        </select>
                      </td>
                      <td>
                        <select value={f.source || 'manuel'} style={{ fontSize: 11, padding: '2px 4px' }} onChange={e => majFact(f, { source: e.target.value })}>
                          {Object.entries(SOURCE_FACT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                        </select>
                      </td>
                      <td><EditCell value={f.periode_debut} type="date" width={122} align="left" onCommit={v => majFact(f, { periode_debut: v || null })} /></td>
                      <td><EditCell value={f.periode_fin} type="date" width={122} align="left" onCommit={v => majFact(f, { periode_fin: v || null })} /></td>
                      <td><EditCell value={f.mois_imputation} type="date" width={122} align="left" onCommit={v => majFact(f, { mois_imputation: v || null })} /></td>
                      <td><EditCell value={f.heures} type="number" width={58} onCommit={v => majFactCalc(f, 'heures', v)} /></td>
                      <td><EditCell value={f.taux} type="number" width={58} onCommit={v => majFactCalc(f, 'taux', v)} /></td>
                      <td><EditCell value={f.montant} type="number" width={82} onCommit={v => majFact(f, { montant: _num(v) })} /></td>
                      <td>
                        <select value={f.statut} onChange={e => majFact(f, { statut: e.target.value })}
                          style={{ fontSize: 11, padding: '2px 4px', color: (STATUT_FACT[f.statut] || {}).color, fontWeight: 600 }}>
                          {Object.entries(STATUT_FACT).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                        </select>
                      </td>
                      <td><div className="modal-close" onClick={() => supprFact(f)} title="Supprimer"><Icon name="x" size={14} /></div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
