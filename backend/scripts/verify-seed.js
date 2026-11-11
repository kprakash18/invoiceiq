import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const expectedUsers = [
  ["admin@invoiceiq.com", "Admin User", "ADMIN"],
  ["analyst@invoiceiq.com", "AP Analyst", "AP_ANALYST"],
  ["finance@invoiceiq.com", "Finance Manager", "FINANCE_MANAGER"],
];
const expectedVendorTaxIds = [
  "36AABCA1234C1Z5",
  "33AABCP1234C1Z5",
  "09AABCU1234C1Z5",
  "24AABCT1234C1Z5",
  "27AABCD5678E1Z5",
];
const expectedPurchaseOrders = [
  ["PO-HAPPY", "36AABCA1234C1Z5", "MON-HAPPY-001"],
  ["PO-CUMULATIVE", "33AABCP1234C1Z5", "COMP-CUM-001"],
  ["PO-BUNDLE-01", "09AABCU1234C1Z5", "SRV-BUNDLE-001"],
  ["PO-BUNDLE-02", "09AABCU1234C1Z5", "NET-BUNDLE-001"],
  ["PO-TAX-INCLUSIVE", "24AABCT1234C1Z5", "PAP-TAX-001"],
  ["PO-DUPLICATE", "27AABCD5678E1Z5", "DRV-DUP-001"],
];

async function main() {
  const [users, vendors, purchaseOrders, userCount, vendorCount, poCount, lineCount, invoiceCount, jobCount] =
    await Promise.all([
      prisma.user.findMany({ where: { email: { in: expectedUsers.map(([email]) => email) } } }),
      prisma.vendor.findMany({ where: { taxId: { in: expectedVendorTaxIds } } }),
      prisma.purchaseOrder.findMany({
        where: { poNumber: { in: expectedPurchaseOrders.map(([poNumber]) => poNumber) } },
        include: { vendor: true, items: true },
      }),
      prisma.user.count(),
      prisma.vendor.count(),
      prisma.purchaseOrder.count(),
      prisma.pOLineItem.count(),
      prisma.invoice.count(),
      prisma.invoiceProcessingJob.count(),
    ]);

  assert.equal(users.length, expectedUsers.length, "Expected all seeded users");
  for (const [email, name, role] of expectedUsers) {
    const user = users.find((record) => record.email === email);
    assert.ok(user, `Missing seeded user ${email}`);
    assert.equal(user.name, name);
    assert.equal(user.role, role);
  }

  assert.equal(vendors.length, expectedVendorTaxIds.length, "Expected all seeded vendors");
  assert.equal(purchaseOrders.length, expectedPurchaseOrders.length, "Expected all seeded purchase orders");
  for (const [poNumber, vendorTaxId, itemCode] of expectedPurchaseOrders) {
    const po = purchaseOrders.find((record) => record.poNumber === poNumber);
    assert.ok(po, `Missing seeded purchase order ${poNumber}`);
    assert.equal(po.vendor.taxId, vendorTaxId, `${poNumber} vendor relationship`);
    assert.equal(po.items.length, 1, `${poNumber} line item count`);
    assert.equal(po.items[0].itemCode, itemCode, `${poNumber} line item`);
  }

  assert.deepEqual(
    { users: userCount, vendors: vendorCount, purchaseOrders: poCount, poLineItems: lineCount, invoices: invoiceCount, processingJobs: jobCount },
    { users: 3, vendors: 5, purchaseOrders: 6, poLineItems: 6, invoices: 0, processingJobs: 0 },
    "Fresh database should contain only the expected initial seed records"
  );
  console.log("Seed verification passed: 3 users, 5 vendors, 6 purchase orders, 6 linked PO lines; no invoices or processing jobs.");
}

main()
  .catch((error) => {
    console.error("Seed verification failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
