import { createClient } from "@supabase/supabase-js";

// Nota: la "anon/publishable key" de Supabase está diseñada para ser pública —
// la seguridad real vive en las políticas de Row Level Security (RLS) del
// esquema SQL, no en ocultar esta clave. Por eso es seguro tener un respaldo
// directo aquí si las variables de entorno del hosting fallan por algún motivo.
const FALLBACK_SUPABASE_URL = "https://rxbnxusfxlqetfcayybz.supabase.co";
const FALLBACK_SUPABASE_ANON_KEY = "sb_publishable_oBqicY0WR_96JN78JU_miA_wryvJ3pv";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || FALLBACK_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || FALLBACK_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
