// ============================================================
// SUPABASE — connexion + couche d'accès aux données
// ============================================================
// Ce module crée le client Supabase et expose toutes les fonctions
// dont l'app a besoin. Rien à éditer ici (tout est piloté par config.js).
// ============================================================

// Initialisation paresseuse du client : on ne crée le client qu'au premier
// usage réel, ce qui garantit que le SDK Supabase (chargé via CDN) est bien
// disponible, quel que soit l'ordre exact de chargement des scripts.
let _clientInstance = null;
function getClient() {
  if (!_clientInstance) {
    if (typeof supabase === 'undefined' || !supabase.createClient) {
      throw new Error("Le SDK Supabase n'est pas encore chargé. Vérifie ta connexion.");
    }
    _clientInstance = supabase.createClient(
      window.EEC_CONFIG.SUPABASE_URL,
      window.EEC_CONFIG.SUPABASE_ANON_KEY
    );
  }
  return _clientInstance;
}

// Proxy : permet d'écrire `_client.from(...)` comme avant, mais l'instance
// réelle est résolue à la volée via getClient().
const _client = new Proxy({}, {
  get(_t, prop) {
    const c = getClient();
    const v = c[prop];
    return typeof v === 'function' ? v.bind(c) : v;
  }
});

// Exposé globalement pour les autres modules
window.db = {
  client: _client,

  // ----------------------------------------------------------
  // AUTH ADMIN
  // ----------------------------------------------------------
  async signIn(email, password) {
    const { data, error } = await _client.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  },

  async signOut() {
    await _client.auth.signOut();
  },

  async getSession() {
    const { data } = await _client.auth.getSession();
    return data.session;
  },

  onAuthChange(callback) {
    return _client.auth.onAuthStateChange((_event, session) => callback(session));
  },

  // ----------------------------------------------------------
  // RÉFÉRENCES : niveaux & matières
  // ----------------------------------------------------------
  async getNiveaux() {
    const { data, error } = await _client
      .from('niveaux').select('*').eq('actif', true).order('ordre');
    if (error) throw error;
    return data;
  },

  async getMatieres() {
    const { data, error } = await _client
      .from('matieres').select('*').eq('actif', true).order('ordre');
    if (error) throw error;
    return data;
  },

  async addNiveau(label, couleur, ordre) {
    const { data, error } = await _client
      .from('niveaux').insert({ label, couleur, ordre }).select().single();
    if (error) throw error;
    return data;
  },

  async addMatiere(label, ordre) {
    const { data, error } = await _client
      .from('matieres').insert({ label, ordre }).select().single();
    if (error) throw error;
    return data;
  },

  async deactivateNiveau(id) {
    const { error } = await _client.from('niveaux').update({ actif: false }).eq('id', id);
    if (error) throw error;
  },

  async deactivateMatiere(id) {
    const { error } = await _client.from('matieres').update({ actif: false }).eq('id', id);
    if (error) throw error;
  },

  // ----------------------------------------------------------
  // CAMPAGNES
  // ----------------------------------------------------------
  async getCampagnes() {
    const { data, error } = await _client
      .from('campagnes').select('*').order('date_debut', { ascending: false });
    if (error) throw error;
    return data;
  },

  async getCampagneOuverte() {
    const { data, error } = await _client
      .from('campagnes').select('*').eq('statut', 'ouverte')
      .order('date_debut', { ascending: false }).limit(1).maybeSingle();
    if (error) throw error;
    return data;
  },

  async addCampagne(nom, date_debut, date_fin, statut = 'ouverte') {
    const { data, error } = await _client
      .from('campagnes').insert({ nom, date_debut, date_fin, statut }).select().single();
    if (error) throw error;
    return data;
  },

  async updateCampagneStatut(id, statut) {
    const { error } = await _client.from('campagnes').update({ statut }).eq('id', id);
    if (error) throw error;
  },

  // ----------------------------------------------------------
  // INTERVENANTS (admin)
  // ----------------------------------------------------------
  async getIntervenants(includeArchives = false) {
    // Récupère intervenants + leurs niveaux + leurs ratings, en 3 requêtes fusionnées
    // Par défaut : seulement les actifs. includeArchives=true pour aussi voir les archivés.
    let query = _client.from('intervenants').select('*').order('nom');
    if (!includeArchives) query = query.eq('actif', true);
    const { data: intervenants, error } = await query;
    if (error) throw error;

    const { data: liens } = await _client.from('intervenant_niveaux').select('*');
    const { data: ratings } = await _client.from('intervenant_ratings').select('*');

    return intervenants.map(i => ({
      ...i,
      niveaux: (liens || []).filter(l => l.intervenant_id === i.id).map(l => l.niveau_id),
      ratings: Object.fromEntries(
        (ratings || []).filter(r => r.intervenant_id === i.id).map(r => [r.matiere_id, r.note])
      ),
    }));
  },

  async getIntervenant(id) {
    const { data, error } = await _client
      .from('intervenants').select('*').eq('id', id).single();
    if (error) throw error;
    const { data: liens } = await _client
      .from('intervenant_niveaux').select('niveau_id').eq('intervenant_id', id);
    const { data: ratings } = await _client
      .from('intervenant_ratings').select('*').eq('intervenant_id', id);
    return {
      ...data,
      niveaux: (liens || []).map(l => l.niveau_id),
      ratings: Object.fromEntries((ratings || []).map(r => [r.matiere_id, r.note])),
    };
  },

  async addIntervenant(payload) {
    // payload : { prenom, nom, email, telephone, ville, taux_horaire }
    const { data, error } = await _client
      .from('intervenants').insert(payload).select().single();
    if (error) throw error;
    return data;
  },

  async updateIntervenant(id, payload) {
    const { error } = await _client.from('intervenants').update(payload).eq('id', id);
    if (error) throw error;
  },

  async deactivateIntervenant(id) {
    const { error } = await _client.from('intervenants').update({ actif: false }).eq('id', id);
    if (error) throw error;
  },

  // Réactiver un intervenant archivé (passe actif=false → actif=true)
  async reactivateIntervenant(id) {
    const { error } = await _client.from('intervenants').update({ actif: true }).eq('id', id);
    if (error) throw error;
  },

  // SUPPRESSION DÉFINITIVE — irréversible. Grâce aux contraintes ON DELETE CASCADE
  // du schéma, supprimer l'intervenant supprime aussi automatiquement : ses dispos,
  // ses ratings, ses liens niveaux, ses commentaires de semaine.
  async deleteIntervenant(id) {
    const { error } = await _client.from('intervenants').delete().eq('id', id);
    if (error) throw error;
  },

  // Régénérer le token (révoque l'ancien lien)
  async regenerateToken(id) {
    const { data, error } = await _client.rpc('generer_token');
    if (error) throw error;
    const { error: e2 } = await _client
      .from('intervenants').update({ token: data, token_actif: true }).eq('id', id);
    if (e2) throw e2;
    return data;
  },

  async setTokenActif(id, actif) {
    const { error } = await _client.from('intervenants').update({ token_actif: actif }).eq('id', id);
    if (error) throw error;
  },

  // Niveaux d'un intervenant (remplace l'ensemble)
  async setIntervenantNiveaux(intervenantId, niveauIds) {
    await _client.from('intervenant_niveaux').delete().eq('intervenant_id', intervenantId);
    if (niveauIds.length) {
      const rows = niveauIds.map(niveau_id => ({ intervenant_id: intervenantId, niveau_id }));
      const { error } = await _client.from('intervenant_niveaux').insert(rows);
      if (error) throw error;
    }
  },

  // Rating d'une matière (upsert ou suppression si note=0)
  async setRating(intervenantId, matiereId, note) {
    if (note === 0) {
      const { error } = await _client.from('intervenant_ratings')
        .delete().eq('intervenant_id', intervenantId).eq('matiere_id', matiereId);
      if (error) throw error;
    } else {
      const { error } = await _client.from('intervenant_ratings')
        .upsert({ intervenant_id: intervenantId, matiere_id: matiereId, note });
      if (error) throw error;
    }
  },

  // ----------------------------------------------------------
  // DISPONIBILITÉS (admin — vue complète)
  // ----------------------------------------------------------
  async getDisposCampagne(campagneId) {
    const { data, error } = await _client
      .from('disponibilites').select('*').eq('campagne_id', campagneId);
    if (error) throw error;
    return data;
  },

  async getDisposIntervenant(intervenantId, campagneId) {
    const { data, error } = await _client
      .from('disponibilites').select('date, periode')
      .eq('intervenant_id', intervenantId).eq('campagne_id', campagneId);
    if (error) throw error;
    return data;
  },

  // Édition manuelle des dispos par l'admin
  async setDisposIntervenant(intervenantId, campagneId, creneaux) {
    await _client.from('disponibilites')
      .delete().eq('intervenant_id', intervenantId).eq('campagne_id', campagneId);
    if (creneaux.length) {
      const rows = creneaux.map(c => ({
        intervenant_id: intervenantId, campagne_id: campagneId, date: c.date, periode: c.periode
      }));
      const { error } = await _client.from('disponibilites').insert(rows);
      if (error) throw error;
    }
  },

  async getCommentairesIntervenant(intervenantId, campagneId) {
    const { data, error } = await _client
      .from('commentaires_semaine').select('*')
      .eq('intervenant_id', intervenantId).eq('campagne_id', campagneId);
    if (error) throw error;
    return data;
  },

  // ----------------------------------------------------------
  // ACCÈS INTERVENANT PAR TOKEN (public, sans login)
  // ----------------------------------------------------------
  async getIntervenantParToken(token) {
    const { data, error } = await _client.rpc('intervenant_par_token', { p_token: token });
    if (error) throw error;
    return (data && data.length) ? data[0] : null;
  },

  async getDisposParToken(token, campagneId) {
    const { data, error } = await _client.rpc('get_dispos_par_token', {
      p_token: token, p_campagne: campagneId
    });
    if (error) throw error;
    return data || [];
  },

  async sauverDisposParToken(token, campagneId, creneaux, statut = 'valide') {
    const { error } = await _client.rpc('sauver_dispos_par_token', {
      p_token: token, p_campagne: campagneId, p_creneaux: creneaux, p_statut: statut
    });
    if (error) throw error;
  },

  async sauverCommentaireParToken(token, campagneId, semaine, commentaire) {
    const { error } = await _client.rpc('sauver_commentaire_par_token', {
      p_token: token, p_campagne: campagneId, p_semaine: semaine, p_commentaire: commentaire
    });
    if (error) throw error;
  },
};
