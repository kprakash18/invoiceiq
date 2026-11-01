import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
});

const prisma = new PrismaClient({ adapter });

// ------------------------------------
// USERS
// ------------------------------------

const users = [
  {
    name: "Admin User",
    email: "admin@invoiceiq.com",
    role: "ADMIN",
  },
  {
    name: "AP Analyst",
    email: "analyst@invoiceiq.com",
    role: "AP_ANALYST",
  },
  {
    name: "Finance Manager",
    email: "finance@invoiceiq.com",
    role: "FINANCE_MANAGER",
  },
];

// ------------------------------------
// VENDORS
// ------------------------------------

const vendors = [
  {
    name: "ABC Technologies Pvt Ltd",
    taxId: "GSTIN-DEMO-001",
    email: "billing@abctech.example",
    phone: "9000000001",
    address: "Hyderabad, Telangana",
    currency: "INR",
  },
  {
    name: "Global Office Supplies",
    taxId: "GSTIN-DEMO-002",
    email: "sales@globaloffice.example",
    phone: "9000000002",
    address: "Bengaluru, Karnataka",
    currency: "INR",
  },
  {
    name: "Sunrise Electronics",
    taxId: "GSTIN-DEMO-003",
    email: "orders@sunrise.example",
    phone: "9000000003",
    address: "Chennai, Tamil Nadu",
    currency: "INR",
  },
  {
    name: "TechNova Solutions",
    taxId: "GSTIN-DEMO-004",
    email: "accounts@technova.example",
    phone: "9000000004",
    address: "Pune, Maharashtra",
    currency: "INR",
  },
  {
    name: "GreenLeaf Industries",
    taxId: "GSTIN-DEMO-005",
    email: "finance@greenleaf.example",
    phone: "9000000005",
    address: "Mumbai, Maharashtra",
    currency: "INR",
  },
];

// ------------------------------------
// PURCHASE ORDERS
// ------------------------------------

const purchaseOrders = [
  {
    poNumber: "PO-2026-1001",
    vendorTaxId: "GSTIN-DEMO-001",
    totalAmount: "126000",
    issueDate: "2026-10-01",
    items: [
      {
        description: "Business Laptop",
        itemCode: "LAP-001",
        quantity: "2",
        unitPrice: "55000",
      },
      {
        description: "Laptop Docking Station",
        itemCode: "DOCK-001",
        quantity: "2",
        unitPrice: "8000",
      },
    ],
  },
  {
    poNumber: "PO-2026-1002",
    vendorTaxId: "GSTIN-DEMO-001",
    totalAmount: "67500",
    issueDate: "2026-10-05",
    items: [
      {
        description: "LED Monitor",
        itemCode: "MON-001",
        quantity: "5",
        unitPrice: "12000",
      },
      {
        description: "Wireless Keyboard",
        itemCode: "KEY-001",
        quantity: "5",
        unitPrice: "1500",
      },
    ],
  },
  {
    poNumber: "PO-2026-1003",
    vendorTaxId: "GSTIN-DEMO-002",
    totalAmount: "30000",
    issueDate: "2026-10-06",
    items: [
      {
        description: "A4 Paper Ream",
        itemCode: "PAP-001",
        quantity: "100",
        unitPrice: "250",
      },
      {
        description: "Ball Pens",
        itemCode: "PEN-001",
        quantity: "200",
        unitPrice: "10",
      },
      {
        description: "Office Files",
        itemCode: "FIL-001",
        quantity: "100",
        unitPrice: "30",
      },
    ],
  },
  {
    poNumber: "PO-2026-1004",
    vendorTaxId: "GSTIN-DEMO-002",
    totalAmount: "77000",
    issueDate: "2026-10-08",
    items: [
      {
        description: "Office Chair",
        itemCode: "CHR-001",
        quantity: "10",
        unitPrice: "4500",
      },
      {
        description: "Office Table",
        itemCode: "TBL-001",
        quantity: "4",
        unitPrice: "8000",
      },
    ],
  },
  {
    poNumber: "PO-2026-1005",
    vendorTaxId: "GSTIN-DEMO-003",
    totalAmount: "54000",
    issueDate: "2026-10-10",
    items: [
      {
        description: "Wireless Router",
        itemCode: "RTR-001",
        quantity: "4",
        unitPrice: "7500",
      },
      {
        description: "Network Switch",
        itemCode: "SWT-001",
        quantity: "2",
        unitPrice: "12000",
      },
    ],
  },
  {
    poNumber: "PO-2026-1006",
    vendorTaxId: "GSTIN-DEMO-004",
    totalAmount: "130000",
    issueDate: "2026-10-12",
    items: [
      {
        description: "Software License",
        itemCode: "LIC-001",
        quantity: "10",
        unitPrice: "9000",
      },
      {
        description: "Technical Support",
        itemCode: "SUP-001",
        quantity: "1",
        unitPrice: "15000",
      },
      {
        description: "Implementation Service",
        itemCode: "IMP-001",
        quantity: "1",
        unitPrice: "25000",
      },
    ],
  },
  {
    poNumber: "PO-2026-1007",
    vendorTaxId: "GSTIN-DEMO-005",
    totalAmount: "19000",
    issueDate: "2026-10-15",
    items: [
      {
        description: "Packaging Bags",
        itemCode: "BAG-001",
        quantity: "500",
        unitPrice: "20",
      },
      {
        description: "Product Labels",
        itemCode: "LAB-001",
        quantity: "1000",
        unitPrice: "2",
      },
      {
        description: "Cardboard Cartons",
        itemCode: "BOX-001",
        quantity: "200",
        unitPrice: "35",
      },
    ],
  },
  {
    poNumber: "PO-2026-1008",
    vendorTaxId: "GSTIN-DEMO-004",
    totalAmount: "258000",
    issueDate: "2026-10-18",
    items: [
      {
        description: "Rack Server",
        itemCode: "SRV-001",
        quantity: "2",
        unitPrice: "85000",
      },
      {
        description: "Enterprise SSD",
        itemCode: "SSD-001",
        quantity: "4",
        unitPrice: "12000",
      },
      {
        description: "Server RAM Module",
        itemCode: "RAM-001",
        quantity: "8",
        unitPrice: "5000",
      },
    ],
  },
];

// ------------------------------------
// SEED FUNCTION
// ------------------------------------

async function main() {
  console.log("Starting InvoiceIQ database seeding...");

  // 1. Create or update users

  for (const user of users) {
    await prisma.user.upsert({
      where: {
        email: user.email,
      },
      update: {
        name: user.name,
        role: user.role,
      },
      create: user,
    });
  }

  console.log("Users seeded successfully.");

  // 2. Create or update vendors

  for (const vendor of vendors) {
    await prisma.vendor.upsert({
      where: {
        taxId: vendor.taxId,
      },
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

  console.log("Vendors seeded successfully.");

  // 3. Create or update purchase orders and line items

  for (const poData of purchaseOrders) {
    const vendor = await prisma.vendor.findUnique({
      where: {
        taxId: poData.vendorTaxId,
      },
    });

    if (!vendor) {
      throw new Error(`Vendor not found: ${poData.vendorTaxId}`);
    }

    const purchaseOrder = await prisma.purchaseOrder.upsert({
      where: {
        poNumber: poData.poNumber,
      },
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

    // Deterministic IDs make each line item safely upsertable.
    for (let i = 0; i < poData.items.length; i++) {
      const item = poData.items[i];

      await prisma.pOLineItem.upsert({
        where: {
          id: `${poData.poNumber}-LINE-${i + 1}`,
        },
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

  console.log("Purchase orders and line items seeded successfully.");

  // 4. Print summary

  const counts = {
    users: await prisma.user.count(),
    vendors: await prisma.vendor.count(),
    purchaseOrders: await prisma.purchaseOrder.count(),
    poLineItems: await prisma.pOLineItem.count(),
    invoices: await prisma.invoice.count(),
  };

  console.log("\nInvoiceIQ seed summary:");
  console.table(counts);

  console.log("Database seeding completed successfully.");
}

// ------------------------------------
// EXECUTION
// ------------------------------------

main()
  .catch((error) => {
    console.error("Seeding failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });