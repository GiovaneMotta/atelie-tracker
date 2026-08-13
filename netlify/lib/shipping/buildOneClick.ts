/* ================================================================
   shipping/buildOneClick — monta o payload OneClick da Frenet a partir
   do envio interno (§15). Campos e nomes EXATAMENTE como a doc oficial:
   Order{Id,Value,Items,From,To,Invoice}, Volumes[], Quotation{...}.
   Não inventa campos. Puro (sem IO) — fácil de testar.
   ================================================================ */
import type { FrenetConfig } from '../frenet/config';
import type { ShipItem, ShipVolume } from './volumes';
import { normalizeCep, normalizeUF, onlyDigits } from './normalize';

export interface OneClickRecipient {
  name: string; document?: string; phone?: string; email?: string;
  cep: string; street: string; number?: string; complement?: string;
  district: string; city: string; state: string;
}
export interface ChosenQuote {
  serviceCode: string; serviceName?: string; carrier?: string; carrierCode?: string | null;
  price?: number; days?: number | null;
}
export interface BuildOneClickInput {
  orderId: string;             // identificador do envio no nosso sistema (§15)
  orderValue: number;          // valor total da mercadoria
  createdAt?: string;          // ISO
  recipient: OneClickRecipient;
  items: ShipItem[];
  volumes: ShipVolume[];
  quote: ChosenQuote;
  invoice?: { value?: number; number?: string; series?: string; key?: string; date?: string; cfop?: string };
  notifyUrl?: string;          // TrackingNotificationUrl/StatusNotificationUrl
}

function toAddress(a: OneClickRecipient) {
  return {
    ZipCode: normalizeCep(a.cep),
    City: a.city,
    Street: a.street,
    AddressNumber: a.number || 'S/N',
    AddressComplement: a.complement || '',
    AddressQuarter: a.district,
    AddressState: normalizeUF(a.state),
    Country: 'BR',
  };
}

function toParty(p: {
  name: string; document?: string; phone?: string; email?: string;
} & OneClickRecipient) {
  const phone = onlyDigits(p.phone);
  return {
    Email: p.email || '',
    Name: p.name,
    Phone: phone,
    Cellphone: phone,
    Document: onlyDigits(p.document),
    Address: toAddress(p),
  };
}

export function buildOneClickPayload(config: FrenetConfig, input: BuildOneClickInput): unknown[] {
  const useFrenetReg = config.useFrenetRegistration;

  const To = toParty(input.recipient);

  // From: obrigatório salvo quando UseFrenetRegistration = true (cadastro na Frenet).
  const From = useFrenetReg ? undefined : toParty({
    name: config.sender.name, document: config.sender.document, phone: config.sender.phone,
    email: config.sender.email, cep: config.sender.cep, street: config.sender.street,
    number: config.sender.number, complement: config.sender.complement, district: config.sender.district,
    city: config.sender.city, state: config.sender.state,
  });

  const Items = input.items.map((it) => ({
    ProductName: it.name,
    SKU: it.sku || '',
    Quantity: Math.max(1, it.quantity || 1),
    Weight: Number(it.weightKg) || undefined,
    Length: Number(it.lengthCm) || undefined,
    Height: Number(it.heightCm) || undefined,
    Width: Number(it.widthCm) || undefined,
    Price: Number(it.unitPrice) || 0,
  }));

  const Volumes = input.volumes.map((v) => ({
    Weight: Number(v.weightKg) || 0,
    Length: Number(v.lengthCm) || 0,
    Height: Number(v.heightCm) || 0,
    Width: Number(v.widthCm) || 0,
    ...(v.declaredValue != null ? { DeclaredValue: Number(v.declaredValue) } : {}),
  }));

  const Quotation: Record<string, unknown> = {
    ShippingServiceCode: input.quote.serviceCode,
    ShippingServiceName: input.quote.serviceName || '',
    Carrier: input.quote.carrier || '',
    CarrierCode: input.quote.carrierCode || '',
    ShippingPrice: Number(input.quote.price) || 0,
    DeliveryTime: input.quote.days ?? undefined,
  };

  const Order: Record<string, unknown> = {
    Id: input.orderId,
    Value: Number(input.orderValue) || 0,
    Created: input.createdAt || new Date().toISOString(),
    UseFrenetRegistration: useFrenetReg,
    Items,
    To,
    ...(From ? { From } : {}),
    ...(input.invoice ? {
      Invoice: {
        Value: input.invoice.value ?? undefined,
        Number: input.invoice.number ?? undefined,
        Series: input.invoice.series ?? undefined,
        Key: input.invoice.key ?? undefined,
        Date: input.invoice.date ?? undefined,
        CFOP: input.invoice.cfop ?? undefined,
      },
    } : {}),
  };

  const shipment: Record<string, unknown> = { Order, Volumes, Quotation };
  if (input.notifyUrl) {
    shipment.TrackingNotificationUrl = input.notifyUrl;
    shipment.StatusNotificationUrl = input.notifyUrl;
  }
  return [shipment];
}
