const ROLE_LABEL: Record<string, string> = {
  owner: 'Pemilik',
  manager: 'Manajer',
  cashier: 'Kasir',
  waiter: 'Pelayan',
  inventory_staff: 'Staf gudang',
  auditor: 'Auditor',
};

export const roleLabel = (name: string) => ROLE_LABEL[name] ?? name;
