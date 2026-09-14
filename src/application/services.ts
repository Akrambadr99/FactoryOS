import { QueryClient } from '@tanstack/react-query';
import { LocalWorkspaceGateway } from '../data/gateway';
import { product } from '../product/definition';
import { Repository } from '../workspace/repository';
export interface AppServices {
    product: typeof product;
    repository: Repository;
    gateway: LocalWorkspaceGateway;
    queryClient: QueryClient;
}
export function createServices(storage: Storage): AppServices { return { product, repository: new Repository(product, storage), gateway: new LocalWorkspaceGateway(product, storage), queryClient: new QueryClient({ defaultOptions: { queries: { staleTime: 30000, retry: false }, mutations: { retry: false } } }) }; }
