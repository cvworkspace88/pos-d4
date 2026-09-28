import { Plus, Search, Trash2 } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { describeRule, parseRupiah, type RouterInputs, type RouterOutputs } from '@repo/api-contract';
import { Button } from '@repo/ui/button';
import { Checkbox } from '@repo/ui/checkbox';
import { Dialog } from '@repo/ui/dialog';
import { Drawer } from '@repo/ui/drawer';
import { RadioGroup } from '@repo/ui/radio';
import { Select, type SelectItem } from '@repo/ui/select';
import { Switch } from '@repo/ui/switch';
import { TextField } from '@repo/ui/text-field';

export type MenuItem = RouterOutputs['menu']['list'][number];
export type MenuItemFields = RouterInputs['menu']['create'];
export type AddonGroup = RouterOutputs['addon']['list'][number];
type Tax = MenuItem['tax'];

const TAXES: { value: Tax; label: string }[] = [
  { value: 'pbjt', label: 'PBJT' },
  { value: 'ppn', label: 'PPN' },
  { value: 'none', label: 'Tidak ada pajak' },
];

type VariantDraft = { id?: string; name: string; price: string; cost: string; available: boolean };
type Draft = {
  code: string;
  name: string;
  categoryId: string;
  price: string;
  cost: string;
  tax: Tax;
  available: boolean;
  variants: VariantDraft[];
  addonGroupIds: string[];
};

const blankVariant = (): VariantDraft => ({ name: '', price: '', cost: '', available: true });
const money = (n: number | null) => (n === null ? '' : String(n));

const toDraft = (target: MenuItem | 'new', categories: SelectItem[]): Draft =>
  target === 'new'
    ? {
        code: '',
        name: '',
        categoryId: categories[0]?.value ?? '',
        price: '',
        cost: '',
        tax: 'pbjt',
        available: true,
        variants: [],
        addonGroupIds: [],
      }
    : {
        code: target.code ?? '',
        name: target.name,
        categoryId: target.categoryId,
        // With variants the item price is derived; the plain fields start empty if switched back.
        price: target.variants.length ? '' : String(target.price),
        cost: target.variants.length ? '' : money(target.cost),
        tax: target.tax,
        available: target.available,
        variants: target.variants.map((v) => ({
          id: v.id,
          name: v.name,
          price: String(v.price),
          cost: money(v.cost),
          available: v.available,
        })),
        addonGroupIds: target.addonGroupIds,
      };

interface MenuItemDrawerProps {
  /** `null` closed, `'new'` adding, an item editing it. */
  target: MenuItem | 'new' | null;
  categories: SelectItem[];
  /** The outlet's add-on groups, offered as checkboxes. */
  addonGroups: AddonGroup[];
  /** True while addonGroups' first fetch is in flight, so the empty state isn't shown too early. */
  addonGroupsLoading?: boolean;
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
  addonGroups,
  addonGroupsLoading,
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
  const [addonQuery, setAddonQuery] = useState('');

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
      setAddonQuery('');
    }
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);

  // Ticked groups stay listed whatever the query, so a linked add-on is never hidden from view.
  const q = addonQuery.trim().toLowerCase();
  const shownGroups = addonGroups.filter(
    (g) => !q || g.name.toLowerCase().includes(q) || draft.addonGroupIds.includes(g.id),
  );
  // Every way out of the drawer — Batal, X, Esc, outside press, swipe — comes through here.
  const requestClose = () => (dirty ? setDiscarding(true) : onClose());

  const price = parseRupiah(draft.price);
  const cost = parseRupiah(draft.cost);
  const variants = draft.variants.map((v) => ({
    ...v,
    parsedPrice: parseRupiah(v.price),
    parsedCost: parseRupiah(v.cost),
  }));
  // Any variant row, even a blank one, means the item is sold as one of them.
  const hasVariants = variants.length > 0;
  const variantPrices = variants.flatMap((v) => (v.parsedPrice.value === null ? [] : [v.parsedPrice.value]));
  const lowestVariantPrice = variantPrices.length ? String(Math.min(...variantPrices)) : '';
  // Mirrors menu.router.ts's bounds (0 allowed: a free item is a real item); the server still validates.
  const pricesValid = hasVariants
    ? variants.length > 0 &&
      variants.every((v) => v.name.trim() && v.parsedPrice.value !== null && !v.parsedCost.error)
    : price.value !== null && !cost.error;
  const valid = draft.name.trim() && draft.categoryId && pricesValid;

  const setVariant = (i: number, patch: Partial<VariantDraft>) =>
    setDraft({ ...draft, variants: draft.variants.map((v, j) => (j === i ? { ...v, ...patch } : v)) });
  const toggleGroup = (id: string, on: boolean) =>
    setDraft({
      ...draft,
      addonGroupIds: on ? [...draft.addonGroupIds, id] : draft.addonGroupIds.filter((g) => g !== id),
    });

  const save = () => {
    if (!valid) return;
    onSave({
      code: draft.code.trim() || null,
      name: draft.name.trim(),
      categoryId: draft.categoryId,
      // With variants the server derives price (lowest variant) and clears cost; 0 is a placeholder.
      price: hasVariants ? 0 : price.value!,
      cost: hasVariants ? null : cost.value,
      tax: draft.tax,
      available: draft.available,
      variants: hasVariants
        ? variants.map((v) => ({
            id: v.id,
            name: v.name.trim(),
            price: v.parsedPrice.value!,
            cost: v.parsedCost.value,
            available: v.available,
          }))
        : [],
      addonGroupIds: draft.addonGroupIds,
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
      <div className="flex flex-col gap-5">
        <Section title="Info dasar">
          <div className="grid grid-cols-[8rem_1fr] gap-3">
            <TextField
              label="Kode menu"
              helperText="Opsional"
              maxLength={20}
              value={draft.code}
              onChange={(e) =>
                setDraft({ ...draft, code: e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '') })
              }
            />
            <TextField
              label="Nama"
              maxLength={60}
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </div>
          <Select
            label="Kategori"
            items={categories}
            value={draft.categoryId}
            onValueChange={(categoryId) => setDraft({ ...draft, categoryId })}
            placeholder="Pilih kategori"
            error={categories.length ? undefined : 'Belum ada kategori. Tambahkan di halaman Kategori.'}
          />
        </Section>

        <Section title="Harga" aside={hasVariants ? `${variants.length} varian` : undefined}>
          {/* With variants the server takes the lowest variant price and clears the item cost. */}
          <div className="grid grid-cols-2 gap-3">
            <TextField
              label="Harga jual"
              inputMode="numeric"
              adornment={<span className="text-sm text-ink-tertiary">Rp</span>}
              disabled={hasVariants}
              value={hasVariants ? lowestVariantPrice : draft.price}
              error={hasVariants ? undefined : price.error}
              helperText={hasVariants ? 'Mengikuti harga varian termurah.' : undefined}
              onChange={(e) => setDraft({ ...draft, price: e.target.value })}
            />
            <TextField
              label="Harga modal"
              inputMode="numeric"
              adornment={<span className="text-sm text-ink-tertiary">Rp</span>}
              disabled={hasVariants}
              value={hasVariants ? '' : draft.cost}
              error={hasVariants ? undefined : cost.error}
              helperText={hasVariants ? 'Diisi per varian.' : 'Opsional'}
              onChange={(e) => setDraft({ ...draft, cost: e.target.value })}
            />
          </div>

          <div className="flex flex-col gap-2">
            <div>
              <p className="text-sm font-medium text-ink-primary">Varian</p>
            </div>
            <div className="overflow-hidden rounded-lg border border-border-subtle">
              <div
                className={`${VARIANT_GRID} bg-surface-light px-3 py-2 text-xs font-medium text-ink-tertiary`}
                aria-hidden
              >
                <span>Nama varian</span>
                <span>Harga jual</span>
                <span>Harga modal</span>
                <span>Tersedia</span>
                <span />
              </div>
              {!hasVariants && (
                <p className="border-t border-border-subtle px-3 py-4 text-center text-sm text-ink-tertiary">
                  Belum ada varian. Menu dijual dengan harga di atas.
                </p>
              )}
              {variants.map((v, i) => {
                const label = v.name.trim() || `varian ${i + 1}`;
                return (
                  <div key={i} className={`${VARIANT_GRID} border-t border-border-subtle px-3 py-2`}>
                    <TextField
                      aria-label={`Nama ${label}`}
                      placeholder="Regular"
                      maxLength={60}
                      value={v.name}
                      onChange={(e) => setVariant(i, { name: e.target.value })}
                    />
                    <TextField
                      aria-label={`Harga jual ${label}`}
                      inputMode="numeric"
                      placeholder="0"
                      adornment={<span className="text-sm text-ink-tertiary">Rp</span>}
                      value={v.price}
                      error={v.parsedPrice.error}
                      onChange={(e) => setVariant(i, { price: e.target.value })}
                    />
                    <TextField
                      aria-label={`Harga modal ${label}`}
                      inputMode="numeric"
                      placeholder="Opsional"
                      adornment={<span className="text-sm text-ink-tertiary">Rp</span>}
                      value={v.cost}
                      error={v.parsedCost.error}
                      onChange={(e) => setVariant(i, { cost: e.target.value })}
                    />
                    {/* Same height as a text field, so the switch lines up even when a field shows an error. */}
                    <div className="flex h-[38px] items-center">
                      <Switch
                        aria-label={`${label} tersedia`}
                        checked={v.available}
                        onCheckedChange={(available) => setVariant(i, { available })}
                      />
                    </div>
                    <div className="flex h-[38px] items-center">
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Hapus ${label}`}
                        onClick={() =>
                          setDraft({ ...draft, variants: draft.variants.filter((_, j) => j !== i) })
                        }
                      >
                        <Trash2 className="size-4 text-danger" aria-hidden />
                      </Button>
                    </div>
                  </div>
                );
              })}
              <div className="border-t border-border-subtle px-1 py-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDraft({ ...draft, variants: [...draft.variants, blankVariant()] })}
                >
                  <Plus className="mr-2 size-4" aria-hidden />
                  Tambah varian
                </Button>
              </div>
            </div>
          </div>
        </Section>

        <Section title="Pajak" description="Tarif mengikuti pengaturan outlet.">
          <RadioGroup
            aria-label="Jenis pajak"
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

        <Section
          title="Add-on"
          description="Pilihan tambahan atau topping."
          aside={draft.addonGroupIds.length ? `${draft.addonGroupIds.length} dipilih` : undefined}
        >
          {addonGroupsLoading ? (
            <p className="text-sm text-ink-tertiary">Memuat add-on…</p>
          ) : addonGroups.length ? (
            <div className="flex flex-col gap-2">
              {/* A short list reads faster without a search box. */}
              {addonGroups.length > 5 && (
                <TextField
                  aria-label="Cari add-on"
                  placeholder="Cari add-on"
                  adornment={<Search className="size-4 text-ink-tertiary" aria-hidden />}
                  value={addonQuery}
                  onChange={(e) => setAddonQuery(e.target.value)}
                />
              )}
              {shownGroups.length === 0 && (
                <p className="text-sm text-ink-tertiary">Add-on tidak ditemukan. Ubah kata kunci.</p>
              )}
              {shownGroups.map((g) => (
                <Checkbox
                  key={g.id}
                  className="cursor-pointer rounded-lg border border-border-subtle px-3 py-3 transition-colors hover:bg-surface-light has-[[data-checked]]:border-primary has-[[data-checked]]:bg-primary-lighter"
                  checked={draft.addonGroupIds.includes(g.id)}
                  onCheckedChange={(on) => toggleGroup(g.id, on)}
                  label={
                    <span className="flex flex-1 items-center justify-between gap-3">
                      <span className="font-medium text-ink-primary">{g.name}</span>
                      <span className="text-xs text-ink-tertiary">
                        {describeRule(g.minSelect, g.maxSelect)}
                      </span>
                    </span>
                  }
                />
              ))}
            </div>
          ) : (
            <p className="text-sm text-ink-tertiary">Belum ada add-on. Tambahkan di halaman Add-on.</p>
          )}
        </Section>

        <Section title="Ketersediaan">
          <SettingRow
            title="Tersedia di kasir"
            description="Matikan saat menu habis."
            control={
              <Switch
                checked={draft.available}
                onCheckedChange={(available) => setDraft({ ...draft, available })}
              />
            }
          />
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

/** Name | Harga jual | Harga modal | Tersedia | hapus — shared by the header row and every variant row. */
const VARIANT_GRID = 'grid grid-cols-[minmax(0,1fr)_7.5rem_7.5rem_2.75rem_2rem] items-start gap-2';

/** One bordered panel per section, so the form reads as separate groups rather than one long list. */
function Section({
  title,
  description,
  aside,
  children,
}: {
  title: string;
  description?: string;
  /** A short summary on the right of the header, e.g. "3 varian". */
  aside?: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="rounded-xl border border-border-subtle">
      <header className="flex items-start justify-between gap-4 rounded-t-xl border-b border-border-subtle bg-surface-light px-4 py-3">
        <div>
          <h3 id={id} className="text-sm font-semibold text-ink-primary">
            {title}
          </h3>
          {description && <p className="mt-0.5 text-xs text-ink-tertiary">{description}</p>}
        </div>
        {aside && <span className="shrink-0 text-xs font-medium text-ink-secondary">{aside}</span>}
      </header>
      <div className="flex flex-col gap-4 p-4">{children}</div>
    </section>
  );
}

/** A label on the left, its switch on the right; the whole row toggles it. */
function SettingRow({
  title,
  description,
  control,
}: {
  title: string;
  description: string;
  control: ReactNode;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 text-sm">
      <span>
        <span className="block font-medium text-ink-primary">{title}</span>
        <span className="text-ink-tertiary">{description}</span>
      </span>
      {control}
    </label>
  );
}
