// ============================================================
// ÉMARGEMENT — composants côté formateur (QR) et côté étudiant (signature)
// Chargés dans la page publique (token). Aucune donnée étudiant n'est lue
// autrement que par les fonctions RPC sécurisées.
// ============================================================

// Chargement paresseux d'une lib QR (qrcode) depuis un CDN, une seule fois.
let _qrLibPromise = null;
function chargerQRLib() {
  if (window.QRCode) return Promise.resolve(window.QRCode);
  if (_qrLibPromise) return _qrLibPromise;
  _qrLibPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
    s.onload = () => resolve(window.QRCode);
    s.onerror = () => reject(new Error('Chargement du QR impossible (réseau ?)'));
    document.head.appendChild(s);
  });
  return _qrLibPromise;
}

const EMARG_STATUTS = {
  attendu: { label: 'En attente', color: '#94a3b8', bg: '#f1f5f9' },
  present: { label: 'Présent', color: '#16a34a', bg: '#dcfce7' },
  retard: { label: 'Retard', color: '#ea580c', bg: '#ffedd5' },
  absent: { label: 'Absent', color: '#dc2626', bg: '#fee2e2' },
  excuse: { label: 'Excusé', color: '#2563eb', bg: '#dbeafe' },
};

const fmtJourLong = (iso) => {
  if (!iso) return '';
  try { return new Date(iso + 'T00:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }); }
  catch { return iso; }
};
const fmtHeure = (t) => (t ? String(t).slice(0, 5) : '');

// ---------- QR affiché par le formateur (rotatif) ----------
const QRAffiche = ({ seanceId, cle, rotationSec }) => {
  const ref = useRef(null);
  const qrRef = useRef(null);

  useEffect(() => {
    let annule = false;
    chargerQRLib().then(QRCode => {
      if (annule || !ref.current) return;
      const base = window.location.origin + window.location.pathname;
      const url = `${base}?emargement=${seanceId}&k=${cle || ''}`;
      if (!qrRef.current) {
        ref.current.innerHTML = '';
        qrRef.current = new QRCode(ref.current, { text: url, width: 260, height: 260, correctLevel: QRCode.CorrectLevel.M });
      } else {
        qrRef.current.clear();
        qrRef.current.makeCode(url);
      }
    }).catch(() => {});
    return () => { annule = true; };
  }, [seanceId, cle]);

  return (
    <div style={{ textAlign: 'center' }}>
      <div ref={ref} style={{ display: 'inline-block', padding: 16, background: '#fff', borderRadius: 12, boxShadow: '0 2px 12px rgba(0,0,0,.12)' }} />
      <div className="text-muted text-sm" style={{ marginTop: 10 }}>
        Les étudiants scannent ce QR. Il se régénère toutes les {rotationSec || 30}s — laisse-le affiché.
      </div>
    </div>
  );
};

// ---------- Tableau de bord d'une séance (côté formateur) ----------
const EmargementSeance = ({ token, seanceId, onRetour }) => {
  const toast = useToast();
  const [etat, setEtat] = useState(null);
  const [busy, setBusy] = useState(false);

  const rafraichir = async () => {
    try { setEtat(await db.emargementEtat(token, seanceId)); }
    catch (e) { console.error(e); toast(e.message || 'Erreur', 'error'); }
  };
  useEffect(() => {
    rafraichir();
    const t = setInterval(rafraichir, 4000); // le live + la rotation de la clé
    return () => clearInterval(t);
  }, [seanceId]);

  const marquer = async (etudiantId, statut) => {
    try { setEtat(await db.emargementMarquer(token, seanceId, etudiantId, statut)); }
    catch (e) { console.error(e); toast(e.message || 'Erreur', 'error'); }
  };
  const cloturer = async () => {
    if (!confirm('Clôturer l’émargement ? Les étudiants non signés seront marqués absents.')) return;
    setBusy(true);
    try { setEtat(await db.emargementCloturer(token, seanceId)); toast('Émargement clôturé', 'success'); }
    catch (e) { console.error(e); toast(e.message || 'Erreur', 'error'); }
    finally { setBusy(false); }
  };

  if (!etat) return <div className="text-muted" style={{ padding: 20 }}>Chargement…</div>;
  const s = etat.seance;
  const ouverte = s.statut === 'ouverte';
  const signes = etat.lignes.filter(l => l.statut !== 'attendu').length;

  return (
    <div>
      <button className="quick-btn" onClick={onRetour} style={{ marginBottom: 12 }}>← Mes cours</button>

      <div className="card">
        <div className="flex-between" style={{ flexWrap: 'wrap', gap: 8 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{s.module || 'Séance'}</div>
            <div className="text-muted text-sm">{s.promo} · {fmtJourLong(s.date_jour)} · {s.periode === 'am' ? 'Matin' : 'Après-midi'} ({fmtHeure(s.heure_debut)}–{fmtHeure(s.heure_fin)})</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{signes}/{etat.lignes.length}</div>
            <div className="text-muted text-sm">émargé(s)</div>
          </div>
        </div>
        {s.hors_delai && <div className="text-sm" style={{ marginTop: 8, color: '#ea580c' }}>⚠ Séance ouverte en régularisation (hors fenêtre) — c’est tracé.</div>}
      </div>

      {ouverte && etat.cle && (
        <div className="card" style={{ background: 'var(--navy)', color: '#fff' }}>
          <QRAffiche seanceId={s.id} cle={etat.cle} rotationSec={etat.rotation_sec} />
        </div>
      )}

      <div className="card">
        <div className="flex-between" style={{ marginBottom: 10 }}>
          <div style={{ fontWeight: 600 }}>Feuille de présence</div>
          {ouverte && <button className="btn btn-primary btn-sm" disabled={busy} onClick={cloturer}>Clôturer</button>}
          {!ouverte && <span className="badge" style={{ background: '#dcfce7', color: '#16a34a' }}>Clôturée</span>}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {etat.lignes.map(l => {
            const st = EMARG_STATUTS[l.statut] || EMARG_STATUTS.attendu;
            return (
              <div key={l.etudiant_id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8, background: st.bg }}>
                <div style={{ flex: 1, fontWeight: 500 }}>
                  {l.nom} <span style={{ fontWeight: 400 }}>{l.prenom}</span>
                  {l.signature && <span title="Signé par l’étudiant"> ✍️</span>}
                </div>
                <div style={{ fontSize: 12, fontWeight: 600, color: st.color, minWidth: 72, textAlign: 'right' }}>{st.label}</div>
                {ouverte && (
                  <div className="flex gap-4">
                    {['present', 'retard', 'absent', 'excuse'].map(code => (
                      <button key={code} onClick={() => marquer(l.etudiant_id, code)}
                        title={EMARG_STATUTS[code].label}
                        style={{ border: 'none', cursor: 'pointer', borderRadius: 6, width: 30, height: 30, fontSize: 14,
                          background: l.statut === code ? EMARG_STATUTS[code].color : '#fff',
                          color: l.statut === code ? '#fff' : EMARG_STATUTS[code].color,
                          boxShadow: '0 1px 3px rgba(0,0,0,.12)' }}>
                        {code === 'present' ? '✓' : code === 'retard' ? '⏱' : code === 'absent' ? '✕' : 'E'}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div className="text-muted text-sm" style={{ marginTop: 10 }}>
          Les étudiants signent via le QR. Utilise les boutons pour les retards/absences ou un présent sans smartphone.
        </div>
      </div>
    </div>
  );
};

// ---------- Liste des cours du formateur ----------
const EmargementFormateur = ({ token }) => {
  const toast = useToast();
  const [seances, setSeances] = useState(null);
  const [seanceId, setSeanceId] = useState(null);
  const [busy, setBusy] = useState(false);

  const charger = async () => {
    try { setSeances(await db.emargementMesSeances(token)); }
    catch (e) { console.error(e); toast(e.message || 'Erreur', 'error'); }
  };
  useEffect(() => { charger(); }, []);

  const ouvrir = async (planningId, force = false) => {
    setBusy(true);
    try {
      const etat = await db.emargementOuvrir(token, planningId, force);
      setSeanceId(etat.seance.id);
    } catch (e) {
      const msg = e.message || 'Erreur';
      if (!force && /hors fen/i.test(msg)) {
        if (confirm(msg + '\n\nOuvrir quand même en régularisation ? (ce sera tracé)')) return ouvrir(planningId, true);
      } else { toast(msg, 'error'); }
    } finally { setBusy(false); }
  };

  if (seanceId) return <EmargementSeance token={token} seanceId={seanceId} onRetour={() => { setSeanceId(null); charger(); }} />;
  if (!seances) return <div className="text-muted" style={{ padding: 20 }}>Chargement…</div>;
  if (seances.length === 0) return <div className="text-muted" style={{ padding: 20 }}>Aucun cours sur les 7 derniers jours.</div>;

  const auj = (new Date()).toLocaleDateString('sv');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {seances.map(s => {
        const estAuj = s.date_jour === auj;
        return (
          <div key={s.planning_id} className="card" style={{ margin: 0, borderLeft: estAuj ? '4px solid var(--cyan)' : '4px solid transparent' }}>
            <div className="flex-between" style={{ flexWrap: 'wrap', gap: 8 }}>
              <div>
                <div style={{ fontWeight: 600 }}>{s.module}</div>
                <div className="text-muted text-sm">{s.promo} · {fmtJourLong(s.date_jour)} · {s.periode === 'am' ? 'Matin' : 'Après-midi'}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                {s.seance_id
                  ? <button className="btn btn-secondary btn-sm" onClick={() => setSeanceId(s.seance_id)}>
                      {s.statut === 'cloturee' ? 'Voir' : 'Reprendre'} ({s.nb_signes}/{s.nb_etudiants})
                    </button>
                  : <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => ouvrir(s.planning_id)}>Faire l’appel</button>}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

// ---------- Pad de signature (canvas tactile) ----------
const SignaturePad = ({ onValider, onAnnuler }) => {
  const cvRef = useRef(null);
  const drawing = useRef(false);
  const vide = useRef(true);

  useEffect(() => {
    const cv = cvRef.current;
    const ratio = window.devicePixelRatio || 1;
    cv.width = cv.offsetWidth * ratio; cv.height = cv.offsetHeight * ratio;
    const ctx = cv.getContext('2d');
    ctx.scale(ratio, ratio); ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.strokeStyle = '#0f172a';
    const pos = (e) => {
      const r = cv.getBoundingClientRect();
      const p = e.touches ? e.touches[0] : e;
      return { x: p.clientX - r.left, y: p.clientY - r.top };
    };
    const start = (e) => { drawing.current = true; vide.current = false; const { x, y } = pos(e); ctx.beginPath(); ctx.moveTo(x, y); e.preventDefault(); };
    const move = (e) => { if (!drawing.current) return; const { x, y } = pos(e); ctx.lineTo(x, y); ctx.stroke(); e.preventDefault(); };
    const end = () => { drawing.current = false; };
    cv.addEventListener('mousedown', start); cv.addEventListener('mousemove', move); window.addEventListener('mouseup', end);
    cv.addEventListener('touchstart', start, { passive: false }); cv.addEventListener('touchmove', move, { passive: false }); cv.addEventListener('touchend', end);
    return () => {
      cv.removeEventListener('mousedown', start); cv.removeEventListener('mousemove', move); window.removeEventListener('mouseup', end);
      cv.removeEventListener('touchstart', start); cv.removeEventListener('touchmove', move); cv.removeEventListener('touchend', end);
    };
  }, []);

  const effacer = () => { const cv = cvRef.current; cv.getContext('2d').clearRect(0, 0, cv.width, cv.height); vide.current = true; };
  const valider = () => {
    if (vide.current) return;
    onValider(cvRef.current.toDataURL('image/png'));
  };

  return (
    <div>
      <canvas ref={cvRef} style={{ width: '100%', height: 180, border: '2px dashed #cbd5e1', borderRadius: 12, touchAction: 'none', background: '#fff' }} />
      <div className="flex gap-8" style={{ marginTop: 10 }}>
        <button className="btn btn-secondary btn-sm" onClick={effacer}>Effacer</button>
        <div style={{ flex: 1 }} />
        <button className="btn btn-secondary btn-sm" onClick={onAnnuler}>Annuler</button>
        <button className="btn btn-primary" onClick={valider}>Valider ma signature</button>
      </div>
    </div>
  );
};

// ---------- Page publique de signature (ouverte via le QR) ----------
const EmargementEtudiant = ({ seanceId, cle }) => {
  const [phase, setPhase] = useState('chargement'); // chargement | erreur | liste | signature | fini
  const [message, setMessage] = useState('');
  const [data, setData] = useState(null);
  const [choisi, setChoisi] = useState(null);

  const ouvrir = async () => {
    setPhase('chargement');
    try {
      const r = await db.emargementPublicOuvrir(seanceId, cle);
      setData(r); setPhase('liste');
    } catch (e) { setMessage(e.message || 'Lien invalide'); setPhase('erreur'); }
  };
  useEffect(() => { ouvrir(); }, []);

  const signer = async (dataUrl) => {
    setPhase('chargement');
    try {
      await db.emargementPublicSigner(data.ticket, choisi.etudiant_id, dataUrl);
      setPhase('fini');
    } catch (e) { setMessage(e.message || 'Erreur'); setPhase('erreur'); }
  };

  const box = (children) => (
    <div className="public-page"><div className="public-main" style={{ maxWidth: 460, margin: '0 auto', paddingTop: 24 }}>{children}</div></div>
  );

  if (phase === 'chargement') return box(<div className="text-muted" style={{ textAlign: 'center', paddingTop: 60 }}>Chargement…</div>);

  if (phase === 'erreur') return box(
    <div className="card" style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 40 }}>⏳</div>
      <div style={{ fontWeight: 700, margin: '8px 0' }}>{message}</div>
      <button className="btn btn-primary" onClick={ouvrir} style={{ marginTop: 8 }}>Rescanner / réessayer</button>
    </div>
  );

  if (phase === 'fini') return box(
    <div className="card" style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 48 }}>✅</div>
      <div style={{ fontWeight: 700, fontSize: 18, margin: '8px 0' }}>Présence enregistrée</div>
      <div className="text-muted">Merci {choisi?.prenom} — tu peux fermer cette page.</div>
    </div>
  );

  if (phase === 'signature') return box(
    <div className="card">
      <div style={{ fontWeight: 700, marginBottom: 4 }}>{choisi.prenom} {choisi.nom}</div>
      <div className="text-muted text-sm" style={{ marginBottom: 12 }}>Signe dans le cadre pour confirmer ta présence.</div>
      <SignaturePad onValider={signer} onAnnuler={() => setChoisi(null) || setPhase('liste')} />
    </div>
  );

  // phase liste
  const s = data.seance;
  return box(
    <div>
      <div className="card" style={{ background: 'var(--navy)', color: '#fff' }}>
        <div style={{ fontWeight: 700, fontSize: 16 }}>{s.module || 'Émargement'}</div>
        <div className="text-sm" style={{ opacity: .85 }}>{s.promo} · {fmtJourLong(s.date_jour)} · {s.periode === 'am' ? 'Matin' : 'Après-midi'}</div>
      </div>
      <div className="card">
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Trouve ton nom pour signer</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {data.etudiants.map(e => (
            <button key={e.etudiant_id} disabled={e.deja_signe}
              onClick={() => { setChoisi(e); setPhase('signature'); }}
              style={{ textAlign: 'left', padding: '12px 14px', borderRadius: 10, border: '1px solid var(--border)',
                background: e.deja_signe ? '#f1f5f9' : '#fff', cursor: e.deja_signe ? 'default' : 'pointer',
                color: e.deja_signe ? '#94a3b8' : 'inherit', fontWeight: 500 }}>
              {e.nom} {e.prenom} {e.deja_signe && ' ✓ déjà signé'}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
