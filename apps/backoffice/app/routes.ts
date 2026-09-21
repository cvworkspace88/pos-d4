import { type RouteConfig, index, layout, route } from '@react-router/dev/routes';

export default [
  layout('routes/shell.tsx', [
    index('routes/home.tsx'),
    route('pengaturan', 'routes/settings.tsx'),
    route('outlet', 'routes/outlet.tsx'),
  ]),
] satisfies RouteConfig;
