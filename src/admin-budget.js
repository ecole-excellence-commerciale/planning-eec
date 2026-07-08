// ============================================================
// PAGE BUDGET — Suivi facturation (Phase 3 : alertes, export, par niveau, liens)
// ============================================================
const _eur0 = (n) => (Number(n) || 0).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const _eur2 = (n) => (Number(n) || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
const _n2 = (n) => (Number(n) || 0).toFixed(2).replace('.', ',');
const STATUT_FACT = {
  previsionnel: { label: 'Prévisionnel', color: '#94a3b8' },
  facture: { label: 'Facturé', color: '#ea580c' },
  paye: { label: 'Payé', color: '#16a34a' },
  annule: { label: 'Annulé', color: '#cbd5e1' },
};
const SOURCE_FACT = { bdc: 'BDC', ypareo: 'Ypareo', manuel: 'Manuel' };

const PageBudget = ({ data }) => {
  const toast = useToast();
  const { intervenants = [], promos = [], niveaux = [] } = data;
  const HEURES_DEMI = ((window.EEC_CONFIG && window.EEC_CONFIG.HEURES_PAR_JOUR) || 7) / 2;

  const [budgets, setBudgets] = useState([]);
  const [facturations, setFacturations] = useState([]);
  const [planningEng, setPlanningEng] = useState([]);
  const [coupure, setCoupure] = useState('');
  const [seuil, setSeuil] = useState(85);
  const [loading, setLoading] = useState(true);
  const [ongletFact, setOngletFact] = useState('tous');

  const tauxById = useMemo(() => Object.fromEntries(intervenants.map(i => [i.id, Number(i.taux_horaire) || 0])), [intervenants]);
  const promoById = useMemo(() => Object.fromEntries(promos.map(p => [p.id, p])), [promos]);
  const niveauById = useMemo(() => Object.fromEntries(niveaux.map(n => [n.id, n])), [niveaux]);
  const niveauDePromo = (promo_id) => (promo_id && niveauById[promoById[promo_id]?.niveau_id]?.label) || null;

  const charger = async () => {
    setLoading(true);
    try {
      const [b, f, pe, c, s] = await Promise.all([
        db.getBudgets(), db.getFacturations(), db.getPlanningEngagement(),
        db.getParametre('date_coupure'), db.getParametre('seuil_alerte'),
      ]);
      setBudgets(b); setFacturations(f); setPlanningEng(pe);
      setCoupure(c || ''); setSeuil(s != null ? Number(s) : 85);
    } catch (e) { console.error(e); toast(e.message || 'Erreur de chargement', 'error'); }
    finally { setLoading(false); }
  };
  useEffect(() => { charger(); }, []);

  // ---- Totaux globaux ----
  const budgetTotal = useMemo(() => budgets.filter(b => b.actif).reduce((s, b) => s + (Number(b.montant) || 0), 0), [budgets]);
  const factLignes = useMemo(() => facturations.filter(f => f.statut !== 'annule'), [facturations]);
  const facture = useMemo(() => factLignes.filter(f => f.statut === 'facture' || f.statut === 'paye').reduce((s, f) => s + (Number(f.montant) || 0), 0), [factLignes]);
  const paye = useMemo(() => factLignes.filter(f => f.statut === 'paye').reduce((s, f) => s + (Number(f.montant) || 0), 0), [factLignes]);

  // ---- Prévisionnel réconcilié par (niveau, intervenant) ----
  const prevByNiv = useMemo(() => {
    const planKey = {}, bdcKey = {};
    planningEng.forEach(r => {
      const nv = niveauDePromo(r.promo_id) || '—';
      const k = nv + '||' + r.intervenant_id;
      planKey[k] = (planKey[k] || 0) + HEURES_DEMI;
    });
    facturations.filter(f => f.source === 'bdc' && f.statut !== 'annule' && f.intervenant_id).forEach(f => {
      const nv = niveauDePromo(f.promo_id) || '—';
      const k = nv + '||' + f.intervenant_id;
      bdcKey[k] = (bdcKey[k] || 0) + (Number(f.heures) || 0);
    });
    const out = {};
    Object.keys(planKey).forEach(k => {
      const [nv, interv] = k.split('||');
      const reste = Math.max(0, planKey[k] - (bdcKey[k] || 0));
      out[nv] = (out[nv] || 0) + reste * (tauxById[interv] || 0);
    });
    return out;
  }, [planningEng, facturations, tauxById, promoById, niveauById]);
  const previsionnel = useMemo(() => Object.values(prevByNiv).reduce((a, b) => a + b, 0), [prevByNiv]);

  const engage = facture + previsionnel;
  const reste = budgetTotal - engage;
  const pct = budgetTotal > 0 ? Math.round((engage / budgetTotal) * 100) : 0;

  // ---- Détail par niveau ----
  const parNiveau = useMemo(() => {
    const m = {};
    const get = (k) => (m[k] = m[k] || { niveau: k, budget: 0, facture: 0, prev: prevByNiv[k] || 0 });
    budgets.filter(b => b.actif).forEach(b => { get(b.niveau || '—').budget += Number(b.montant) || 0; });
    factLignes.filter(f => f.statut === 'facture' || f.statut === 'paye').forEach(f => {
      get(niveauDePromo(f.promo_id) || 'Historique / non rattaché').facture += Number(f.montant) || 0;
    });
    Object.keys(prevByNiv).forEach(k => get(k));
    return Object.values(m).map(r => {
      const eng = r.facture + r.prev;
      return { ...r, engage: eng, reste: r.budget - eng, pct: r.budget > 0 ? Math.round((eng / r.budget) * 100) : null };
    }).sort((a, b) => b.budget - a.budget);
  }, [budgets, factLignes, prevByNiv, promoById, niveauById]);

  const alertes = useMemo(() => parNiveau.filter(r => r.budget > 0 && r.pct != null && r.pct >= seuil)
    .map(r => ({ ...r, depassement: r.engage > r.budget })), [parNiveau, seuil]);

  // ---- Actions ----
  const majBudget = async (b, patch) => {
    setBudgets(bs => bs.map(x => x.id === b.id ? { ...x, ...patch } : x));
    try { await db.updateBudget(b.id, patch); } catch (e) { console.error(e); toast('Erreur', 'error'); charger(); }
  };
  const majVolume = (b, v) => { const vol = parseFloat(v) || 0; majBudget(b, { volume_h: vol, montant: +(vol * (Number(b.tarif) || 0)).toFixed(2) }); };
  const majFact = async (f, patch) => {
    setFacturations(fs => fs.map(x => x.id === f.id ? { ...x, ...patch } : x));
    try { await db.updateFacturation(f.id, patch); } catch (e) { console.error(e); toast('Erreur', 'error'); charger(); }
  };
  const majParam = async (cle, v, setter) => {
    setter(v);
    try { await db.setParametre(cle, String(v)); toast('Enregistré', 'success'); } catch (e) { console.error(e); toast('Erreur', 'error'); }
  };

  const exportCSV = () => {
    const sep = ';', esc = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const L = [];
    L.push(esc('SUIVI BUDGET — export du ' + new Date().toLocaleDateString('fr-FR')));
    L.push('');
    [['Budget disponible', budgetTotal], ['Engagé', engage], ['Facturé', facture], ['Prévisionnel', previsionnel], ['Payé', paye], ['Reste', reste]]
      .forEach(([k, v]) => L.push([esc(k), _n2(v)].join(sep)));
    L.push(''); L.push(esc('PAR NIVEAU'));
    L.push(['Niveau', 'Budget', 'Facturé', 'Prévisionnel', 'Engagé', 'Reste', '%'].map(esc).join(sep));
    parNiveau.forEach(r => L.push([esc(r.niveau), _n2(r.budget), _n2(r.facture), _n2(r.prev), _n2(r.engage), r.budget ? _n2(r.reste) : '', r.pct != null ? r.pct : ''].join(sep)));
    L.push(''); L.push(esc('LIGNES DE FACTURATION'));
    L.push(['Libellé', 'Source', 'Statut', 'Début', 'Fin', 'Heures', 'Taux', 'Montant', 'Avant coupure'].map(esc).join(sep));
    facturations.forEach(f => L.push([esc(f.libelle), esc(SOURCE_FACT[f.source] || f.source), esc((STATUT_FACT[f.statut] || {}).label || f.statut),
      esc(f.periode_debut || ''), esc(f.periode_fin || ''), f.heures != null ? _n2(f.heures) : '', f.taux != null ? _n2(f.taux) : '', _n2(f.montant), esc(f.avant_coupure ? 'oui' : 'non')].join(sep)));
    const blob = new Blob(['\uFEFF' + L.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a');
    a.href = url; a.download = 'suivi_budget.csv'; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  };

  const factFiltrees = ongletFact === 'tous' ? facturations : facturations.filter(f => f.source === ongletFact);
  const barColor = pct > 100 ? 'var(--danger)' : (pct >= seuil ? '#ea580c' : 'var(--navy)');

  if (loading) return <div className="page-content"><div className="page-header"><h1 className="page-title display-dot">Budget</h1></div><div className="text-muted">Chargement…</div></div>;

  return (
    <div className="page-content">
      <div className="page-header">
        <div>
          <div className="breadcrumb">PILOTAGE</div>
          <h1 className="page-title display-dot">Budget &amp; facturation</h1>
          <div className="page-subtitle">Suivi des dépenses d’intervention — prévisionnel, facturé, payé.</div>
        </div>
        <div className="flex gap-8" style={{ alignItems: 'flex-end' }}>
          <div className="field" style={{ marginBottom: 0 }}>
            <div className="label" style={{ fontSize: 10 }}>Date de coupure</div>
            <input type="date" value={coupure} onChange={e => majParam('date_coupure', e.target.value, setCoupure)} />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <div className="label" style={{ fontSize: 10 }}>Seuil alerte (%)</div>
            <input type="number" value={seuil} style={{ width: 70 }} onChange={e => majParam('seuil_alerte', parseInt(e.target.value) || 0, setSeuil)} />
          </div>
          <button className="btn btn-secondary btn-sm" onClick={exportCSV}><Icon name="download" size={12} /> Export CSV</button>
        </div>
      </div>

      {/* Alertes */}
      {alertes.length > 0 && (
        <div className="card" style={{ borderLeft: '4px solid var(--danger)', background: '#fff6f6' }}>
          <div style={{ fontWeight: 600, color: 'var(--danger)', marginBottom: 6 }}>⚠ Alertes budget ({alertes.length})</div>
          {alertes.map(a => (
            <div key={a.niveau} className="text-sm" style={{ marginBottom: 2 }}>
              {a.depassement ? '🔴' : '🟠'} <strong>{a.niveau}</strong> — engagé {_eur0(a.engage)} / budget {_eur0(a.budget)} ({a.pct}%){a.depassement ? ' · dépassement !' : ` · seuil ${seuil}% atteint`}
            </div>
          ))}
        </div>
      )}

      {/* KPI */}
      <div className="kpi-grid">
        <div className="kpi"><div className="kpi-label">Budget disponible</div><div className="kpi-value">{_eur0(budgetTotal)}</div><div className="kpi-sub">{budgets.filter(b => b.actif).length} ligne(s) active(s)</div></div>
        <div className="kpi"><div className="kpi-label">Engagé</div><div className="kpi-value" style={{ color: barColor }}>{_eur0(engage)}</div><div className="kpi-sub">{pct}% du budget</div></div>
        <div className="kpi"><div className="kpi-label">Reste disponible</div><div className="kpi-value" style={{ color: reste < 0 ? 'var(--danger)' : '#16a34a' }}>{_eur0(reste)}</div><div className="kpi-sub">{reste < 0 ? 'Dépassement !' : 'sous plafond'}</div></div>
        <div className="kpi"><div className="kpi-label">Facturé / Payé</div><div className="kpi-value">{_eur0(facture)}</div><div className="kpi-sub">dont payé {_eur0(paye)}</div></div>
      </div>

      {/* Barre */}
      <div className="card" style={{ marginTop: 4 }}>
        <div className="flex-between" style={{ marginBottom: 6, fontSize: 12 }}><span>Consommation du budget</span><span style={{ fontWeight: 600, color: barColor }}>{pct}%</span></div>
        <div style={{ height: 12, background: 'var(--bg-alt)', borderRadius: 6, overflow: 'hidden' }}><div style={{ width: Math.min(100, pct) + '%', height: '100%', background: barColor, transition: 'width .3s' }} /></div>
        <div className="flex gap-16 mt-8" style={{ fontSize: 11, color: 'var(--text-muted)', flexWrap: 'wrap' }}>
          <span>🟠 Facturé : {_eur2(facture)}</span><span>🔵 Prévisionnel : {_eur2(previsionnel)}</span><span>🟢 Payé : {_eur2(paye)}</span>
        </div>
      </div>

      {/* Par niveau */}
      <div className="card">
        <div className="card-title">Par niveau</div>
        <table className="table" style={{ fontSize: 13 }}>
          <thead><tr><th style={{ textAlign: 'left' }}>Niveau</th><th>Budget</th><th>Facturé</th><th>Prévis.</th><th>Engagé</th><th>Reste</th><th>%</th></tr></thead>
          <tbody>
            {parNiveau.map(r => (
              <tr key={r.niveau} style={{ background: (r.pct != null && r.pct >= seuil) ? '#fff6f6' : 'transparent' }}>
                <td style={{ textAlign: 'left' }}>{r.niveau}</td>
                <td>{r.budget ? _eur0(r.budget) : '—'}</td>
                <td>{_eur0(r.facture)}</td>
                <td>{_eur0(r.prev)}</td>
                <td style={{ fontWeight: 600 }}>{_eur0(r.engage)}</td>
                <td style={{ color: r.budget && r.reste < 0 ? 'var(--danger)' : 'inherit' }}>{r.budget ? _eur0(r.reste) : '—'}</td>
                <td style={{ color: r.pct != null && r.pct > 100 ? 'var(--danger)' : 'inherit', fontWeight: 600 }}>{r.pct != null ? r.pct + '%' : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Enveloppes budgétaires */}
      <div className="card">
        <div className="card-title">Enveloppes budgétaires</div>
        <div className="help" style={{ marginBottom: 10 }}>Décoche une enveloppe non intégrée, ajuste son volume, ou relie-la à une promo pour le suivi détaillé.</div>
        <table className="table" style={{ fontSize: 13 }}>
          <thead><tr><th style={{ width: 40 }}>Actif</th><th style={{ textAlign: 'left' }}>Enveloppe</th><th>Niveau</th><th>Tarif</th><th>Volume (h)</th><th>Montant</th><th style={{ textAlign: 'left' }}>Promo liée</th></tr></thead>
          <tbody>
            {budgets.map(b => (
              <tr key={b.id} style={{ opacity: b.actif ? 1 : 0.45 }}>
                <td style={{ textAlign: 'center' }}><input type="checkbox" checked={!!b.actif} onChange={e => majBudget(b, { actif: e.target.checked })} /></td>
                <td style={{ textAlign: 'left' }}>{b.libelle}</td>
                <td>{b.niveau}</td>
                <td>{b.tarif != null ? Number(b.tarif) + ' €' : '—'}</td>
                <td>{b.tarif != null ? <input type="number" value={b.volume_h ?? ''} style={{ width: 66, fontSize: 12, padding: '3px 5px', textAlign: 'right' }} onChange={e => majVolume(b, e.target.value)} /> : '—'}</td>
                <td style={{ fontWeight: 600 }}>{_eur0(b.montant)}</td>
                <td style={{ textAlign: 'left' }}>
                  <select value={b.promo_id || ''} style={{ fontSize: 11, padding: '2px 4px', maxWidth: 190 }} onChange={e => majBudget(b, { promo_id: e.target.value || null })}>
                    <option value="">— non reliée —</option>
                    {promos.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                  </select>
                </td>
              </tr>
            ))}
            <tr style={{ borderTop: '2px solid var(--border)', fontWeight: 700 }}>
              <td></td><td style={{ textAlign: 'left' }}>Total actif</td><td></td><td></td><td></td><td style={{ color: 'var(--navy)' }}>{_eur0(budgetTotal)}</td><td></td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Lignes de facturation */}
      <div className="card">
        <div className="flex-between" style={{ alignItems: 'center', marginBottom: 8 }}>
          <div className="card-title" style={{ marginBottom: 0 }}>Lignes de facturation</div>
          <div className="flex gap-8" style={{ background: 'var(--bg-alt)', borderRadius: 6, padding: 3 }}>
            {['tous', 'bdc', 'ypareo', 'manuel'].map(s => (
              <div key={s} onClick={() => setOngletFact(s)} style={{ padding: '4px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 12, fontWeight: 600, background: ongletFact === s ? 'var(--navy)' : 'transparent', color: ongletFact === s ? '#fff' : 'var(--text)' }}>
                {s === 'tous' ? 'Tous' : SOURCE_FACT[s]}
              </div>
            ))}
          </div>
        </div>
        {factFiltrees.length === 0 ? <div className="text-muted text-sm" style={{ padding: '10px 0' }}>Aucune ligne.</div> : (
          <table className="table" style={{ fontSize: 12 }}>
            <thead><tr><th style={{ textAlign: 'left' }}>Libellé</th><th style={{ textAlign: 'left' }}>Intervenant</th><th>Source</th><th>Période</th><th>Heures</th><th>Montant</th><th>Statut</th></tr></thead>
            <tbody>
              {factFiltrees.map(f => (
                <tr key={f.id} style={{ opacity: f.statut === 'annule' ? 0.4 : 1 }}>
                  <td style={{ textAlign: 'left' }}>{f.libelle}{f.avant_coupure && <span className="badge" style={{ marginLeft: 6, fontSize: 9 }}>avant coupure</span>}</td>
                  <td style={{ textAlign: 'left' }}>
                    <select value={f.intervenant_id || ''} style={{ fontSize: 11, padding: '2px 4px', maxWidth: 160 }} onChange={e => majFact(f, { intervenant_id: e.target.value || null })}>
                      <option value="">— non relié —</option>
                      {intervenants.map(i => <option key={i.id} value={i.id}>{i.prenom} {i.nom}</option>)}
                    </select>
                  </td>
                  <td>{SOURCE_FACT[f.source] || f.source}</td>
                  <td>{f.periode_debut ? f.periode_debut.split('-').reverse().join('/') : ''}{f.periode_fin ? ' → ' + f.periode_fin.split('-').reverse().join('/') : ''}</td>
                  <td>{f.heures != null ? Number(f.heures) : '—'}</td>
                  <td style={{ fontWeight: 600 }}>{_eur2(f.montant)}</td>
                  <td>
                    <select value={f.statut} onChange={e => majFact(f, { statut: e.target.value })} style={{ fontSize: 11, padding: '2px 4px', color: (STATUT_FACT[f.statut] || {}).color, fontWeight: 600 }}>
                      {Object.entries(STATUT_FACT).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
