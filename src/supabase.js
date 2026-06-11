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
  // RÉFÉRENCES : niveaux & catégories
  // ----------------------------------------------------------
  async getNiveaux() {
    const { data, error } = await _client
      .from('niveaux').select('*').eq('actif', true).order('ordre');
    if (error) throw error;
    return data;
  },

  async getCategories() {
    const { data, error } = await _client
      .from('categories').select('*').eq('actif', true).order('ordre');
    if (error) throw error;
    return data;
  },

  async addNiveau(label, couleur, ordre) {
    const { data, error } = await _client
      .from('niveaux').insert({ label, couleur, ordre }).select().single();
    if (error) throw error;
    return data;
  },

  async addCategorie(label, ordre) {
    const { data, error } = await _client
      .from('categories').insert({ label, ordre }).select().single();
    if (error) throw error;
    return data;
  },

  // Renommer une catégorie (édition inline)
  async renameCategorie(id, label) {
    const { error } = await _client
      .from('categories').update({ label }).eq('id', id);
    if (error) throw error;
  },

  // Suppression DÉFINITIVE d'une catégorie : cascade automatique sur les
  // sous-catégories (ON DELETE CASCADE), qui cascadent à leur tour sur les
  // intervenant_ratings (sous_categorie_id ON DELETE CASCADE). Les modules
  // gardent leur categorie_id à null (ON DELETE SET NULL).
  async deleteCategorie(id) {
    const { error } = await _client.from('categories').delete().eq('id', id);
    if (error) throw error;
  },

  async deactivateNiveau(id) {
    const { error } = await _client.from('niveaux').update({ actif: false }).eq('id', id);
    if (error) throw error;
  },

  async deactivateCategorie(id) {
    const { error } = await _client.from('categories').update({ actif: false }).eq('id', id);
    if (error) throw error;
  },

  // ----------------------------------------------------------
  // SOUS-CATÉGORIES (niveau intermédiaire entre catégorie et module)
  // ----------------------------------------------------------
  async getSousCategories() {
    const { data, error } = await _client
      .from('sous_categories').select('*').eq('actif', true).order('ordre');
    if (error) throw error;
    return data;
  },

  async addSousCategorie(categorieId, label, ordre) {
    const { data, error } = await _client
      .from('sous_categories').insert({ categorie_id: categorieId, label, ordre })
      .select().single();
    if (error) throw error;
    return data;
  },

  async renameSousCategorie(id, label) {
    const { error } = await _client
      .from('sous_categories').update({ label }).eq('id', id);
    if (error) throw error;
  },

  // Suppression DÉFINITIVE d'une sous-catégorie. Les modules associés sont
  // déplacés vers la sous-catégorie "Général" de la même catégorie (sécurité),
  // ou sous_categorie_id devient NULL s'il n'y a pas de "Général".
  async deleteSousCategorie(id) {
    // 1. Récupérer la catégorie parente
    const { data: sub } = await _client
      .from('sous_categories').select('categorie_id, label').eq('id', id).single();
    if (!sub) throw new Error('Sous-catégorie introuvable');
    // 2. Trouver la sous-cat "Général" de la même catégorie (autre que celle qu'on supprime)
    const { data: general } = await _client
      .from('sous_categories').select('id')
      .eq('categorie_id', sub.categorie_id)
      .eq('label', 'Général')
      .neq('id', id)
      .maybeSingle();
    // 3. Déplacer les modules vers "Général" si elle existe, sinon les laisser null
    await _client.from('modules')
      .update({ sous_categorie_id: general?.id || null })
      .eq('sous_categorie_id', id);
    // 4. Supprimer la sous-catégorie (cascade aussi sur intervenant_ratings)
    const { error } = await _client.from('sous_categories').delete().eq('id', id);
    if (error) throw error;
  },

  // Déplacer un module vers une autre sous-catégorie. La catégorie est mise
  // à jour automatiquement (cohérence : la catégorie du module = celle de sa sous-cat).
  async setModuleSousCategorie(moduleId, sousCategorieId) {
    if (!sousCategorieId) {
      const { error } = await _client.from('modules')
        .update({ sous_categorie_id: null }).eq('id', moduleId);
      if (error) throw error;
      return;
    }
    // Récupérer la catégorie de la sous-cat cible
    const { data: sub } = await _client
      .from('sous_categories').select('categorie_id').eq('id', sousCategorieId).single();
    if (!sub) throw new Error('Sous-catégorie introuvable');
    const { error } = await _client.from('modules')
      .update({ sous_categorie_id: sousCategorieId, categorie_id: sub.categorie_id })
      .eq('id', moduleId);
    if (error) throw error;
  },

  // ----------------------------------------------------------
  // MODULES (rattachés à une catégorie)
  // ----------------------------------------------------------
  async getModules() {
    const { data, error } = await _client
      .from('modules').select('*').eq('actif', true).order('ordre');
    if (error) throw error;
    return data;
  },

  async addModule(categorieId, label, ordre, sousCategorieId = null) {
    // Si pas de sous-catégorie spécifiée, prendre la "Général" de la catégorie
    let scId = sousCategorieId;
    if (!scId) {
      const { data } = await _client.from('sous_categories').select('id')
        .eq('categorie_id', categorieId).eq('label', 'Général').maybeSingle();
      scId = data?.id || null;
    }
    const { data, error } = await _client
      .from('modules').insert({
        categorie_id: categorieId,
        sous_categorie_id: scId,
        label, ordre,
      })
      .select().single();
    if (error) throw error;
    return data;
  },

  async renameModule(id, label) {
    const { error } = await _client
      .from('modules').update({ label }).eq('id', id);
    if (error) throw error;
  },

  // Suppression DÉFINITIVE d'un module : cascade automatique sur les créneaux
  // du programme (programme_creneaux.module_id) → SET NULL, donc pas de perte
  // de structure. Les éventuels promo_planning sont aussi mis à jour à NULL.
  async deleteModule(id) {
    const { error } = await _client.from('modules').delete().eq('id', id);
    if (error) throw error;
  },

  // Compteur : nombre d'intervenants ayant au moins une note dans cette catégorie
  // (toutes sous-catégories confondues)
  async countIntervenantsParCategorie() {
    const { data: ratings, error } = await _client
      .from('intervenant_ratings').select('sous_categorie_id, intervenant_id');
    if (error) throw error;
    // Charger les sous-cat pour faire le lien sous_categorie_id → categorie_id
    const { data: subs } = await _client
      .from('sous_categories').select('id, categorie_id');
    const catBySub = Object.fromEntries((subs || []).map(s => [s.id, s.categorie_id]));
    // Compter les intervenants distincts par catégorie
    const map = {};
    for (const r of (ratings || [])) {
      const catId = catBySub[r.sous_categorie_id];
      if (!catId) continue;
      if (!map[catId]) map[catId] = new Set();
      map[catId].add(r.intervenant_id);
    }
    return Object.fromEntries(
      Object.entries(map).map(([k, v]) => [k, v.size])
    );
  },

  // ----------------------------------------------------------
  // PROGRAMMES-TYPES & créneaux pédagogiques
  // ----------------------------------------------------------
  async getProgrammesTypes() {
    const { data, error } = await _client
      .from('programmes_types').select('*').order('label');
    if (error) throw error;
    return data;
  },

  // Récupère tous les créneaux d'un programme-type (jusqu'à 250 lignes max pour le Bac+2)
  async getProgrammeCreneaux(programmeTypeId) {
    const { data, error } = await _client
      .from('programme_creneaux')
      .select('*')
      .eq('programme_type_id', programmeTypeId)
      .order('semaine_num').order('jour').order('periode');
    if (error) throw error;
    return data;
  },

  // Créer un nouveau programme-type pour un niveau (utilisé quand on bascule
  // vers Mastère/Bootcamp qui n'ont pas encore de programme)
  async addProgrammeType(niveauId, label, nombreSemaines = 25) {
    const { data, error } = await _client
      .from('programmes_types')
      .insert({ niveau_id: niveauId, label, nombre_semaines: nombreSemaines })
      .select().single();
    if (error) throw error;
    return data;
  },

  // Met à jour le module assigné à un créneau (passe null pour vider)
  async setCreneauModule(creneauId, moduleId) {
    const { error } = await _client
      .from('programme_creneaux')
      .update({ module_id: moduleId })
      .eq('id', creneauId);
    if (error) throw error;
  },

  // Créer un créneau (si n'existe pas pour cette semaine/jour/période)
  async addCreneau(programmeTypeId, semaineNum, jour, periode, moduleId = null) {
    const { data, error } = await _client
      .from('programme_creneaux')
      .insert({
        programme_type_id: programmeTypeId,
        semaine_num: semaineNum, jour, periode, module_id: moduleId
      })
      .select().single();
    if (error) throw error;
    return data;
  },

  // Supprimer un créneau (efface complètement la case du programme)
  async deleteCreneau(creneauId) {
    const { error } = await _client
      .from('programme_creneaux').delete().eq('id', creneauId);
    if (error) throw error;
  },

  // ─────────────────────────────────────────────────────────────────────
  // Ajouter une semaine à un programme-type ET propager aux promos
  // ─────────────────────────────────────────────────────────────────────
  // Action NON-DESTRUCTIVE :
  //   • Aucune entrée existante du planning des promos n'est modifiée
  //   • Aucun module ou intervenant déjà assigné n'est touché
  //   • Pour les promos actives utilisant ce programme :
  //       - on calcule le lundi de la nouvelle semaine (juste après la dernière
  //         semaine présente dans leur planning)
  //       - on crée 10 entrées vierges (5 jours × 2 périodes, module_id null)
  //         pour qu'elles apparaissent dans l'écran Planning
  //       - on étend la date_fin de la promo de 7 jours
  async addWeekToProgramme(programmeTypeId) {
    // 1. Charger le programme-type
    const { data: pt, error: ePT } = await _client
      .from('programmes_types').select('*')
      .eq('id', programmeTypeId).single();
    if (ePT) throw ePT;

    const nouvelleSemaineNum = (pt.nombre_semaines || 0) + 1;

    // 2. Mettre à jour le nombre_semaines du programme-type
    const { error: e1 } = await _client.from('programmes_types')
      .update({ nombre_semaines: nouvelleSemaineNum })
      .eq('id', programmeTypeId);
    if (e1) throw e1;

    // 3. Pour chaque promo active utilisant ce programme-type, étendre son planning
    const { data: promosUsantPT } = await _client
      .from('promos').select('id, date_debut, date_fin')
      .eq('programme_type_id', programmeTypeId)
      .eq('actif', true);

    let totalPromos = 0;
    for (const promo of (promosUsantPT || [])) {
      // Charger la dernière semaine présente dans le planning
      const { data: derniereEntry } = await _client
        .from('promo_planning')
        .select('semaine_num, date_jour')
        .eq('promo_id', promo.id)
        .order('semaine_num', { ascending: false })
        .limit(1)
        .maybeSingle();

      // Si la promo n'a pas encore de planning, on ne fait rien (sera généré plus tard)
      if (!derniereEntry) continue;

      // Trouver le lundi de la dernière semaine déjà présente
      const { data: derniereSemaineEntries } = await _client
        .from('promo_planning')
        .select('date_jour')
        .eq('promo_id', promo.id)
        .eq('semaine_num', derniereEntry.semaine_num)
        .order('date_jour');
      const dernierLundi = derniereSemaineEntries?.[0]?.date_jour;
      if (!dernierLundi) continue;

      // Lundi de la nouvelle semaine = dernierLundi + 7 jours
      const nouveauLundi = new Date(dernierLundi + 'T00:00:00');
      nouveauLundi.setDate(nouveauLundi.getDate() + 7);
      const nouveauVendredi = new Date(nouveauLundi); nouveauVendredi.setDate(nouveauVendredi.getDate() + 4);

      // Créer 10 entrées vierges (5 jours × 2 périodes) avec semaine_num = nouvelleSemaineNum
      // ⚠ isoDate() est utilisé pour éviter le décalage UTC qui surviendrait avec
      // toISOString() (heure locale → UTC inverse la date d'un jour en zone UTC+).
      const rows = [];
      for (let j = 0; j < 5; j++) {
        const date = new Date(nouveauLundi); date.setDate(date.getDate() + j);
        const dateISO = isoDate(date);
        for (const periode of ['am', 'pm']) {
          rows.push({
            promo_id: promo.id,
            semaine_num: nouvelleSemaineNum,
            date_jour: dateISO,
            periode,
            module_id: null,
            intervenant_id: null,
          });
        }
      }
      await _client.from('promo_planning').insert(rows);

      // Étendre la date_fin de la promo
      await _client.from('promos')
        .update({ date_fin: isoDate(nouveauVendredi) })
        .eq('id', promo.id);

      totalPromos++;
    }

    return { nouvelleSemaineNum, promosEtendues: totalPromos };
  },

  // ----------------------------------------------------------
  // PROMOS (instances concrètes d'un programme-type)
  // ----------------------------------------------------------
  async getPromos() {
    const { data, error } = await _client
      .from('promos').select('*').eq('actif', true).order('date_debut');
    if (error) throw error;
    return data;
  },

  async getPromo(id) {
    const { data, error } = await _client
      .from('promos').select('*').eq('id', id).single();
    if (error) throw error;
    return data;
  },

  // Créer une promo et lui dérouler le programme-type sur ses semaines de cours
  // semaines : tableau de dates ISO (lundis) ordonné. La 1ère devient la semaine pédagogique #1, etc.
  async addPromo({ niveauId, programmeTypeId, label, dateDebut, semaines }) {
    const dateFin = semaines.length > 0
      ? isoDate(new Date(new Date(semaines[semaines.length - 1]).getTime() + 4 * 86400000))
      : dateDebut;

    // Créer la promo
    const { data: promo, error } = await _client
      .from('promos').insert({
        niveau_id: niveauId,
        programme_type_id: programmeTypeId,
        label, date_debut: dateDebut, date_fin: dateFin
      }).select().single();
    if (error) throw error;

    // Charger les créneaux du programme-type
    const { data: programmeCreneaux } = await _client
      .from('programme_creneaux')
      .select('semaine_num, jour, periode, module_id')
      .eq('programme_type_id', programmeTypeId);

    // Dérouler : pour chaque créneau du programme-type, créer une ligne dans promo_planning
    // avec la date réelle correspondant à sa semaine pédagogique
    const rows = [];
    for (const pc of (programmeCreneaux || [])) {
      const lundiISO = semaines[pc.semaine_num - 1];
      if (!lundiISO) continue; // si la semaine pédagogique dépasse le nb de semaines de la promo
      const lundi = new Date(lundiISO);
      const date_jour = isoDate(new Date(lundi.getTime() + (pc.jour - 1) * 86400000));
      rows.push({
        promo_id: promo.id,
        semaine_num: pc.semaine_num,
        date_jour, periode: pc.periode,
        module_id: pc.module_id,
      });
    }
    if (rows.length) {
      const { error: e2 } = await _client.from('promo_planning').insert(rows);
      if (e2) throw e2;
    }
    return promo;
  },

  // Mettre à jour le calendrier d'une promo (regénère intégralement son planning)
  async updatePromoCalendrier(promoId, programmeTypeId, semaines) {
    // Supprimer l'ancien planning
    await _client.from('promo_planning').delete().eq('promo_id', promoId);
    // Mettre à jour les dates de la promo
    const dateDebut = semaines.length > 0 ? semaines[0] : null;
    const dateFin = semaines.length > 0
      ? isoDate(new Date(new Date(semaines[semaines.length - 1]).getTime() + 4 * 86400000))
      : null;
    await _client.from('promos').update({ date_debut: dateDebut, date_fin: dateFin }).eq('id', promoId);
    // Recharger les créneaux du programme-type
    const { data: programmeCreneaux } = await _client
      .from('programme_creneaux')
      .select('semaine_num, jour, periode, module_id')
      .eq('programme_type_id', programmeTypeId);
    // Re-dérouler
    const rows = [];
    for (const pc of (programmeCreneaux || [])) {
      const lundiISO = semaines[pc.semaine_num - 1];
      if (!lundiISO) continue;
      const lundi = new Date(lundiISO);
      const date_jour = isoDate(new Date(lundi.getTime() + (pc.jour - 1) * 86400000));
      rows.push({
        promo_id: promoId,
        semaine_num: pc.semaine_num,
        date_jour, periode: pc.periode,
        module_id: pc.module_id,
      });
    }
    if (rows.length) {
      const { error } = await _client.from('promo_planning').insert(rows);
      if (error) throw error;
    }
  },

  // Renommer une promo
  async renamePromo(id, label) {
    const { error } = await _client.from('promos').update({ label }).eq('id', id);
    if (error) throw error;
  },

  // Archiver une promo
  async archivePromo(id) {
    const { error } = await _client.from('promos').update({ actif: false }).eq('id', id);
    if (error) throw error;
  },

  // Suppression définitive d'une promo (cascade sur promo_planning)
  async deletePromo(id) {
    const { error } = await _client.from('promos').delete().eq('id', id);
    if (error) throw error;
  },

  // Récupérer le planning concret d'une promo (les dates réelles)
  // Retourne une liste : { date_jour, periode, semaine_num, module_id }
  async getPromoPlanning(promoId) {
    const { data, error } = await _client
      .from('promo_planning')
      .select('id, date_jour, periode, semaine_num, module_id, intervenant_id, notes')
      .eq('promo_id', promoId)
      .order('date_jour').order('periode');
    if (error) throw error;
    return data || [];
  },

  // Modifier le module d'un créneau de promo (NE modifie PAS le programme-type)
  // Cette modification est locale à la promo : utilisée quand on veut ajuster
  // le planning d'une promo spécifique sans changer le modèle global.
  async setPromoPlanningModule(planningId, moduleId) {
    const { error } = await _client
      .from('promo_planning')
      .update({ module_id: moduleId })
      .eq('id', planningId);
    if (error) throw error;
  },

  // Créer une nouvelle entrée dans le planning d'une promo (= ajouter un créneau
  // qui n'existait pas dans le programme-type initial). Utilisé quand on remplit
  // une case "Pas de cours" depuis l'écran Planning.
  // Créer ou mettre à jour une entrée de planning pour un créneau donné.
  // Utilise UPSERT atomique sur la contrainte unique (promo_id, date_jour, periode)
  // pour rester safe avec les appels concurrents (Promise.all en bulk).
  // L'intervenant_id existant est préservé (non écrasé) car non spécifié dans le payload.
  async addPromoPlanningEntry(promoId, semaineNum, dateJour, periode, moduleId) {
    const { data, error } = await _client
      .from('promo_planning')
      .upsert(
        {
          promo_id: promoId,
          semaine_num: semaineNum,
          date_jour: dateJour,
          periode,
          module_id: moduleId,
        },
        { onConflict: 'promo_id,date_jour,periode' }
      )
      .select().single();
    if (error) throw error;
    return data;
  },

  // Assigner un intervenant à un créneau (ou retirer si null)
  async setPromoPlanningIntervenant(planningId, intervenantId) {
    const { error } = await _client
      .from('promo_planning')
      .update({ intervenant_id: intervenantId })
      .eq('id', planningId);
    if (error) throw error;
  },

  // Récupérer TOUTES les assignations d'un intervenant (toutes promos confondues)
  // Utilisé pour la vue "Mes interventions planifiées" dans la fiche intervenant.
  async getAllAssignationsIntervenant(intervenantId) {
    const { data, error } = await _client
      .from('promo_planning')
      .select('id, promo_id, semaine_num, date_jour, periode, module_id')
      .eq('intervenant_id', intervenantId)
      .order('date_jour');
    if (error) throw error;
    return data || [];
  },

  // Récupérer toutes les assignations d'un intervenant à une date/période donnée
  // (utilisé pour détecter les conflits entre promos)
  async getAssignationsIntervenant(intervenantId, dateJour, periode) {
    const { data, error } = await _client
      .from('promo_planning')
      .select('id, promo_id, semaine_num, date_jour, periode, module_id')
      .eq('intervenant_id', intervenantId)
      .eq('date_jour', dateJour)
      .eq('periode', periode);
    if (error) throw error;
    return data || [];
  },

  // Pour une période donnée, retourner tous les créneaux qui ont un intervenant
  // assigné. Utilisé pour détecter en bloc les conflits sur l'écran Planning.
  async getAssignationsPeriode(dateDebut, dateFin) {
    const { data, error } = await _client
      .from('promo_planning')
      .select('id, promo_id, intervenant_id, date_jour, periode')
      .gte('date_jour', dateDebut)
      .lte('date_jour', dateFin)
      .not('intervenant_id', 'is', null);
    if (error) throw error;
    return data || [];
  },

  // Déduire les semaines d'une promo depuis son planning (= dates uniques des lundis)
  async getPromoSemaines(promoId) {
    const planning = await this.getPromoPlanning(promoId);
    // Regrouper par semaine pédagogique
    const map = {};
    for (const p of planning) {
      if (!map[p.semaine_num]) {
        // Calculer le lundi de la date_jour (en heure locale pour éviter les
        // décalages de fuseau horaire)
        const d = new Date(p.date_jour + 'T00:00:00');
        const dow = d.getDay() === 0 ? 7 : d.getDay();
        const lundi = new Date(d.getTime() - (dow - 1) * 86400000);
        map[p.semaine_num] = isoDate(lundi);
      }
    }
    // Retourner tableau ordonné [lundi_semaine_1, lundi_semaine_2, ...]
    return Object.keys(map).sort((a, b) => parseInt(a) - parseInt(b)).map(k => map[k]);
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
      // Ratings indexés par sous_categorie_id (la note est maintenant attachée
      // à une sous-catégorie, pas à une catégorie)
      ratings: Object.fromEntries(
        (ratings || [])
          .filter(r => r.intervenant_id === i.id && r.sous_categorie_id)
          .map(r => [r.sous_categorie_id, r.note])
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
      ratings: Object.fromEntries(
        (ratings || [])
          .filter(r => r.sous_categorie_id)
          .map(r => [r.sous_categorie_id, r.note])
      ),
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

  // Rating d'une sous-catégorie (upsert ou suppression si note=0)
  async setRating(intervenantId, sousCategorieId, note) {
    if (note === 0) {
      const { error } = await _client.from('intervenant_ratings')
        .delete()
        .eq('intervenant_id', intervenantId)
        .eq('sous_categorie_id', sousCategorieId);
      if (error) throw error;
    } else {
      const { error } = await _client.from('intervenant_ratings')
        .upsert(
          { intervenant_id: intervenantId, sous_categorie_id: sousCategorieId, note },
          { onConflict: 'intervenant_id,sous_categorie_id' }
        );
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
