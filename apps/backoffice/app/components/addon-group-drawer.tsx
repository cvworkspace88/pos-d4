import { Plus, Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import {
  describeRule,
  parseRupiah,
  getSelectAddonErrorMessage,
  type RouterInputs,
  type RouterOutputs,
} from '@repo/api-contract';
import { Button } from '@repo/ui/button';
import { Dialog } from '@repo/ui/dialog';
import { Drawer } from '@repo/ui/drawer';
import { Switch } from '@repo/ui/switch';
import { TextField } from '@repo/ui/text-field';

export type AddonGroup = RouterOutputs['addon']['list'][number];
export type AddonGroupFields = RouterInputs['addon']['create'];

type OptionDraft = { id?: string; name: string; price: string; available: boolean };
type Draft = { name: string; minSelect: string; maxSelect: string; options: OptionDraft[] };

const blankOption = (): OptionDraft => ({ name: '', price: '0', available: true });

const toDraft = (target: AddonGroup | 'new'): Draft =>
  target === 'new'
    ? { name: '', minSelect: '0', maxSelect: '1', options: [blankOption()] }
    : {
        name: target.name,
        minSelect: String(target.minSelect),
        maxSelect: String(target.maxSelect),
        options: target.options.map((o) => ({
          id: o.id,
          name: o.name,
          price: String(o.price),
          available: o.available,
        })),
      };

/** A whole number 0–50 typed by a person, else null. */
const pickCount = (s: string): number | null =>
  /^\d{1,2}$/.test(s.trim()) && Number(s) <= 50 ? Number(s) : null;

interface AddonGroupDrawerProps {
  /** `null` closed, `'new'` adding, a group editing it. */
  target: AddonGroup | 'new' | null;
  onSave: (fields: AddonGroupFields) => void;
  onClose: () => void;
  saving?: boolean;
  error?: string;
}

/** Add or edit one add-on group and its options. Asks before throwing away unsaved changes. */
export function AddonGroupDrawer({ target, onSave, onClose, saving, error }: AddonGroupDrawerProps) {
  const [draft, setDraft] = useState<Draft>(() => toDraft('new'));
  const [initial, setInitial] = useState<Draft>(draft);
  const [isNew, setIsNew] = useState(true);
  const [discarding, setDiscarding] = useState(false);

  // Reset on open, during render — same pattern as MenuItemDrawer.
  const [openedFor, setOpenedFor] = useState(target);
  if (target !== openedFor) {
    setOpenedFor(target);
    if (target) {
      const start = toDraft(target);
      setDraft(start);
      setInitial(start);
      setIsNew(target === 'new');
    }
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const requestClose = () => (dirty ? setDiscarding(true) : onClose());

  const min = pickCount(draft.minSelect);
  const max = pickCount(draft.maxSelect);
  const options = draft.options.map((o) => ({ ...o, parsed: parseRupiah(o.price) }));
  // The one check getSelectAddonErrorMessage cannot make: min/max must first parse as numbers.
  const ruleError =
    min === null || max === null
      ? 'Isi angka 0–50.'
      : (getSelectAddonErrorMessage({ min, max, optionCount: options.length }) ?? undefined);
  const valid =
    draft.name.trim() &&
    !ruleError &&
    options.length > 0 &&
    options.every((o) => o.name.trim() && o.parsed.value !== null);

  const setOption = (i: number, patch: Partial<OptionDraft>) =>
    setDraft({ ...draft, options: draft.options.map((o, j) => (j === i ? { ...o, ...patch } : o)) });

  const save = () => {
    if (!valid) return;
    onSave({
      name: draft.name.trim(),
      minSelect: min!,
      maxSelect: max!,
      options: options.map((o) => ({
        id: o.id,
        name: o.name.trim(),
        price: o.parsed.value!,
        available: o.available,
      })),
    });
  };

  return (
    <Drawer
      open={!!target}
      onClose={requestClose}
      blocking={saving}
      title={isNew ? 'Tambah add-on' : `Ubah: ${initial.name}`}
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
            placeholder="Contoh: Level Pedas"
            maxLength={60}
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
          <div className="grid grid-cols-2 gap-3">
            <TextField
              label="Pilihan minimum"
              helperText="0 = opsional"
              inputMode="numeric"
              value={draft.minSelect}
              onChange={(e) => setDraft({ ...draft, minSelect: e.target.value })}
            />
            <TextField
              label="Pilihan maksimum"
              inputMode="numeric"
              value={draft.maxSelect}
              onChange={(e) => setDraft({ ...draft, maxSelect: e.target.value })}
            />
          </div>
          <p className={`text-sm ${ruleError ? 'text-danger' : 'text-ink-secondary'}`}>
            {ruleError ?? `Pelanggan: ${describeRule(min!, max!)}`}
          </p>
        </Section>

        <Section title="Pilihan">
          {options.map((o, i) => (
            <div key={i} className="flex flex-col gap-3 rounded-lg border border-border-muted p-3">
              <div className="flex items-end gap-3">
                <div className="flex-1">
                  <TextField
                    label="Nama pilihan"
                    maxLength={60}
                    value={o.name}
                    onChange={(e) => setOption(i, { name: e.target.value })}
                  />
                </div>
                <div className="w-36">
                  <TextField
                    label="Harga"
                    inputMode="numeric"
                    adornment={<span className="text-sm text-ink-tertiary">+Rp</span>}
                    value={o.price}
                    error={o.parsed.error}
                    onChange={(e) => setOption(i, { price: e.target.value })}
                  />
                </div>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Hapus pilihan ${o.name || i + 1}`}
                  disabled={options.length === 1}
                  onClick={() => setDraft({ ...draft, options: draft.options.filter((_, j) => j !== i) })}
                >
                  <Trash2 className="size-4 text-danger" aria-hidden />
                </Button>
              </div>
              <label className="flex items-center justify-between gap-4 text-sm">
                <span className="text-ink-secondary">Tersedia</span>
                <Switch checked={o.available} onCheckedChange={(available) => setOption(i, { available })} />
              </label>
            </div>
          ))}
          <Button
            variant="outline"
            onClick={() => setDraft({ ...draft, options: [...draft.options, blankOption()] })}
          >
            <Plus className="mr-2 size-4" aria-hidden />
            Tambah pilihan
          </Button>
        </Section>
      </div>

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
        <p className="text-sm text-ink-secondary">Perubahan pada add-on ini belum disimpan.</p>
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
