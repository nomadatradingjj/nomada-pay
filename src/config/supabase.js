import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('⚠️ Falta configurar SUPABASE_URL o SUPABASE_KEY en el .env');
}

export const supabase = createClient(supabaseUrl, supabaseKey);