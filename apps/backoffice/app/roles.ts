const ROLE_LABEL: Record<string, string> = {
  owner: 'Pemilik',
  manager: 'Manajer',
  supervisor: 'Supervisor',
  cashier: 'Kasir',
  waiter: 'Pelayan',
  kitchen: 'Dapur',
  accountant: 'Akuntan',
};

export const roleLabel = (name: string) => ROLE_LABEL[name] ?? name;
