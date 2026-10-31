import { createClient } from '@supabase/supabase-js';

export const iniciarSesionDashboard = async (req, res) => {
  const { email, password } = req.body || {};
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    console.error('Falta configurar SUPABASE_URL o SUPABASE_ANON_KEY para el login del dashboard');
    return res.status(503).json({ error: 'El inicio de sesión no está configurado' });
  }

  if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
    return res.status(400).json({ error: 'Email y contraseña son obligatorios' });
  }

  try {
    const authClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await authClient.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (error || !data.session || !data.user) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    return res.json({
      access_token: data.session.access_token,
      cliente_id: data.user.app_metadata?.cliente_id || data.user.app_metadata?.tienda_id || data.user.id,
      email: data.user.email,
    });
  } catch (error) {
    console.error('Error al iniciar sesión en el dashboard:', error);
    return res.status(500).json({ error: 'No se pudo iniciar sesión' });
  }
};
