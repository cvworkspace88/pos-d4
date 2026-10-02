import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@repo/ui/toast';
import { App } from './app';
import { TRPCProvider, queryClient, trpcClient } from './trpc';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        <Toaster>
          <App />
        </Toaster>
      </TRPCProvider>
    </QueryClientProvider>
  </StrictMode>,
);
