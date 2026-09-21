import { Navigate } from 'react-router';

/** No dashboard yet; the first real page is the landing page. */
export default function Home() {
  return <Navigate to="/pengaturan" replace />;
}
