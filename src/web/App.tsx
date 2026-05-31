import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Login from './features/auth/Login';
import RecuperarSenha from './features/auth/RecuperarSenha';
import Cadastro from './features/auth/Cadastro';
import Convite from './features/auth/Convite';
import ChangePassword from './features/auth/ChangePassword';
import AppLayout from './features/AppLayout';
import Home from './features/home/Home';
import Conteudo from './features/student/Conteudo';
import { RequireAuth } from './routes/RequireAuth';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Públicas */}
        <Route path="/login" element={<Login />} />
        <Route path="/recuperar-senha" element={<RecuperarSenha />} />
        <Route path="/cadastro" element={<Cadastro />} />
        <Route path="/convite/:token" element={<Convite />} />

        {/* Autenticadas (cada papel renderiza seu próprio shell em Home) */}
        <Route
          element={
            <RequireAuth>
              <AppLayout />
            </RequireAuth>
          }
        >
          <Route path="/" element={<Home />} />
          <Route path="/conteudo" element={<Conteudo />} />
          <Route path="/trocar-senha" element={<ChangePassword />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
