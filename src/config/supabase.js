import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error('Falta configurar SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en el entorno');
}

export const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);