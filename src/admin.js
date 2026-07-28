// ============================================================
// ESPACE ADMIN — partie 1 : login, layout, dashboard, calendrier
// ============================================================

// ---- LOGIN ----
const AdminLogin = ({ onLogged }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);

  const submit = async () => {
    setErr(null); setLoading(true);
    try {
      await db.signIn(email, password);
      onLogged();
    } catch (e) {
      setErr("Email ou mot de passe incorrect.");
    } finally { setLoading(false); }
  };

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-logo"><img src="assets/monogramme-bleu.png" alt="EEC" /></div>
        <h1 className="login-title display-dot">Planning EEC</h1>
        <div className="login-subtitle">Espace administrateur</div>

        <div className="field">
          <div className="label">Email</div>
          <input type="email" value={email} placeholder="prenom@eec-paris.com"
            onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()} />
        </div>
        <div className="field">
          <div className="label">Mot de passe</div>
          <input type="password" value={password} placeholder="••••••••"
            onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()} />
        </div>

        {err && <div style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 12 }}>{err}</div>}

        <button className="btn btn-primary" disabled={loading} onClick={submit}>
          {loading ? 'Connexion…' : 'Se connecter →'}
        </button>
      </div>
    </div>
  );
};

// ---- SIDEBAR ----
const Sidebar = ({ current, onNav, onLogout }) => {
  const groups = [
    { title: 'Pilotage', items: [
      { id: 'dashboard', label: 'Tableau de bord', icon: 'dashboard' },
      { id: 'calendrier', label: 'Vue calendrier', icon: 'calendar' },
      { id: 'planning', label: 'Planning', icon: 'layout' },
      { id: 'etudiants', label: 'Étudiants', icon: 'users' },
      { id: 'budget', label: 'Budget', icon: 'dashboard' },
    ]},
    { title: 'Gestion', items: [
      { id: 'intervenants', label: 'Intervenants', icon: 'users' },
      { id: 'programme', label: 'Programme', icon: 'layout' },
      { id: 'promos', label: 'Promos', icon: 'users' },
      { id: 'campagnes', label: 'Campagnes', icon: 'calendar' },
      { id: 'parametres', label: 'Niveaux & catégories', icon: 'settings' },
    ]},
  ];
  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <img src="assets/logo-blanc.png" alt="EEC" />
        <div className="app-name">PLANNING<span className="accent">.</span></div>
      </div>
      {groups.map(g => (
        <div className="sidebar-section" key={g.title}>
          <div className="sidebar-section-title">{g.title}</div>
          {g.items.map(i => (
            <div key={i.id} className={'nav-link ' + (current === i.id ? 'active' : '')} onClick={() => onNav(i.id)}>
              <span className="icon"><Icon name={i.icon} /></span>{i.label}
            </div>
          ))}
        </div>
      ))}
      <div className="sidebar-footer">
        <div className="nav-link" onClick={onLogout} style={{ color: 'rgba(255,255,255,0.7)' }}>
          <span className="icon"><Icon name="logout" /></span> Se déconnecter
        </div>
        <div style={{ marginTop: 8, opacity: 0.5, fontSize: 11 }}>Planning EEC v1.0</div>
      </div>
    </aside>
  );
};

// ---- DASHBOARD ----
const PageDashboard = ({ data, onNav }) => {
  const { intervenants, campagne, dispos } = data;
  const invites = intervenants.length;
  const repondus = intervenants.filter(i => i.statut === 'valide').length;
  const enCours = intervenants.filter(i => i.statut === 'en_cours').length;
  const pasRepondu = intervenants.filter(i => i.statut === 'pas_repondu').length;
  const tauxReponse = invites ? Math.round((repondus / invites) * 100) : 0;

  return (
    <div className="page-content">
      <div className="page-header">
        <div>
          <div className="breadcrumb">PILOTAGE</div>
          <h1 className="page-title display-dot">Tableau de bord</h1>
          <div className="page-subtitle">
            {campagne ? <>Campagne en cours : <strong>{campagne.nom}</strong></> : 'Aucune campagne ouverte'}
          </div>
        </div>
        <button className="btn btn-primary" onClick={() => onNav('intervenants')}>
          <Icon name="plus" /> Gérer les intervenants
        </button>
      </div>

      <div className="kpi-grid">
        <div className="kpi">
          <div className="kpi-label">Intervenants</div>
          <div className="kpi-value">{invites}</div>
          <div className="kpi-sub">Dans le pool actif</div>
        </div>
        <div className="kpi accent">
          <div className="kpi-label">Taux de réponse</div>
          <div className="kpi-value">{tauxReponse}<span className="unit">%</span></div>
          <div className="kpi-sub">{repondus} / {invites} validés</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">En cours</div>
          <div className="kpi-value">{enCours}</div>
          <div className="kpi-sub">Saisie commencée</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Pas répondu</div>
          <div className="kpi-value" style={{ color: 'var(--danger)' }}>{pasRepondu}</div>
          <div className="kpi-sub">À relancer</div>
        </div>
      </div>

      <div className="card">
        <div className="card-title">Activité de la collecte</div>
        {invites === 0 ? (
          <div className="text-muted text-sm" style={{ padding: '20px 0', textAlign: 'center' }}>
            Aucun intervenant pour le moment. Commence par en ajouter dans l’onglet « Intervenants »,
            puis envoie-leur leur lien personnel.
          </div>
        ) : (
          <div className="text-sm" style={{ lineHeight: 1.9 }}>
            {intervenants.slice(0, 8).map(i => (
              <div key={i.id} className="flex-between" style={{ borderBottom: '1px solid var(--bg-alt)', padding: '6px 0' }}>
                <span><strong>{i.prenom} {i.nom}</strong></span>
                <span>
                  {i.statut === 'valide' && <span className="chip success"><span className="badge-dot"></span> Validé</span>}
                  {i.statut === 'en_cours' && <span className="chip warn"><span className="badge-dot warn"></span> En cours</span>}
                  {i.statut === 'pas_repondu' && <span className="chip danger"><span className="badge-dot danger"></span> Pas répondu</span>}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// ---- VUE CALENDRIER (heatmap + hover/clic) ----
const PageCalendrier = ({ data }) => {
  const { intervenants, campagne, dispos, niveaux } = data;
  const campagnes = data.campagnes || [];
  const [filterNiveau, setFilterNiveau] = useState('all');
  const [detail, setDetail] = useState(null); // { date, periode, liste:[] }
  // Campagne affichée : par défaut celle chargée globalement (l'ouverte), mais on peut
  // en choisir une autre (dispos rechargées à la demande).
  const [campSelId, setCampSelId] = useState(campagne?.id || (campagnes[0] && campagnes[0].id) || null);
  const [disposLocal, setDisposLocal] = useState(dispos || []);
  const [chargementDispos, setChargementDispos] = useState(false);
  const campSel = campagnes.find(c => c.id === campSelId) || campagne || null;

  // Recharge les dispos quand on change de campagne (réutilise data.dispos pour l'ouverte)
  useEffect(() => {
    let annule = false;
    if (!campSelId) { setDisposLocal([]); return; }
    if (campagne && campSelId === campagne.id) { setDisposLocal(dispos || []); return; }
    setChargementDispos(true);
    db.getDisposCampagne(campSelId)
      .then(d => { if (!annule) setDisposLocal(d || []); })
      .catch(e => { console.error(e); if (!annule) setDisposLocal([]); })
      .finally(() => { if (!annule) setChargementDispos(false); });
    return () => { annule = true; };
  }, [campSelId, dispos]);

  // Filtre intervenants : Set des IDs sélectionnés. Par défaut tous cochés.
  const [selectedIntervenants, setSelectedIntervenants] = useState(() => new Set(intervenants.map(i => i.id)));
  const [showFilterModal, setShowFilterModal] = useState(false);

  // Quand la liste d'intervenants change (nouveaux ajouts), on inclut auto les nouveaux
  useEffect(() => {
    setSelectedIntervenants(prev => {
      let changed = false;
      const next = new Set(prev);
      intervenants.forEach(i => { if (!next.has(i.id)) { next.add(i.id); changed = true; } });
      return changed ? next : prev;
    });
  }, [intervenants]);

  if (!campSel) {
    return <div className="page-content"><div className="card text-muted">Aucune campagne enregistrée.</div></div>;
  }

  const weeks = useMemo(() => generateWeeks(campSel.date_debut, campSel.date_fin), [campSel]);

  // Index : pour une date+periode, qui est dispo ?
  // On filtre par niveau ET par intervenant sélectionné
  const dispoIndex = useMemo(() => {
    const idx = {};
    const interById = Object.fromEntries(intervenants.map(i => [i.id, i]));
    disposLocal.forEach(d => {
      const inter = interById[d.intervenant_id];
      if (!inter) return;
      if (filterNiveau !== 'all' && !inter.niveaux.includes(filterNiveau)) return;
      if (!selectedIntervenants.has(inter.id)) return;
      const key = `${d.date}-${d.periode}`;
      (idx[key] = idx[key] || []).push(inter);
    });
    return idx;
  }, [disposLocal, intervenants, filterNiveau, selectedIntervenants]);

  const countFor = (dateStr, periode) => (dispoIndex[`${dateStr}-${periode}`] || []).length;

  const valueToLevel = (v) => {
    if (v === 0) return 'lvl-0';
    if (v <= 2) return 'lvl-1';
    if (v <= 4) return 'lvl-2';
    if (v <= 6) return 'lvl-3';
    if (v <= 8) return 'lvl-4';
    return 'lvl-5';
  };

  const openDetail = (dateStr, periode) => {
    const liste = dispoIndex[`${dateStr}-${periode}`] || [];
    setDetail({ dateStr, periode, liste });
  };

  return (
    <div className="page-content">
      <div className="page-header">
        <div>
          <div className="breadcrumb">PILOTAGE</div>
          <h1 className="page-title display-dot">Vue calendrier</h1>
          <div className="page-subtitle">
            Intervenants disponibles par demi-journée — {campSel.nom}
            {campSel.statut !== 'ouverte' && <span className="badge" style={{ marginLeft: 8, background: '#f1f5f9', color: '#64748b' }}>fermée</span>}
            {chargementDispos && <span className="text-muted" style={{ marginLeft: 8, fontSize: 12 }}>· chargement…</span>}
          </div>
        </div>
      </div>

      <div className="filters-bar">
        <div>
          <label className="label" style={{ marginBottom: 4, fontSize: 10 }}>Campagne</label>
          <select value={campSelId || ''} onChange={e => setCampSelId(e.target.value)}>
            {campagnes.map(c => (
              <option key={c.id} value={c.id}>
                {c.nom}{c.statut === 'ouverte' ? ' • ouverte' : ''}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" style={{ marginBottom: 4, fontSize: 10 }}>Niveau</label>
          <select value={filterNiveau} onChange={e => setFilterNiveau(e.target.value)}>
            <option value="all">Tous les niveaux</option>
            {niveaux.map(n => <option key={n.id} value={n.id}>{n.label}</option>)}
          </select>
        </div>
        <div>
          <label className="label" style={{ marginBottom: 4, fontSize: 10 }}>Intervenants</label>
          <button className="btn btn-ghost btn-sm" onClick={() => setShowFilterModal(true)} style={{ height: 36 }}>
            <Icon name="users" size={12} /> {selectedIntervenants.size} / {intervenants.length}
            {selectedIntervenants.size < intervenants.length && (
              <span className="chip cyan" style={{ marginLeft: 6, fontSize: 10 }}>Filtré</span>
            )}
          </button>
        </div>
      </div>

      <div className="card">
        <div style={{ overflowX: 'auto' }}>
          <table className="heatmap-table" style={{ minWidth: 900 }}>
            <thead>
              <tr>
                <th className="week-col">Semaine</th>
                {['LUN', 'MAR', 'MER', 'JEU', 'VEN'].map(d => <th key={d} colSpan="2">{d}</th>)}
              </tr>
              <tr>
                <th className="week-col"></th>
                {[0, 1, 2, 3, 4].map(i => (
                  <React.Fragment key={i}>
                    <th style={{ fontSize: 9, opacity: 0.7 }}>matin</th>
                    <th style={{ fontSize: 9, opacity: 0.7 }}>aprem</th>
                  </React.Fragment>
                ))}
              </tr>
            </thead>
            <tbody>
              {weeks.map((w) => (
                <tr key={w.iso}>
                  <td className="week-col" style={{ textAlign: 'left', padding: '4px 12px', whiteSpace: 'nowrap' }}>
                    <div style={{ color: 'var(--navy)', fontFamily: 'Gopher Heavy', fontSize: 11 }}>S{w.iso}</div>
                    <div style={{ color: 'var(--text-muted)', fontSize: 10 }}>{w.startStr} → {w.endStr}</div>
                  </td>
                  {w.days.map((day) => {
                    const ds = isoDate(day);
                    return (
                      <React.Fragment key={ds}>
                        {['am', 'pm'].map(p => {
                          const v = countFor(ds, p);
                          return (
                            <td key={p}>
                              <div className={'heatmap-cell ' + valueToLevel(v)}
                                title={`${v} intervenant(s) — clic pour le détail`}
                                onClick={() => openDetail(ds, p)}>
                                {v > 0 ? v : ''}
                              </div>
                            </td>
                          );
                        })}
                      </React.Fragment>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="heatmap-legend">
          <span>0</span>
          <span className="scale">
            {['#ecedf3', '#ffd6d6', '#ffe4b8', '#b6e8d2', '#72e4e5', 'var(--navy)'].map((c, i) =>
              <span key={i} className="swatch" style={{ background: c }}></span>)}
          </span>
          <span>10+</span>
          <span style={{ marginLeft: 16, opacity: 0.7 }}>· Survole une case pour le nombre, clique pour la liste des intervenants</span>
        </div>
      </div>

      {detail && (
        <div className="modal-backdrop" onClick={() => setDetail(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <h3>{new Date(detail.dateStr + 'T00:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })} — {detail.periode === 'am' ? 'matin' : 'après-midi'}</h3>
              <div className="modal-close" onClick={() => setDetail(null)}><Icon name="x" size={16} /></div>
            </div>
            {detail.liste.length === 0 ? (
              <div className="text-muted text-sm">Aucun intervenant disponible sur ce créneau{filterNiveau !== 'all' ? ' pour ce niveau' : ''}.</div>
            ) : (
              <div>
                <div className="text-sm text-muted mb-16">{detail.liste.length} intervenant(s) disponible(s) :</div>
                {detail.liste.map(i => (
                  <div key={i.id} className="flex-between" style={{ padding: '8px 0', borderBottom: '1px solid var(--bg-alt)' }}>
                    <div>
                      <div className="td-name">{i.prenom} {i.nom}</div>
                      <div style={{ display: 'flex', gap: 4, marginTop: 2 }}>
                        {i.niveaux.map(nid => {
                          const niv = niveaux.find(x => x.id === nid);
                          return niv ? <span key={nid} className={'chip ' + niv.couleur}>{niv.label}</span> : null;
                        })}
                      </div>
                    </div>
                    <div className="text-sm text-muted">{fmtEur(calcDemiJournee(i.taux_horaire))} / ½ j</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {showFilterModal && (
        <div className="modal-backdrop" onClick={() => setShowFilterModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 520, maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
            <div className="modal-head">
              <h3>Filtrer les intervenants</h3>
              <div className="modal-close" onClick={() => setShowFilterModal(false)}><Icon name="x" size={16} /></div>
            </div>
            <div className="text-sm text-muted mb-16">
              Coche les intervenants à inclure dans le calendrier. {selectedIntervenants.size} / {intervenants.length} sélectionné(s).
            </div>
            <div className="flex gap-8 mb-16">
              <button className="btn btn-ghost btn-sm" onClick={() => setSelectedIntervenants(new Set(intervenants.map(i => i.id)))}>
                Tout cocher
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setSelectedIntervenants(new Set())}>
                Tout décocher
              </button>
            </div>
            <div style={{ overflowY: 'auto', flex: 1, border: '1px solid var(--border)', borderRadius: 6, padding: '4px 0' }}>
              {intervenants.length === 0 ? (
                <div className="text-muted text-sm" style={{ padding: 16, textAlign: 'center' }}>Aucun intervenant.</div>
              ) : intervenants.map(i => {
                const checked = selectedIntervenants.has(i.id);
                return (
                  <label key={i.id}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid var(--bg-alt)' }}>
                    <input type="checkbox" checked={checked}
                      onChange={(e) => {
                        setSelectedIntervenants(prev => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(i.id); else next.delete(i.id);
                          return next;
                        });
                      }} />
                    <div style={{ flex: 1 }}>
                      <div className="text-sm" style={{ fontWeight: 500 }}>{i.prenom} {i.nom}</div>
                      <div style={{ display: 'flex', gap: 4, marginTop: 2 }}>
                        {i.niveaux.map(nid => {
                          const niv = niveaux.find(x => x.id === nid);
                          return niv ? <span key={nid} className={'chip ' + niv.couleur} style={{ fontSize: 10 }}>{niv.label}</span> : null;
                        })}
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
            <div className="modal-foot">
              <button className="btn btn-primary" onClick={() => setShowFilterModal(false)}>Appliquer</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
