import { QueryClientProvider } from '@tanstack/react-query';
import { useMemo, type ReactNode } from 'react';
import { AppServicesContext } from './context';
import { createServices } from './services';
export function AppProviders({ children }: {
    children: ReactNode;
}) { const services = useMemo(() => createServices(window.localStorage), []); return <AppServicesContext.Provider value={services}><QueryClientProvider client={services.queryClient}>{children}</QueryClientProvider></AppServicesContext.Provider>; }
