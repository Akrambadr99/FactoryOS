import { useContext } from 'react';
import { AppServicesContext } from './context';
export function useAppServices() {
    const services = useContext(AppServicesContext);
    if (!services)
        throw new Error('App services are unavailable outside AppProviders.');
    return services;
}
