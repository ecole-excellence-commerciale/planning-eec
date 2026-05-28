// ============================================================
// CONFIG — PLANNING EEC
// ============================================================
// C'est le SEUL fichier que tu dois éditer avec tes propres valeurs.
//
// Où trouver ces valeurs :
//   Supabase Dashboard → ton projet → Settings (roue dentée)
//   → API → section "Project URL" et "Project API keys"
//
//   • SUPABASE_URL      = "Project URL"            (ex. https://abcdxyz.supabase.co)
//   • SUPABASE_ANON_KEY = la clé "anon" / "public" (PAS la clé "service_role" !)
//
// ⚠️ IMPORTANT : la clé "anon" est conçue pour être publique (elle vit dans le
//    navigateur). C'est NORMAL et SANS DANGER : la sécurité est assurée par les
//    règles RLS de la base. Ne mets JAMAIS la clé "service_role" ici.
// ============================================================

window.EEC_CONFIG = {
  SUPABASE_URL: "https://jjziycnehtzemfkkovdj.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impqeml5Y25laHR6ZW1ma2tvdmRqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5NTk2MDAsImV4cCI6MjA5NTUzNTYwMH0.uFokJJe5f1hFoGQTVIGtiDOcosvYHkdqfUOJCAv4oJc",

  // Nombre d'heures que dure une journée d'intervention (pour calculer TJM et 1/2 journée)
  HEURES_PAR_JOUR: 7,
};
