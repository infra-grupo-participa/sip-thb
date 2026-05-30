import { useEffect } from 'react';
import type { ReactNode } from 'react';
import type { SessionUser } from '../lib/auth';

// theme-aurum / theme-diamante derivado de ciclo_type (doc 08 §4A.4).
export function ThemeProvider({
  user,
  children,
}: {
  user: SessionUser | null;
  children: ReactNode;
}) {
  useEffect(() => {
    const cls =
      user?.ciclo_type === 'aurum'
        ? 'theme-aurum'
        : user?.ciclo_type === 'seminario'
          ? 'theme-diamante'
          : '';
    document.body.className = cls;
  }, [user?.ciclo_type]);
  return <>{children}</>;
}
