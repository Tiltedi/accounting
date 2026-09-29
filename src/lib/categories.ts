// Categories used for sorting documents. The hints guide automatic reading.
export const CATEGORIES = [
  { name: "Software", hint: "SaaS, subscriptions, apps, cloud, hosting, domains" },
  { name: "Hardware", hint: "computers, phones, devices, equipment" },
  { name: "Office", hint: "supplies, stationery, furniture, printing, postage, shipping" },
  { name: "Travel", hint: "flights, trains, hotels, taxis, ride-hailing, car rental, parking, tolls" },
  { name: "Meals", hint: "restaurants, cafés, groceries, drinks, client entertainment" },
  { name: "Vehicle", hint: "fuel, charging, car maintenance, repairs, leasing" },
  { name: "Marketing", hint: "advertising, ads, events, sponsorships, promotional material" },
  { name: "Services", hint: "accountant, lawyer, consultants, freelancers, contractors, agencies" },
  { name: "Utilities", hint: "phone, mobile, internet, electricity, gas, water" },
  { name: "Rent", hint: "office rent, coworking, storage space" },
  { name: "Taxes & fees", hint: "taxes, duties, government fees, bank fees, fines" },
  { name: "Insurance", hint: "any insurance policy or premium" },
  { name: "Income", hint: "sales invoices issued by the company to its customers" },
  { name: "Other", hint: "anything that fits nowhere else" },
] as const;

export type Category = (typeof CATEGORIES)[number]["name"];

export const CATEGORY_NAMES = CATEGORIES.map((c) => c.name) as [Category, ...Category[]];

export const DOC_TYPES = [
  { value: "invoice", label: "Invoice" },
  { value: "receipt", label: "Receipt" },
  { value: "credit_note", label: "Credit note" },
  { value: "other", label: "Other" },
] as const;

export type DocType = (typeof DOC_TYPES)[number]["value"];

export const DOC_TYPE_VALUES = DOC_TYPES.map((t) => t.value) as [DocType, ...DocType[]];

export function docTypeLabel(value: string | null) {
  return DOC_TYPES.find((t) => t.value === value)?.label ?? "";
}
