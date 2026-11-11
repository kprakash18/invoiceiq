
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
];

const purchaseOrders = [
  {
    poNumber: "PO-HAPPY-PDF",
    vendorTaxId: "36AABCA1234C1Z5",
    totalAmount: "10000",
    issueDate: "2026-11-01",
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
    poNumber: "PO-HAPPY-JPG",
    vendorTaxId: "36AABCA1234C1Z5",
    totalAmount: "6000",
    issueDate: "2026-11-01",
    items: [
      {
        description: "Wireless Keyboard",
        itemCode: "KEY-HAPPY-001",
        quantity: "3",
        unitPrice: "2000",
      },
    ],
  },
  {
    poNumber: "PO-CUMULATIVE",
    vendorTaxId: "33AABCP1234C1Z5",
    totalAmount: "100000",
    issueDate: "2026-11-01",
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
    issueDate: "2026-11-01",
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
    issueDate: "2026-11-01",
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
    totalAmount: "25000",
    issueDate: "2026-11-01",
    items: [
      {
        description: "A4 Paper Ream",
        itemCode: "PAP-TAX-001",
        quantity: "100",
        unitPrice: "250",
      },
    ],
  },
  {
    poNumber: "PO-DUPLICATE",
    vendorTaxId: "33AABCP1234C1Z5",
    totalAmount: "5000",
    issueDate: "2026-11-01",
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

  for (const user of users) {
    await prisma.user.upsert({
      where: { email: user.email },
      update: { name: user.name, role: user.role },
      create: user,
    });
  }

  for (const vendor of vendors) {
    await prisma.vendor.upsert({
      where: { taxId: vendor.taxId },
      update: {
        name: vendor.name,
        email: vendor.email,
        phone: vendor.phone,
        address: vendor.address,
        currency: vendor.currency,
      },
      create: vendor,
    });
  }

  for (const poData of purchaseOrders) {
    const vendor = await prisma.vendor.findUnique({
      where: { taxId: poData.vendorTaxId },
    });

    if (!vendor) {
      throw new Error(`Vendor not found: ${poData.vendorTaxId}`);
    }

    const purchaseOrder = await prisma.purchaseOrder.upsert({
      where: { poNumber: poData.poNumber },
      update: {
        vendorId: vendor.id,
        totalAmount: poData.totalAmount,
        issueDate: new Date(poData.issueDate),
        currency: "INR",
        status: "OPEN",
      },
      create: {
        poNumber: poData.poNumber,
        vendorId: vendor.id,
        totalAmount: poData.totalAmount,
        issueDate: new Date(poData.issueDate),
        currency: "INR",
        status: "OPEN",
      },
    });

    for (let i = 0; i < poData.items.length; i++) {
      const item = poData.items[i];

      await prisma.pOLineItem.upsert({
        where: { id: `${poData.poNumber}-LINE-${i + 1}` },
        update: {
          description: item.description,
          itemCode: item.itemCode,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          poId: purchaseOrder.id,
        },
        create: {
          id: `${poData.poNumber}-LINE-${i + 1}`,
          poId: purchaseOrder.id,
          description: item.description,
          itemCode: item.itemCode,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
        },
      });
    }
  }

  const counts = {
    users: await prisma.user.count(),
    vendors: await prisma.vendor.count(),
    purchaseOrders: await prisma.purchaseOrder.count(),
    poLineItems: await prisma.pOLineItem.count(),
    invoices: await prisma.invoice.count(),
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
