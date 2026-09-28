import { useState, type ReactNode } from 'react';
import { parseRupiah, type RouterOutputs } from '@repo/api-contract';
import { Button } from '@repo/ui/button';
import { Dialog } from '@repo/ui/dialog';
import { Drawer } from '@repo/ui/drawer';
import { RadioGroup } from '@repo/ui/radio';
import { Select, type SelectItem } from '@repo/ui/select';
import { Switch } from '@repo/ui/switch';
import { TextField } from '@repo/ui/text-field';

export type MenuItem = RouterOutputs['menu']['list'][number];
type Tax = MenuItem['tax'];
export type MenuItemFields = Omit<MenuItem, 'id' | 'categoryName'>;

const TAXES: { value: Tax; label: string }[] = [
  { value: 'pbjt', label: 'PBJT' },
  { value: 'ppn', label: 'PPN' },
  { value: 'none', label: 'Tidak ada pajak' },
];

type Draft = { name: string; categoryId: string; price: string; cost: string; tax: Tax; available: boolean };

const toDraft = (target: MenuItem | 'new', categories: SelectItem[]): Draft =>
  target === 'new'
    ? { name: '', categoryId: categories[0]?.value ?? '', price: '', cost: '', tax: 'pbjt', available: true }
    : {
        name: target.name,
        categoryId: target.categoryId,
        price: String(target.price),
        cost: target.cost === null ? '' : String(target.cost),
        tax: target.tax,
        available: target.available,
      };

interface MenuItemDrawerProps {
  /** `null` closed, `'new'` adding, an item editing it. */
  target: MenuItem | 'new' | null;
  categories: SelectItem[];
  onSave: (fields: MenuItemFields) => void;
  onClose: () => void;
  /** The save is in flight: every way out is refused until it settles. */
  saving?: boolean;
  /** The last save's refusal, shown above the buttons. */
  error?: string;
  /** Current rates in basis points, shown beside each tax. Left off while unknown. */
  rates?: { pbjt?: number; ppn?: number };
}

/** Add or edit one menu item. Asks before throwing away unsaved changes, however it is closed. */
export function MenuItemDrawer({
  target,
  categories,
  onSave,
  onClose,
  saving,
  error,
  rates,
}: MenuItemDrawerProps) {
  const [draft, setDraft] = useState<Draft>(() => toDraft('new', categories));
  // What the drawer opened with, so closing can tell whether anything would be lost.
  const [initial, setInitial] = useState<Draft>(draft);
  const [isNew, setIsNew] = useState(true);
  const [discarding, setDiscarding] = useState(false);

  // Reset on open, during render rather than in an effect. Closing leaves the draft and title alone
  // so the exit animation still shows the form it had.
  const [openedFor, setOpenedFor] = useState(target);
  if (target !== openedFor) {
    setOpenedFor(target);
    if (target) {
      const start = toDraft(target, categories);
      setDraft(start);
      setInitial(start);
      setIsNew(target === 'new');
    }
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  // Every way out of the drawer — Batal, X, Esc, outside press, swipe — comes through here.
  const requestClose = () => (dirty ? setDiscarding(true) : onClose());

  const price = parseRupiah(draft.price);
  const cost = parseRupiah(draft.cost);
  // Mirrors menu.router.ts's bounds (0 allowed: a free item is a real item); the server still validates.
  const valid = draft.name.trim() && draft.categoryId && price.value !== null && !cost.error;

  const save = () => {
    if (!valid) return;
    onSave({
      name: draft.name.trim(),
      categoryId: draft.categoryId,
      price: price.value!,
      cost: cost.value,
      tax: draft.tax,
      available: draft.available,
    });
  };

  return (
    <Drawer
      open={!!target}
      onClose={requestClose}
      blocking={saving}
      title={isNew ? 'Tambah menu' : `Ubah: ${initial.name}`}
      footer={
        <div className="flex w-full flex-col gap-3">
          {error && <p className="text-sm text-danger">{error}</p>}
          <div className="flex gap-3">
            <Button className="flex-1" loading={saving} disabled={!valid || !dirty} onClick={save}>
              Simpan
            </Button>
            <Button variant="outline" className="flex-1" onClick={requestClose} disabled={saving}>
              Batal
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-8">
        <Section title="Info dasar">
          <TextField
            label="Nama"
            maxLength={60}
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
          <Select
            label="Kategori"
            items={categories}
            value={draft.categoryId}
            onValueChange={(categoryId) => setDraft({ ...draft, categoryId })}
            placeholder="Pilih kategori"
            error={categories.length ? undefined : 'Belum ada kategori. Tambahkan di halaman Kategori.'}
          />
        </Section>

        <Section title="Harga & pajak">
          <div className="grid grid-cols-2 gap-3">
            <TextField
              label="Harga jual"
              inputMode="numeric"
              adornment={<span className="text-sm text-ink-tertiary">Rp</span>}
              value={draft.price}
              error={price.error}
              onChange={(e) => setDraft({ ...draft, price: e.target.value })}
            />
            <TextField
              label="Harga modal"
              helperText="Opsional"
              error={cost.error}
              inputMode="numeric"
              adornment={<span className="text-sm text-ink-tertiary">Rp</span>}
              value={draft.cost}
              onChange={(e) => setDraft({ ...draft, cost: e.target.value })}
            />
          </div>
          <RadioGroup
            label="Jenis pajak"
            items={TAXES.map((t) => {
              const bp = t.value === 'none' ? undefined : rates?.[t.value];
              return bp === undefined
                ? t
                : { ...t, label: `${t.label} (${(bp / 100).toLocaleString('id-ID')}%)` };
            })}
            value={draft.tax}
            onValueChange={(tax) => setDraft({ ...draft, tax: tax as Tax })}
          />
        </Section>

        <Section title="Ketersediaan">
          <label className="flex items-center justify-between gap-4 text-sm">
            <span>
              <span className="block font-medium text-ink-primary">Tersedia di kasir</span>
              <span className="text-ink-tertiary">Matikan saat menu habis.</span>
            </span>
            <Switch
              checked={draft.available}
              onCheckedChange={(available) => setDraft({ ...draft, available })}
            />
          </label>
        </Section>
      </div>

      {/* Inside the drawer's tree, so Base UI treats it as nested: pressing it is not an outside
          press that would close the drawer underneath. */}
      <Dialog
        open={discarding}
        onClose={() => setDiscarding(false)}
        closeButton={false}
        title="Buang perubahan?"
        footer={
          <div className="flex w-full gap-3">
            <Button
              variant="danger"
              className="flex-1"
              onClick={() => {
                setDiscarding(false);
                onClose();
              }}
            >
              Buang
            </Button>
            <Button variant="outline" className="flex-1" onClick={() => setDiscarding(false)}>
              Lanjut mengubah
            </Button>
          </div>
        }
      >
        <p className="text-sm text-ink-secondary">Perubahan pada menu ini belum disimpan.</p>
      </Dialog>
    </Drawer>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-tertiary">{title}</h3>
      {children}
    </section>
  );
}
