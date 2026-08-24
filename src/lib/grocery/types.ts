export type TripStatus = "shopping" | "receipt" | "review" | "complete";

export type ItemSource = "label" | "receipt" | "merged";

export type MatchStatus =
  | "unmatched"
  | "matched"
  | "label_only"
  | "receipt_only"
  | "processing";

export type ScanMode = "label" | "receipt";

export type LlmProvider = "grok" | "local";

export type Trip = {
  id: number;
  storeName: string | null;
  storeLocation: string | null;
  startedAt: string;
  completedAt: string | null;
  status: TripStatus;
  receiptSubtotal: number | null;
  receiptTax: number | null;
  receiptTotal: number | null;
  currency: string;
  notes: string | null;
  itemCount: number;
  labelCount: number;
  receiptCaptureCount: number;
};

export type TripItem = {
  id: number;
  tripId: number;
  source: ItemSource;
  name: string;
  brand: string | null;
  description: string | null;
  barcode: string | null;
  category: string | null;
  quantity: number | null;
  quantityUnit: string | null;
  weightValue: number | null;
  weightUnit: string | null;
  unitPrice: number | null;
  linePrice: number | null;
  currency: string | null;
  rawText: string | null;
  thumbnailData: string | null;
  matchStatus: MatchStatus;
  matchConfidence: number | null;
  createdAt: string;
};

export type ReceiptCapture = {
  id: number;
  tripId: number;
  sequence: number;
  extracted: ReceiptExtraction | null;
  thumbnailData: string | null;
  createdAt: string;
};

export type LabelExtraction = {
  name: string;
  brand: string | null;
  description: string | null;
  barcode: string | null;
  category: string | null;
  quantity: number | null;
  quantityUnit: string | null;
  weightValue: number | null;
  weightUnit: string | null;
  unitPrice: number | null;
  linePrice: number | null;
  currency: string | null;
  origin: string | null;
  rawText: string;
};

export type ReceiptLine = {
  name: string;
  quantity: number | null;
  quantityUnit: string | null;
  weightValue: number | null;
  weightUnit: string | null;
  unitPrice: number | null;
  linePrice: number | null;
};

export type ReceiptExtraction = {
  storeName: string | null;
  storeLocation: string | null;
  datetime: string | null;
  isPartial: boolean;
  portionHint: "top" | "middle" | "bottom" | "full" | null;
  items: ReceiptLine[];
  subtotal: number | null;
  tax: number | null;
  total: number | null;
  currency: string | null;
  rawText: string;
};

export type CollatedItem = {
  name: string;
  brand: string | null;
  description: string | null;
  barcode: string | null;
  category: string | null;
  quantity: number | null;
  quantityUnit: string | null;
  weightValue: number | null;
  weightUnit: string | null;
  unitPrice: number | null;
  linePrice: number | null;
  currency: string | null;
  matchStatus: MatchStatus;
  matchConfidence: number | null;
  thumbnailData: string | null;
};

export type CollationResult = {
  storeName: string | null;
  storeLocation: string | null;
  subtotal: number | null;
  tax: number | null;
  total: number | null;
  currency: string;
  items: CollatedItem[];
  notes: string | null;
};

export type TripDetail = {
  trip: Trip;
  items: TripItem[];
  receipts: ReceiptCapture[];
};
