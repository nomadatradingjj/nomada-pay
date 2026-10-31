import { supabase } from '../config/supabase.js';

export const requireDashboardAuth = async (req, res, next) => {
  const authorization = req.headers.authorization || '';
  const [scheme, accessToken] = authorization.split(' ');

  if (scheme !== 'Bearer' || !accessToken) {
    return res.status(401).json({ error: 'Se requiere una sesión del dashboard' });
  }

  try {
    const { data, error } = await supabase.auth.getUser(accessToken);
    if (error || !data.user) {
      return res.status(401).json({ error: 'La sesión del dashboard no es válida o expiró' });
    }

    req.user = {
      ...data.user,
      cliente_id: data.user.app_metadata?.cliente_id,
      tienda_id: data.user.app_metadata?.tienda_id || data.user.id,
    };
    req.dashboardUser = data.user;
    req.clienteId = req.user.cliente_id || req.user.tienda_id || 'default';
    return next();
  } catch (error) {
    console.error('Error al validar la sesión del dashboard:', error);
    return res.status(500).json({ error: 'No se pudo validar la sesión' });
  }
};

export const validarAlcanceCliente = (req, res, next) => {
  const clienteSolicitado = req.params.clienteId || req.body?.cliente_id || req.query.cliente_id;
  if (clienteSolicitado && clienteSolicitado !== req.clienteId) {
    return res.status(403).json({ error: 'No tienes acceso a los datos de este cliente' });
  }
  return next();
};
