// ============================================================
// PAGE BUDGET — Suivi facturation (prévisionnel / facturé / payé / reste)
// ============================================================
const _eur0 = (n) => (Number(n) || 0).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const _eur2 = (n) => (Number(n) || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
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
  const [loading, setLoading] = useState(true);
  const [ongletFact, setOngletFact] = useState('tous');

  const tauxById = useMemo(() => Object.fromEntries(intervenants.map(i => [i.id, Number(i.taux_horaire) || 0])), [intervenants]);
  const promoById = useMemo(() => Object.fromEntries(promos.map(p => [p.id, p])), [promos]);

  const charger = async () => {
    setLoading(true);
    try {
      const [b, f, pe, c] = await Promise.all([
        db.getBudgets(), db.getFacturations(), db.getPlanningEngagement(), db.getParametre('date_coupure'),
      ]);
      setBudgets(b); setFacturations(f); setPlanningEng(pe); setCoupure(c || '');
    } catch (e) { console.error(e); toast(e.message || 'Erreur de chargement', 'error'); }
    finally { setLoading(false); }
  };
  useEffect(() => { charger(); }, []);

  // --- Calculs ---
  const budgetTotal = useMemo(() => budgets.filter(b => b.actif).reduce((s, b) => s + (Number(b.montant) || 0), 0), [budgets]);

  const factLignes = useMemo(() => facturations.filter(f => f.statut !== 'annule'), [facturations]);
  const facture = useMemo(() => factLignes.filter(f => f.statut === 'facture' || f.statut === 'paye').reduce((s, f) => s + (Number(f.montant) || 0), 0), [factLignes]);
  const paye = useMemo(() => factLignes.filter(f => f.statut === 'paye').reduce((s, f) => s + (Number(f.montant) || 0), 0), [factLignes]);

  // Prévisionnel = engagement planning non encore couvert par un BDC (réconcilié par intervenant, en heures)
  const previsionnel = useMemo(() => {
    const planH = {};
    planningEng.forEach(r => { planH[r.intervenant_id] = (planH[r.intervenant_id] || 0) + HEURES_DEMI; });
    const bdcH = {};
    facturations.filter(f => f.source === 'bdc' && f.statut !== 'annule' && f.intervenant_id)
      .forEach(f => { bdcH[f.intervenant_id] = (bdcH[f.intervenant_id] || 0) + (Number(f.heures) || 0); });
    let total = 0;
    Object.keys(planH).forEach(id => {
      const reste = Math.max(0, planH[id] - (bdcH[id] || 0));
      total += reste * (tauxById[id] || 0);
    });
    return total;
  }, [planningEng, facturations, tauxById]);

  const engage = facture + previsionnel;
  const reste = budgetTotal - engage;
  const pct = budgetTotal > 0 ? Math.round((engage / budgetTotal) * 100) : 0;

  // Répartition par niveau
  const parNiveau = useMemo(() => {
    const m = {};
    budgets.filter(b => b.actif).forEach(b => {
      const k = b.niveau || '—';
      m[k] = m[k] || { niveau: k, budget: 0, facture: 0 };
      m[k].budget += Number(b.montant) || 0;
    });
    factLignes.filter(f => f.statut === 'facture' || f.statut === 'paye').forEach(f => {
      const nv = f.promo_id ? (niveaux.find(n => n.id === promoById[f.promo_id]?.niveau_id)?.label) : null;
      const k = nv || 'Historique / non rattaché';
      m[k] = m[k] || { niveau: k, budget: 0, facture: 0 };
      m[k].facture += Number(f.montant) || 0;
    });
    return Object.values(m).sort((a, b) => b.budget - a.budget);
  }, [budgets, factLignes, niveaux, promoById]);

  // --- Actions ---
  const majBudget = async (b, patch) => {
    setBudgets(bs => bs.map(x => x.id === b.id ? { ...x, ...patch } : x));
    try { await db.updateBudget(b.id, patch); } catch (e) { console.error(e); toast('Erreur', 'error'); charger(); }
  };
  const majVolume = (b, v) => {
    const vol = parseFloat(v) || 0;
    majBudget(b, { volume_h: vol, montant: +(vol * (Number(b.tarif) || 0)).toFixed(2) });
  };
  const majStatutFact = async (f, statut) => {
    setFacturations(fs => fs.map(x => x.id === f.id ? { ...x, statut } : x));
    try { await db.updateFacturation(f.id, { statut }); } catch (e) { console.error(e); toast('Erreur', 'error'); charger(); }
  };
  const majCoupure = async (v) => {
    setCoupure(v);
    try { await db.setParametre('date_coupure', v); toast('Date de coupure enregistrée', 'success'); }
    catch (e) { console.error(e); toast('Erreur', 'error'); }
  };

  const factFiltrees = ongletFact === 'tous' ? facturations : facturations.filter(f => f.source === ongletFact);

  if (loading) return <div className="page-content"><div className="page-header"><h1 className="page-title display-dot">Budget</h1></div><div className="text-muted">Chargement…</div></div>;

  const barColor = pct > 100 ? 'var(--danger)' : (pct > 85 ? '#ea580c' : 'var(--navy)');

  return (
    <div className="page-content">
      <div className="page-header">
        <div>
          <div className="breadcrumb">PILOTAGE</div>
          <h1 className="page-title display-dot">Budget &amp; facturation</h1>
          <div className="page-subtitle">Suivi des dépenses d’intervention — prévisionnel, facturé, payé.</div>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <div className="label" style={{ fontSize: 10 }}>Date de coupure (Ypareo → app)</div>
          <input type="date" value={coupure} onChange={e => majCoupure(e.target.value)} />
        </div>
      </div>

      {/* KPI principaux */}
      <div className="kpi-grid">
        <div className="kpi">
          <div className="kpi-label">Budget disponible</div>
          <div className="kpi-value">{_eur0(budgetTotal)}</div>
          <div className="kpi-sub">{budgets.filter(b => b.actif).length} ligne(s) active(s)</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Engagé</div>
          <div className="kpi-value" style={{ color: barColor }}>{_eur0(engage)}</div>
          <div className="kpi-sub">{pct}% du budget</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Reste disponible</div>
          <div className="kpi-value" style={{ color: reste < 0 ? 'var(--danger)' : '#16a34a' }}>{_eur0(reste)}</div>
          <div className="kpi-sub">{reste < 0 ? 'Dépassement !' : 'sous plafond'}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Facturé / Payé</div>
          <div className="kpi-value">{_eur0(facture)}</div>
          <div className="kpi-sub">dont payé {_eur0(paye)}</div>
        </div>
      </div>

      {/* Barre de consommation */}
      <div className="card" style={{ marginTop: 4 }}>
        <div className="flex-between" style={{ marginBottom: 6, fontSize: 12 }}>
          <span>Consommation du budget</span>
          <span style={{ fontWeight: 600, color: barColor }}>{pct}%</span>
        </div>
        <div style={{ height: 12, background: 'var(--bg-alt)', borderRadius: 6, overflow: 'hidden' }}>
          <div style={{ width: Math.min(100, pct) + '%', height: '100%', background: barColor, transition: 'width .3s' }} />
        </div>
        <div className="flex gap-16 mt-8" style={{ fontSize: 11, color: 'var(--text-muted)', flexWrap: 'wrap' }}>
          <span>🟠 Facturé : {_eur2(facture)}</span>
          <span>🔵 Prévisionnel (planning) : {_eur2(previsionnel)}</span>
          <span>🟢 Payé : {_eur2(paye)}</span>
        </div>
      </div>

      {/* Répartition par niveau */}
      <div className="card">
        <div className="card-title">Par niveau</div>
        <table className="table" style={{ fontSize: 13 }}>
          <thead><tr><th style={{ textAlign: 'left' }}>Niveau</th><th>Budget</th><th>Facturé</th><th>Reste</th><th>%</th></tr></thead>
          <tbody>
            {parNiveau.map(r => {
              const p = r.budget > 0 ? Math.round((r.facture / r.budget) * 100) : (r.facture > 0 ? 999 : 0);
              return (
                <tr key={r.niveau}>
                  <td style={{ textAlign: 'left' }}>{r.niveau}</td>
                  <td>{_eur0(r.budget)}</td>
                  <td>{_eur0(r.facture)}</td>
                  <td style={{ color: (r.budget - r.facture) < 0 ? 'var(--danger)' : 'inherit' }}>{r.budget ? _eur0(r.budget - r.facture) : '—'}</td>
                  <td style={{ color: p > 100 ? 'var(--danger)' : 'inherit' }}>{r.budget ? p + '%' : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Lignes de budget (éditable) */}
      <div className="card">
        <div className="card-title">Enveloppes budgétaires</div>
        <div className="help" style={{ marginBottom: 10 }}>Décoche une enveloppe non intégrée (ex. 3ᵉ Mastère) ou ajuste son volume (ex. Bootcamp mi-octobre : 280 h). Le montant se recalcule.</div>
        <table className="table" style={{ fontSize: 13 }}>
          <thead><tr>
            <th style={{ width: 40 }}>Actif</th><th style={{ textAlign: 'left' }}>Enveloppe</th><th>Niveau</th>
            <th>Tarif €/h</th><th>Volume (h)</th><th>Montant</th>
          </tr></thead>
          <tbody>
            {budgets.map(b => (
              <tr key={b.id} style={{ opacity: b.actif ? 1 : 0.45 }}>
                <td style={{ textAlign: 'center' }}>
                  <input type="checkbox" checked={!!b.actif} onChange={e => majBudget(b, { actif: e.target.checked })} />
                </td>
                <td style={{ textAlign: 'left' }}>{b.libelle}</td>
                <td>{b.niveau}</td>
                <td>{b.tarif != null ? Number(b.tarif) + ' €' : '—'}</td>
                <td>
                  {b.tarif != null
                    ? <input type="number" value={b.volume_h ?? ''} style={{ width: 70, fontSize: 12, padding: '3px 5px', textAlign: 'right' }}
                        onChange={e => majVolume(b, e.target.value)} />
                    : '—'}
                </td>
                <td style={{ fontWeight: 600 }}>{_eur0(b.montant)}</td>
              </tr>
            ))}
            <tr style={{ borderTop: '2px solid var(--border)', fontWeight: 700 }}>
              <td></td><td style={{ textAlign: 'left' }}>Total actif</td><td></td><td></td><td></td>
              <td style={{ color: 'var(--navy)' }}>{_eur0(budgetTotal)}</td>
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
              <div key={s} onClick={() => setOngletFact(s)}
                style={{ padding: '4px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 12, fontWeight: 600,
                  background: ongletFact === s ? 'var(--navy)' : 'transparent', color: ongletFact === s ? '#fff' : 'var(--text)' }}>
                {s === 'tous' ? 'Tous' : SOURCE_FACT[s]}
              </div>
            ))}
          </div>
        </div>
        {factFiltrees.length === 0 ? (
          <div className="text-muted text-sm" style={{ padding: '10px 0' }}>Aucune ligne.</div>
        ) : (
          <table className="table" style={{ fontSize: 12 }}>
            <thead><tr>
              <th style={{ textAlign: 'left' }}>Libellé</th><th>Source</th><th>Période</th>
              <th>Heures</th><th>Montant</th><th>Statut</th>
            </tr></thead>
            <tbody>
              {factFiltrees.map(f => (
                <tr key={f.id} style={{ opacity: f.statut === 'annule' ? 0.4 : 1 }}>
                  <td style={{ textAlign: 'left' }}>{f.libelle}{f.avant_coupure && <span className="badge" style={{ marginLeft: 6, fontSize: 9 }}>avant coupure</span>}</td>
                  <td>{SOURCE_FACT[f.source] || f.source}</td>
                  <td>{f.periode_debut ? f.periode_debut.split('-').reverse().join('/') : ''}{f.periode_fin ? ' → ' + f.periode_fin.split('-').reverse().join('/') : ''}</td>
                  <td>{f.heures != null ? Number(f.heures) : '—'}</td>
                  <td style={{ fontWeight: 600 }}>{_eur2(f.montant)}</td>
                  <td>
                    <select value={f.statut} onChange={e => majStatutFact(f, e.target.value)}
                      style={{ fontSize: 11, padding: '2px 4px', color: (STATUT_FACT[f.statut] || {}).color, fontWeight: 600 }}>
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
