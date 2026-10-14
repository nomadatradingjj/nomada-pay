import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import apiRoutes from './routes/api.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public')); // <--- ESTA LÍNEA DEBE ESTAR AQUÍ

app.use('/api', apiRoutes);

app.get('/', (req, res) => {
  res.json({ mensaje: '🚀 Servidor de Pasarela Nómada Activo' });
});

app.listen(PORT, () => {
  console.log(`=================================`);
  console.log(`⚡ Servidor corriendo en puerto ${PORT}`);
  console.log(`👉 http://localhost:${PORT}`);
  console.log(`=================================`);
});