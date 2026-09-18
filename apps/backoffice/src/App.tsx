import { Button } from '@repo/ui/button';
import { Card } from '@repo/ui/card';

export default function App() {
  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <Card className="flex w-full max-w-sm flex-col gap-4">
        <h1 className="text-lg font-semibold text-ink-primary">Backoffice</h1>
        <p className="text-sm text-ink-secondary">
          Shares <code>@repo/ui</code> and the brand palette with desktop.
        </p>
        <Button>Continue</Button>
      </Card>
    </main>
  );
}
