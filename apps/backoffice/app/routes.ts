import { type RouteConfig, index, layout, route } from '@react-router/dev/routes';

export default [
  layout('routes/shell.tsx', [
    // Pathless, and one level under the shell so a page's failure replaces the page, not the sidebar.
    layout('routes/page-boundary.tsx', [
      index('routes/home.tsx'),
      route('pengaturan', 'routes/settings.tsx'),
      route('outlet', 'routes/outlet.tsx'),
      route('staf', 'routes/staff.tsx'),
    ]),
  ]),
] satisfies RouteConfig;
