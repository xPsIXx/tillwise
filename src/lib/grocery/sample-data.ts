import type { LabelExtraction, ReceiptExtraction } from "./types";

export type SampleLabel = {
  id: string;
  image: string;
  title: string;
  hint: string;
  data: LabelExtraction;
};

export type SampleReceipt = {
  id: string;
  image: string;
  title: string;
  hint: string;
  data: ReceiptExtraction;
};

export const SAMPLE_LABELS: SampleLabel[] = [
  {
    id: "bananas",
    image: "/samples/label-bananas.jpg",
    title: "Organic bananas",
    hint: "Produce scale sticker",
    data: {
      name: "Organic Bananas",
      brand: "Spinneys",
      description: "Loose organic bananas, weighed at the produce scale",
      barcode: null,
      category: "Produce",
      quantity: 1,
      quantityUnit: "bunch",
      weightValue: 1.24,
      weightUnit: "kg",
      unitPrice: 7.18,
      linePrice: 8.9,
      currency: "AED",
      origin: null,
      rawText:
        "SPINNEYS  ORGANIC BANANAS  1.24 kg  AED 7.18 / kg  AED 8.90  PLU 4011",
    },
  },
  {
    id: "tomatoes",
    image: "/samples/label-tomatoes.jpg",
    title: "Tomatoes on the vine",
    hint: "Produce scale sticker",
    data: {
      name: "Tomatoes on the Vine",
      brand: null,
      description: "Vine tomatoes, weighed at the produce scale",
      barcode: null,
      category: "Produce",
      quantity: 1,
      quantityUnit: "pack",
      weightValue: 0.68,
      weightUnit: "kg",
      unitPrice: 9.5,
      linePrice: 6.46,
      currency: "AED",
      origin: null,
      rawText:
        "TOMATOES ON VINE  0.68 kg  AED 9.50 / kg  AED 6.46  PLU 4664",
    },
  },
  {
    id: "milk",
    image: "/samples/label-milk.jpg",
    title: "Full cream milk",
    hint: "Carton label + barcode",
    data: {
      name: "Full Cream Milk",
      brand: "Almarai",
      description: "Fresh full cream milk, 2 litre carton",
      barcode: "6281007370152",
      category: "Dairy",
      quantity: 1,
      quantityUnit: "carton",
      weightValue: 2,
      weightUnit: "l",
      unitPrice: null,
      linePrice: null,
      currency: "AED",
      origin: "Saudi Arabia",
      rawText: "Almarai Full Cream Milk 2L",
    },
  },
];

export const SAMPLE_RECEIPTS: SampleReceipt[] = [
  {
    id: "top",
    image: "/samples/receipt-top.jpg",
    title: "Receipt — top",
    hint: "Store header and first lines",
    data: {
      storeName: "Carrefour",
      storeLocation: "Yas Mall, Abu Dhabi",
      datetime: "2026-08-24T18:42:00+04:00",
      isPartial: true,
      portionHint: "top",
      items: [
        {
          name: "Org Bananas",
          quantity: 1,
          quantityUnit: null,
          weightValue: 1.24,
          weightUnit: "kg",
          unitPrice: null,
          linePrice: 8.9,
        },
        {
          name: "Almarai Milk 2L",
          quantity: 1,
          quantityUnit: "carton",
          weightValue: 2,
          weightUnit: "l",
          unitPrice: 11.5,
          linePrice: 11.5,
        },
        {
          name: "Tom Vine",
          quantity: 1,
          quantityUnit: null,
          weightValue: 0.68,
          weightUnit: "kg",
          unitPrice: null,
          linePrice: 6.46,
        },
      ],
      subtotal: null,
      tax: null,
      total: null,
      currency: "AED",
      rawText:
        "CARREFOUR  Yas Mall, Abu Dhabi  24/08/2026 18:42  ORG BANANAS 1.24kg 8.90  ALMARAI MILK 2L 11.50  TOM VINE 0.68kg 6.46",
    },
  },
  {
    id: "bottom",
    image: "/samples/receipt-bottom.jpg",
    title: "Receipt — bottom",
    hint: "Remaining lines and totals",
    data: {
      storeName: "Carrefour",
      storeLocation: "Yas Mall, Abu Dhabi",
      datetime: "2026-08-24T18:42:00+04:00",
      isPartial: true,
      portionHint: "bottom",
      items: [
        {
          name: "Extra Virgin Olive Oil 750ml",
          quantity: 1,
          quantityUnit: "bottle",
          weightValue: 750,
          weightUnit: "ml",
          unitPrice: 28.75,
          linePrice: 28.75,
        },
        {
          name: "Eggs Large 12pk",
          quantity: 12,
          quantityUnit: "ea",
          weightValue: null,
          weightUnit: null,
          unitPrice: null,
          linePrice: 14.2,
        },
      ],
      subtotal: 69.81,
      tax: 3.32,
      total: 73.13,
      currency: "AED",
      rawText:
        "EXTRA VIRGIN OLIVE OIL 750ml 28.75  EGGS LARGE 12PK 14.20  SUBTOTAL 69.81  VAT 5% 3.32  TOTAL AED 73.13",
    },
  },
  {
    id: "full",
    image: "/samples/receipt-full.jpg",
    title: "Full receipt",
    hint: "Whole ticket in one shot",
    data: {
      storeName: "Carrefour",
      storeLocation: "Abu Dhabi",
      datetime: "2026-08-24T18:42:00+04:00",
      isPartial: false,
      portionHint: "full",
      items: [
        {
          name: "Org Bananas",
          quantity: 1,
          quantityUnit: null,
          weightValue: 1.24,
          weightUnit: "kg",
          unitPrice: null,
          linePrice: 8.9,
        },
        {
          name: "Almarai Milk 2L",
          quantity: 1,
          quantityUnit: "carton",
          weightValue: 2,
          weightUnit: "l",
          unitPrice: 11.5,
          linePrice: 11.5,
        },
        {
          name: "Tom Vine",
          quantity: 1,
          quantityUnit: null,
          weightValue: 0.68,
          weightUnit: "kg",
          unitPrice: null,
          linePrice: 6.46,
        },
        {
          name: "Extra Virgin Olive Oil 750ml",
          quantity: 1,
          quantityUnit: "bottle",
          weightValue: 750,
          weightUnit: "ml",
          unitPrice: 28.75,
          linePrice: 28.75,
        },
        {
          name: "Eggs Large 12pk",
          quantity: 12,
          quantityUnit: "ea",
          weightValue: null,
          weightUnit: null,
          unitPrice: null,
          linePrice: 14.2,
        },
      ],
      subtotal: 69.81,
      tax: 3.32,
      total: 73.13,
      currency: "AED",
      rawText:
        "CARREFOUR  ORG BANANAS 1.24kg 8.90  ALMARAI MILK 2L 11.50  TOM VINE 0.68kg 6.46  EXTRA VIRGIN OLIVE OIL 750ml 28.75  EGGS LARGE 12PK 14.20  TOTAL AED 73.13",
    },
  },
];
