Create database table and column for user access control, role, and permission.

create seed inside drizzle/seed/__seed.ts

- 1 table role for user
- create seed `seed/seed-rbac.ts` with owner, manager, cashier, waiter, inventory staff, auditor. 

- permissions 
role name | who can access
sales.view | cashier, auditor
sales.create | cashier, 
sales.void_request | cashier
sales.void_approve | 

sales.discount_request | cashier
sales.discount_approve |

sales.sales.price_override_request | 
sales.price_override_approve |

payments.accept | cashier
payments.refund_request
payments.refund_approve

product.view | cashier, inventory_staff, auditor
product.create | inventory_staff, manager, owner
product.edit | inventory_staff, manager, owner
product.price_edit | manager, owner
product.delete | manager, owner

inventory.view | inventory_staff, manager, owner, auditor
inventory.stock_adjust_request | inventory_staff
inventory.stock_adjust_approve | manager, owner
inventory.receive_stock | inventory_staff, manager, owner
inventory.transfer_request | inventory_staff
inventory.transfer_approve | manager, owner
inventory.purchase_order_create | inventory_staff, manager
inventory.purchase_order_approve | manager, owner
inventory.supplier_manage | manager, owner

table.view | waiter, cashier, manager, owner
table.assign | waiter, cashier, manager, owner
table.transfer_request | waiter, cashier
table.transfer_approve | manager, owner
table.merge_request | waiter, cashier
table.merge_approve | manager, owner
table.close | waiter, cashier, manager, owner
table.force_close_request | waiter, cashier
table.force_close_apporve | manageroth, owner
table.reopen_request | waiter, cashier
table.reopen_approve | manager, owner
table.layout_manage | manager, owner

order.view | waiter, cashier, manager, owner, auditor
order.create | waiter, cashier, manager, owner
order.item_add | waiter, cashier, manager, owner
order.item_remove_request | waiter, cashier
order.item_remove_approve | manager, owner
order.adjustment_request | waiter, cashier, 
order.adjustment_approve | manager, owner.
order.send_to_kitchen | waiter, manager, owner
order.hold | waiter, cashier, manager, owner
order.cancel_request | waiter, cashier
order.cancel_approve | manager, owner

create seed for permissions on `seed/seed-rbac.ts` make owner and manager have all access, the one without who can access is for manager and owner