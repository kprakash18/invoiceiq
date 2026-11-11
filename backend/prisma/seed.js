
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
});

const prisma = new PrismaClient({ adapter });

const users = [
  { name: "Admin User", email: "admin@invoiceiq.com", role: "ADMIN" },
  { name: "AP Analyst", email: "analyst@invoiceiq.com", role: "AP_ANALYST" },
  {
    name: "Finance Manager",
    email: "finance@invoiceiq.com",
    role: "FINANCE_MANAGER",
  },
];

const vendors = [
  {
    name: "Apex Office Technologies",
    taxId: "36AABCA1234C1Z5",
    email: "billing@apexoffice.example",
    phone: "9000000201",
    address: "Hyderabad, Telangana",
    currency: "INR",
  },
  {
    name: "Precision Components Ltd",
    taxId: "33AABCP1234C1Z5",
    email: "accounts@precisioncomponents.example",
    phone: "9000000202",
    address: "Coimbatore, Tamil Nadu",
    currency: "INR",
  },
  {
    name: "Unified Infrastructure Ltd",
    taxId: "09AABCU1234C1Z5",
    email: "billing@unifiedinfra.example",
    phone: "9000000203",
    address: "Noida, Uttar Pradesh",
    currency: "INR",
  },
  {
    name: "Taxwise Supplies Ltd",
    taxId: "24AABCT1234C1Z5",
    email: "invoices@taxwisesupplies.example",
    phone: "9000000204",
    address: "Ahmedabad, Gujarat",
    currency: "INR",
  },
  {
    name: "Duplicate Test Supplies Ltd",
    taxId: "27AABCD5678E1Z5",
    email: "billing@duplicatetest.example",
    phone: "9000000205",
    address: "Mumbai, Maharashtra",
    currency: "INR",
  },
];

const purchaseOrders = [
  {
    poNumber: "PO-HAPPY",
    vendorTaxId: "36AABCA1234C1Z5",
    totalAmount: "10000",
    items: [
      {
        description: "Business Monitor",
        itemCode: "MON-HAPPY-001",
        quantity: "2",
        unitPrice: "5000",
      },
    ],
  },
  {
    poNumber: "PO-CUMULATIVE",
    vendorTaxId: "33AABCP1234C1Z5",
    totalAmount: "100000",
    items: [
      {
        description: "Industrial Component",
        itemCode: "COMP-CUM-001",
        quantity: "100",
        unitPrice: "1000",
      },
    ],
  },
  {
    poNumber: "PO-BUNDLE-01",
    vendorTaxId: "09AABCU1234C1Z5",
    totalAmount: "90000",
    items: [
      {
        description: "Server Maintenance",
        itemCode: "SRV-BUNDLE-001",
        quantity: "1",
        unitPrice: "90000",
      },
    ],
  },
  {
    poNumber: "PO-BUNDLE-02",
    vendorTaxId: "09AABCU1234C1Z5",
    totalAmount: "60000",
    items: [
      {
        description: "Network Support",
        itemCode: "NET-BUNDLE-001",
        quantity: "1",
        unitPrice: "60000",
      },
    ],
  },
  {
    poNumber: "PO-TAX-INCLUSIVE",
    vendorTaxId: "24AABCT1234C1Z5",
    totalAmount: "10000",
    items: [
      {
        description: "A4 Paper Ream",
        itemCode: "PAP-TAX-001",
        quantity: "100",
        unitPrice: "100",
      },
    ],
  },
  {
    poNumber: "PO-DUPLICATE",
    vendorTaxId: "27AABCD5678E1Z5",
    totalAmount: "5000",
    items: [
      {
        description: "Storage Drive",
        itemCode: "DRV-DUP-001",
        quantity: "1",
        unitPrice: "5000",
      },
    ],
  },
];

async function main() {
  console.log("Starting InvoiceIQ evaluation-data seeding...");

  await prisma.$transaction(async (tx) => {
    for (const user of users) {
      await tx.user.upsert({
        where: { email: user.email },
        update: { name: user.name, role: user.role },
        create: user,
      });
    }

    for (const vendorData of vendors) {
      await tx.vendor.upsert({
        where: { taxId: vendorData.taxId },
        update: {
          name: vendorData.name,
          email: vendorData.email,
          phone: vendorData.phone,
          address: vendorData.address,
          currency: vendorData.currency,
        },
        create: vendorData,
      });
    }

    for (const poData of purchaseOrders) {
      const vendor = await tx.vendor.findUnique({
        where: { taxId: poData.vendorTaxId },
      });

      if (!vendor) {
        throw new Error(`Vendor not found: ${poData.vendorTaxId}`);
      }

      const po = await tx.purchaseOrder.upsert({
        where: { poNumber: poData.poNumber },
        update: {
          vendorId: vendor.id,
          totalAmount: poData.totalAmount,
          issueDate: new Date("2026-11-01T00:00:00.000Z"),
          currency: "INR",
          status: "OPEN",
        },
        create: {
          poNumber: poData.poNumber,
          vendorId: vendor.id,
          totalAmount: poData.totalAmount,
          issueDate: new Date("2026-11-01T00:00:00.000Z"),
          currency: "INR",
          status: "OPEN",
        },
      });

      // Reconcile the PO's line items.
      await tx.pOLineItem.deleteMany({
        where: { poId: po.id },
      });

      for (let i = 0; i < poData.items.length; i++) {
        const item = poData.items[i];

        await tx.pOLineItem.create({
          data: {
            id: `${poData.poNumber}-LINE-${i + 1}`,
            poId: po.id,
            description: item.description,
            itemCode: item.itemCode,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
          },
        });
      }
    }
  });

  const counts = {
    users: await prisma.user.count(),
    vendors: await prisma.vendor.count(),
    purchaseOrders: await prisma.purchaseOrder.count(),
    poLineItems: await prisma.pOLineItem.count(),
    invoices: await prisma.invoice.count(),
    processingJobs: await prisma.invoiceProcessingJob.count(),
  };

  console.log("\nInvoiceIQ seed summary:");
  console.table(counts);
  console.log("Seeding completed.");
}

main()
  .catch((error) => {
    console.error("Seeding failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
